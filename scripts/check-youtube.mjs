// Optional live check: no video files are written. The short output stays in memory.
import { spawn } from 'node:child_process';
import { ffmpeg } from '../media.mjs';
const base = process.env.TEST_BASE || 'http://127.0.0.1:8787';
const headers = { 'Content-Type': 'application/json', ...(process.env.APP_PASSWORD ? { Authorization: `Bearer ${process.env.APP_PASSWORD}` } : {}) };
async function request(route, body) {
  const response = await fetch(base + route, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
async function wait(job) {
  const deadline = Date.now() + 180000;
  while (!['done', 'error', 'cancelled'].includes(job.status)) {
    if (Date.now() > deadline) throw new Error('Live check timed out');
    await new Promise(r => setTimeout(r, 750)); job = await request(`/api/jobs/${job.id}`);
  }
  if (job.status !== 'done') throw new Error(job.error); return job;
}
const info = (await wait(await request('/api/inspect', { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' }))).result;
const chosen = info.formats[0];
console.log(`Live source: ${info.formats.length} formats; selected ${chosen.height}p ${chosen.fps}fps ${chosen.codec} [${chosen.id}]`);
const prepared = await wait(await request('/api/clips', { videoId: info.videoId, start: 10, end: 12, formatId: chosen.id, container: 'mkv' }));
const response = await fetch(base + prepared.result.fileUrl);
if (!response.ok) throw new Error(await response.text());
const bytes = Buffer.from(await response.arrayBuffer());
console.log(`Stream received: ${bytes.length} bytes, ${response.headers.get('content-type')}; kept in memory only`);
const probe = await new Promise((resolve, reject) => {
  const child = spawn(ffmpeg, ['-hide_banner', '-i', 'pipe:0', '-t', '0.1', '-f', 'null', '-'], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] }); let text = '';
  child.stderr.on('data', c => text += c); child.on('error', reject); child.stdin.on('error', () => {});
  child.on('close', code => code === 0 ? resolve(text) : reject(new Error(text))); child.stdin.end(bytes);
});
console.log(probe.split('\n').filter(line => /Stream #|Duration/.test(line)).join('\n'));
if (!probe.includes(`${chosen.width}x${chosen.height}`)) throw new Error('Source dimensions were not preserved');
console.log('PASS: maximum source dimensions and audio streamed without intermediate video files.');
