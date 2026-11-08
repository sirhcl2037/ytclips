import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Writable } from 'node:stream';
import { ffmpeg, run, streamMedia } from '../media.mjs';
import { ffmpegArgs } from '../lib.mjs';

async function capture(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args, { windowsHide: true }); let text = '';
    p.stdout.on('data', c => text += c); p.stderr.on('data', c => text += c); p.on('error', reject); p.on('close', code => resolve({ text, code }));
  });
}
test('real FFmpeg precise MP4 cut preserves frame rate, selected dimensions, and audio', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ytclips-test-'));
  try {
    const input = path.join(dir, 'source.mp4'), output = path.join(dir, 'clip.mp4');
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=60', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input]);
    // Replace only the trusted remote input with a generated local fixture for this offline test.
    const args = ffmpegArgs([{ url: 'https://r1.googlevideo.com/fixture' }], { start: 1.125, end: 2.375, container: 'mp4' }, output);
    args[args.indexOf('https://r1.googlevideo.com/fixture')] = input;
    args[args.indexOf('-protocol_whitelist') + 1] += ',file';
    await run(ffmpeg, args);
    assert.ok((await stat(output)).size > 1000);
    const probe = await capture(['-hide_banner', '-i', output]);
    assert.match(probe.text, /Duration: 00:00:01\.25/); assert.match(probe.text, /320x180/); assert.match(probe.text, /60 fps/); assert.match(probe.text, /Audio: aac/);
    const decode = await capture(['-v', 'error', '-i', output, '-f', 'null', '-']); assert.equal(decode.code, 0); assert.equal(decode.text, '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('streamed MP4 is playable without a seekable output or temporary file', async () => {
  const args = ffmpegArgs([{ url: 'https://r1.googlevideo.com/v' }, { url: 'https://r1.googlevideo.com/a' }], { start: 0, end: 1.25, container: 'mp4' }, 'pipe:1', true);
  const begin = args.indexOf('-protocol_whitelist'), end = args.indexOf('-t');
  args.splice(begin, end - begin, '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=60', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000');
  const chunks = [];
  const response = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  await streamMedia(args, response, { signal: new AbortController().signal, onStart() {}, onProgress() {} });
  const bytes = Buffer.concat(chunks);
  assert.ok(bytes.includes(Buffer.from('ftyp'))); assert.ok(bytes.includes(Buffer.from('moof')));
  const decoded = await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-v', 'error', '-i', 'pipe:0', '-f', 'null', '-'], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] }); let text = '';
    child.stderr.on('data', chunk => text += chunk); child.on('error', reject); child.stdin.on('error', () => {});
    child.on('close', code => resolve({ code, text })); child.stdin.end(bytes);
  });
  assert.equal(decoded.code, 0); assert.equal(decoded.text, '');
});
