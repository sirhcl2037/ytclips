export function youtubeUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Paste a valid YouTube video link.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Use an HTTPS YouTube link.');
  const host = url.hostname.toLowerCase();
  let id;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
  }
  if (!/^[\w-]{11}$/.test(id || '')) throw new Error('Use a single YouTube video link, not a playlist or another website.');
  return `https://www.youtube.com/watch?v=${id}`;
}

export function parseTime(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : NaN;
  if (typeof value !== 'string' || !/^\d+(?::\d{1,2}){0,2}(?:\.\d{1,3})?$/.test(value.trim())) return NaN;
  const parts = value.trim().split(':').map(Number);
  if (parts.slice(1).some(p => p >= 60)) return NaN;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function validateClip(body, video, maxSeconds) {
  const start = parseTime(body.start), end = parseTime(body.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > video.duration + 0.05) {
    throw new Error('Choose a start and end within the video. End must be after start.');
  }
  if (end - start > maxSeconds) throw new Error(`Clips are limited to ${Math.floor(maxSeconds / 60)} minutes on this server.`);
  const format = video.formats.find(f => f.id === body.formatId);
  if (!format) throw new Error('Choose an available video quality.');
  if (!['mp4', 'mkv'].includes(body.container)) throw new Error('Choose MP4 or original quality MKV.');
  if (body.container === 'mp4' && format.hdr) throw new Error('Choose original quality MKV for HDR. MP4 export currently supports SDR streams.');
  return { start, end, format, container: body.container };
}

export function summarizeVideo(info) {
  if (!info.duration || info.is_live || info.live_status === 'is_upcoming') throw new Error('Live or upcoming streams are unsupported. Use a finished video.');
  const formats = (info.formats || []).filter(f =>
    f.vcodec && f.vcodec !== 'none' && f.height && !f.has_drm && f.url && /^[\w.-]+$/.test(f.format_id)
  ).map(f => ({
    id: f.format_id, width: f.width, height: f.height, fps: f.fps || 0,
    codec: f.vcodec, extension: f.ext, audio: f.acodec && f.acodec !== 'none',
    hdr: Boolean(f.dynamic_range && !['SDR', 'unknown'].includes(f.dynamic_range)),
    bitrate: f.tbr || 0, bytes: f.filesize || f.filesize_approx || null,
    note: f.format_note || '',
  })).sort((a, b) => b.height - a.height || b.fps - a.fps || b.bitrate - a.bitrate);
  if (!formats.length) throw new Error('YouTube returned no downloadable video streams for this video.');
  return { id: info.id, title: info.title || 'YouTube video', channel: info.channel || info.uploader || '', duration: info.duration, formats };
}

export function safeName(title) {
  return title.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 90) || 'youtube-clip';
}

export function alternateAudio(info, error) {
  if (!/403|forbidden/i.test(error.message) || !/in#1/.test(error.message) || info.requested_formats?.length !== 2) return null;
  const audio = (info.formats || []).filter(f => f.vcodec === 'none' && f.acodec !== 'none' && !f.has_drm && f.url && /^m3u8/.test(f.protocol || '')).at(-1);
  return audio ? [info.requested_formats[0], { ...audio, losslessAudio: true }] : null;
}

export function mediaUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['googlevideo.com', 'youtube.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
    throw new Error('YouTube returned an unsupported media address. Try another quality.');
  }
  return url.href;
}

export function ffmpegArgs(streams, clip, output, streaming = false) {
  const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'warning'];
  for (const stream of streams) {
    args.push('-protocol_whitelist', 'https,http,tls,tcp,crypto', '-rw_timeout', '30000000');
    const headers = Object.entries(stream.http_headers || {}).filter(([k, v]) =>
      /^[A-Za-z-]+$/.test(k) && !/[\r\n]/.test(String(v)) && !['host', 'authorization', 'cookie'].includes(k.toLowerCase())
    ).map(([k, v]) => `${k}: ${v}\r\n`).join('');
    if (headers) args.push('-headers', headers);
    if (clip.container === 'mkv' && streams.some(s => s.losslessAudio)) args.push('-noaccurate_seek');
    args.push('-ss', String(clip.start), '-i', mediaUrl(stream.url));
  }
  args.push('-t', String(clip.end - clip.start), '-map', '0:v:0');
  if (streams.length > 1) args.push('-map', '1:a:0');
  else args.push('-map', '0:a:0?');
  if (clip.container === 'mp4') {
    args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:a', 'aac', '-b:a', '192k', '-movflags', streaming ? '+frag_keyframe+empty_moov+default_base_moof' : '+faststart');
  } else {
    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
    const audio = streams.length > 1 ? streams[1] : streams[0];
    if (audio.losslessAudio) args.push('-c:a', 'flac');
  }
  if (streaming) args.push('-f', clip.container === 'mp4' ? 'mp4' : 'matroska');
  args.push('-progress', streaming ? 'pipe:2' : 'pipe:1', '-nostats', output);
  return args;
}
