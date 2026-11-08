import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { youtubeUrl, summarizeVideo, validateClip, safeName, ffmpegArgs } from './lib.mjs';
import { root, extract, streamMedia, userError, stopChildren } from './media.mjs';

const number = (name, fallback, min = 1) => Math.max(min, Number(process.env[name]) || fallback);
const host = process.env.HOST || '127.0.0.1', port = number('PORT', 8787);
const password = process.env.APP_PASSWORD || '';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && password.length < 16) throw new Error('Set APP_PASSWORD to at least 16 characters before exposing this server.');
const allowed = new Set((process.env.ALLOWED_ORIGINS || 'https://green-wave-01024401e.3.azurestaticapps.net').split(',').map(s => s.trim()));
const ttl = number('JOB_TTL_MINUTES', 60) * 60000, maxClip = number('MAX_CLIP_SECONDS', 1800);
const jobs = new Map(), videos = new Map(), queue = [], rates = new Map();
let working = false, stopping = false, streaming = false;

function json(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function authorize(req) {
  if (!password) return true;
  const actual = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') || '');
  const expected = Buffer.from(password);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Send JSON data.');
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 8192) throw new Error('Request is too large.'); }
  try { return JSON.parse(text); } catch { throw new Error('Invalid request data.'); }
}
function publicJob(job) {
  return { id: job.id, kind: job.kind, status: job.status, stage: job.stage, progress: job.progress,
    error: job.error, result: job.result, transfer: job.transfer, expiresAt: new Date((job.finished || job.created) + ttl).toISOString() };
}
function createJob(kind, task) {
  const pending = [...jobs.values()].filter(j => ['queued', 'running'].includes(j.status));
  if (stopping || pending.length >= 8 || jobs.size >= number('MAX_JOBS', 100)) throw new Error('The server queue is full. Wait a little and try again.');
  const job = { id: randomUUID(), ticket: randomBytes(24).toString('hex'), kind, status: 'queued', stage: 'Waiting for the video processor', progress: 0, created: Date.now(), controller: new AbortController() };
  jobs.set(job.id, job); queue.push({ job, task }); void drain(); return job;
}
async function drain() {
  if (working) return; working = true;
  try {
    while (queue.length && !stopping) {
      const { job, task } = queue.shift();
      if (job.status === 'cancelled') continue;
      job.status = 'running';
      try { await task(job); if (job.controller.signal.aborted) throw new Error('Cancelled.'); job.status = 'done'; job.progress = 100; job.stage = 'Ready'; }
      catch (error) {
        console.error(`[${job.id}]`, String(error.message).replace(/https?:\/\/\S+/g, '[remote address]'));
        job.status = job.controller.signal.aborted ? 'cancelled' : 'error'; job.error = userError(error);
      }
      job.finished = Date.now();
    }
  } finally { working = false; }
}
async function serveFile(req, res, filename, type, download) {
  const info = await stat(filename), size = info.size;
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (download) headers['Content-Disposition'] = `attachment; filename="clip.${path.extname(filename).slice(1)}"; filename*=UTF-8''${encodeURIComponent(download)}`;
  let start = 0, end = size - 1, code = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
    if (match[1]) { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
    else start = Math.max(0, size - Number(match[2]));
    if (start > end || start >= size || !Number.isSafeInteger(start)) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
    code = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(code, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = createReadStream(filename, { start, end });
  stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
  const origin = req.headers.origin;
  // CORS is also enforced for mutations; browsers must not submit to local services from arbitrary websites.
  const sameOrigin = origin === `http://${host}:${port}` || origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`;
  if (origin && !sameOrigin && !allowed.has(origin)) return json(res, 403, { error: 'This website is not allowed to use the video server.' });
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (origin && allowed.has(origin)) res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`), pathname = url.pathname;
    if (pathname === '/api/health') return json(res, 200, { ok: true, passwordRequired: Boolean(password), maxClipSeconds: maxClip });
    const fileMatch = /^\/api\/files\/([\da-f-]{36})$/.exec(pathname);
    if (fileMatch && ['GET', 'HEAD'].includes(req.method)) {
      const job = jobs.get(fileMatch[1]);
      if (!job || job.status !== 'done' || !job.streamSpec || url.searchParams.get('ticket') !== job.ticket) return json(res, 404, { error: 'Clip not found or expired. Prepare it again.' });
      if (req.method === 'HEAD') { res.writeHead(200, { 'Content-Type': job.container === 'mp4' ? 'video/mp4' : 'video/x-matroska', 'Cache-Control': 'no-store', 'Accept-Ranges': 'none' }); return res.end(); }
      if (streaming) return json(res, 409, { error: 'Another download is streaming. Finish or cancel it before starting another.' });
      streaming = true; job.transfer = 'streaming'; job.progress = 0; job.controller = new AbortController();
      const disconnected = () => { if (!res.writableEnded) job.controller.abort(); };
      res.on('close', disconnected);
      try {
        // Refresh expiring media URLs before each transfer. The selection is held only in memory.
        const info = await extract(job.streamSpec.url, job.streamSpec.clip.format, job.controller.signal);
        const streams = info.requested_formats || [info];
        if (streams[0].format_id !== job.streamSpec.clip.format.id) throw new Error('Requested format is not available');
        await streamMedia(ffmpegArgs(streams, job.streamSpec.clip, 'pipe:1', true), res, {
          signal: job.controller.signal,
          onStart: () => res.writeHead(200, { 'Content-Type': job.container === 'mp4' ? 'video/mp4' : 'video/x-matroska', 'Cache-Control': 'no-store', 'Accept-Ranges': 'none', 'Content-Disposition': `attachment; filename="clip.${job.container}"; filename*=UTF-8''${encodeURIComponent(job.filename)}` }),
          onProgress: seconds => { job.progress = Math.min(99, Math.max(0, seconds / job.result.duration * 100)); },
        });
        job.transfer = 'complete'; job.progress = 100;
      } catch (error) {
        job.transfer = 'error'; job.error = userError(error);
        console.error(`[stream ${job.id}]`, String(error.message).replace(/https?:\/\/\S+/g, '[remote address]'));
        if (!res.headersSent) json(res, 502, { error: job.error }); else res.destroy();
      } finally { streaming = false; res.removeListener('close', disconnected); }
      return;
    }
    if (pathname.startsWith('/api/')) {
      if (!authorize(req)) return json(res, 401, { error: 'Enter the video server password in Connection settings.' });
      const match = /^\/api\/jobs\/([\da-f-]{36})$/.exec(pathname);
      if (match && req.method === 'GET') {
        const job = jobs.get(match[1]); return job ? json(res, 200, publicJob(job)) : json(res, 404, { error: 'This job expired or the server restarted. Load the video again.' });
      }
      if (match && req.method === 'DELETE') {
        const job = jobs.get(match[1]);
        if (job && (['queued', 'running'].includes(job.status) || job.transfer === 'streaming')) { job.controller.abort(); if (job.transfer !== 'streaming') job.status = 'cancelled'; job.finished = Date.now(); }
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && ['/api/inspect', '/api/clips'].includes(pathname)) {
        const key = req.socket.remoteAddress, rate = rates.get(key) || { count: 0, at: Date.now() };
        if (Date.now() - rate.at > 60000) { rate.count = 0; rate.at = Date.now(); }
        rates.set(key, rate); if (++rate.count > 15) return json(res, 429, { error: 'Too many requests. Wait a minute and try again.' });
        const body = await readJson(req);
        if (pathname === '/api/inspect') {
          const canonical = youtubeUrl(body.url);
          const job = createJob('inspect', async job => {
            job.stage = 'Reading YouTube video and available qualities';
            const info = summarizeVideo(await extract(canonical, null, job.controller.signal));
            const videoId = randomUUID(); videos.set(videoId, { ...info, url: canonical, created: Date.now() });
            job.result = { ...info, videoId, maxClipSeconds: maxClip };
          });
          return json(res, 202, publicJob(job));
        }
        const video = videos.get(body.videoId);
        if (!video) return json(res, 400, { error: 'Video details expired. Load the link again.' });
        const clip = validateClip(body, video, maxClip);
        const job = createJob('export', async job => {
          job.stage = 'Getting fresh video and audio streams';
          const info = await extract(video.url, clip.format, job.controller.signal);
          const streams = info.requested_formats || [info];
          if (streams[0].format_id !== clip.format.id) throw new Error('Requested format is not available');
          // Validate input addresses now; create no output until the browser requests a download.
          ffmpegArgs(streams, clip, 'pipe:1', true);
          job.container = clip.container;
          job.filename = `${safeName(video.title)}_${clip.start}-${clip.end}.${clip.container}`;
          job.streamSpec = { url: video.url, clip };
          job.result = { fileUrl: `/api/files/${job.id}?ticket=${job.ticket}`, filename: job.filename, container: clip.container, duration: clip.end - clip.start };
        });
        return json(res, 202, publicJob(job));
      }
      return json(res, 404, { error: 'Unknown API route.' });
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
    const asset = pathname.replace(/^\/clips(?=\/|$)/, '') || '/';
    const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/config.js': ['config.js', 'text/javascript'] };
    if (!files[asset]) return json(res, 404, { error: 'Page not found.' });
    return await serveFile(req, res, path.join(root, 'public', files[asset][0]), files[asset][1]);
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent) json(res, 400, { error: error.message.length < 250 ? error.message : 'Request failed.' }); else res.destroy();
  }
});
server.requestTimeout = 30000;
const cleanup = setInterval(async () => {
  for (const [id, job] of jobs) if (job.finished && job.transfer !== 'streaming' && Date.now() - job.finished > ttl) jobs.delete(id);
  for (const [id, video] of videos) if (Date.now() - video.created > ttl) videos.delete(id);
  for (const [ip, rate] of rates) if (Date.now() - rate.at > 60000) rates.delete(ip);
}, 30000);
cleanup.unref();
server.listen(port, host, () => console.log(`PongMetrics Clips: http://${host}:${port}/clips/`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; for (const job of jobs.values()) job.controller.abort(); stopChildren(); server.close(); setTimeout(() => process.exit(0), 2000).unref(); });
