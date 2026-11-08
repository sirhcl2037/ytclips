import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeUrl, parseTime, summarizeVideo, validateClip, mediaUrl, ffmpegArgs } from '../lib.mjs';

test('accepts video links and removes playlist/tracking data; rejects arbitrary URLs', () => {
  for (const url of ['https://youtu.be/BaW_jenozKc?t=30', 'https://www.youtube.com/watch?v=BaW_jenozKc&list=123', 'https://youtube.com/shorts/BaW_jenozKc']) assert.equal(youtubeUrl(url), 'https://www.youtube.com/watch?v=BaW_jenozKc');
  for (const url of ['http://youtube.com/watch?v=BaW_jenozKc', 'https://youtube.com.evil.test/watch?v=BaW_jenozKc', 'https://127.0.0.1/test', 'file:///etc/passwd', 'https://youtube.com/playlist?list=123', 'https://evil@youtube.com/watch?v=BaW_jenozKc']) assert.throws(() => youtubeUrl(url));
});
test('validates timestamps without accepting overflow or invalid segments', () => {
  assert.equal(parseTime('1:02:03.125'), 3723.125); assert.equal(parseTime('01:30'), 90); assert.equal(parseTime('90.5'), 90.5);
  for (const value of ['1:99', '-1', '', 'one', null, Infinity, '1:00:60']) assert.ok(Number.isNaN(parseTime(value)));
  const video = { duration: 90, formats: [{ id: '401', hdr: false }, { id: '402', hdr: true }] };
  const clip = { start: .125, end: 12.875, formatId: '401', container: 'mp4' };
  assert.equal(validateClip(clip, video, 60).end, 12.875);
  for (const change of [{ end: 100 }, { start: 15, end: 10 }, { formatId: 'best' }, { container: 'exe' }, { formatId: '402' }, { end: 80 }]) assert.throws(() => validateClip({ ...clip, ...change }, video, 60));
});
test('lists every real video stream including 8K, HDR and high frame rates', () => {
  const format = { vcodec: 'av01', acodec: 'none', url: 'https://r1.googlevideo.com/test', ext: 'webm' };
  const video = summarizeVideo({ id: 'abc', duration: 300, formats: [
    { ...format, format_id: '401', height: 4320, width: 7680, fps: 60, dynamic_range: 'HDR10' },
    { ...format, format_id: '140', vcodec: 'none' },
    { ...format, format_id: '137', height: 1080, fps: 120 },
    { ...format, format_id: '136', height: 720, has_drm: true },
  ] });
  assert.deepEqual(video.formats.map(f => f.id), ['401', '137']); assert.equal(video.formats[0].hdr, true);
  assert.throws(() => summarizeVideo({ is_live: true, duration: 100 }));
});
test('only permits trusted HTTPS media URLs and builds exact selected-quality commands', () => {
  for (const url of ['file:///etc/passwd', 'https://127.0.0.1/x', 'https://googlevideo.com.evil/x', 'http://r1.googlevideo.com/x']) assert.throws(() => mediaUrl(url));
  const streams = [{ url: 'https://r1.googlevideo.com/video', http_headers: { 'User-Agent': 'test', Cookie: 'private', Bad: 'x\r\ny' } }, { url: 'https://r1.googlevideo.com/audio' }];
  const args = ffmpegArgs(streams, { start: 1.25, end: 5.5, container: 'mp4' }, 'clip.mp4');
  assert.equal(args.filter(v => v === '-ss').length, 2); assert.ok(args.includes('1:a:0')); assert.ok(args.includes('4.25')); assert.ok(args.includes('libx264'));
  assert.ok(!args.includes('-r')); assert.ok(!args.includes('scale')); assert.ok(!args.join(' ').includes('private'));
  assert.ok(ffmpegArgs([streams[0]], { start: 1, end: 2, container: 'mkv' }, 'clip.mkv').includes('copy'));
  const streaming = ffmpegArgs(streams, { start: 1, end: 2, container: 'mp4' }, 'pipe:1', true);
  assert.ok(streaming.includes('+frag_keyframe+empty_moov+default_base_moof')); assert.equal(streaming.at(-1), 'pipe:1');
  assert.equal(streaming[streaming.indexOf('-progress') + 1], 'pipe:2');
});
