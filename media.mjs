import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.dirname(fileURLToPath(import.meta.url));
const bundledPython = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
export const python = process.env.PYTHON_BIN || (existsSync(bundledPython) ? bundledPython : process.platform === 'win32' ? 'python' : 'python3');
const binDir = path.join(root, '.tools/python/imageio_ffmpeg/binaries');
export const ffmpeg = process.env.FFMPEG_BIN || (existsSync(binDir) && readdirSync(binDir).find(f => /^ffmpeg-/.test(f)) ? path.join(binDir, readdirSync(binDir).find(f => /^ffmpeg-/.test(f))) : 'ffmpeg');
const children = new Set();

export function run(command, args, { signal, timeout = 120000, onLine, maxOutput = 32 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled.'));
    const child = spawn(command, args, { windowsHide: true, detached: process.platform !== 'win32',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: [path.join(root, '.tools/python'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let out = '', err = '', lineBuffer = '', stopped = '';
    const stop = reason => {
      if (child.exitCode !== null || stopped) return;
      stopped = reason;
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill());
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const abort = () => stop('Cancelled.');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop('Processing timed out. Try a shorter clip or a lower quality.'), timeout);
    child.stdout.on('data', chunk => {
      out += chunk;
      if (out.length > maxOutput) stop('The video response was too large.');
      lineBuffer += chunk;
      const lines = lineBuffer.split(/[\r\n]+/); lineBuffer = lines.pop();
      for (const line of lines) onLine?.(line);
    });
    child.stderr.on('data', chunk => { err = (err + chunk).slice(-12000); });
    const cleanup = () => { clearTimeout(timer); children.delete(child); signal?.removeEventListener('abort', abort); };
    child.on('error', error => { cleanup(); reject(new Error(error.code === 'ENOENT' ? `Missing video tool: ${path.basename(command)}. Run npm run setup first.` : error.message)); });
    child.on('close', code => { cleanup(); if (stopped || code !== 0) reject(new Error(stopped || err || 'Video processing failed.')); else resolve(out); });
  });
}

export async function extract(url, format, signal) {
  const args = ['--ignore-config', '--no-cache-dir', '--no-playlist', '--no-warnings', '--skip-download', '--dump-single-json',
    '--socket-timeout', '20', '--retries', '2', '--js-runtimes', `node:${process.execPath}`];
  if (process.env.YTDLP_COOKIES) args.push('--cookies', process.env.YTDLP_COOKIES);
  if (format) args.push('-f', format.audio ? format.id : `${format.id}+bestaudio/${format.id}`);
  args.push('--', url);
  const output = await run(process.env.YTDLP_BIN || python, process.env.YTDLP_BIN ? args : ['-m', 'yt_dlp', ...args], { signal });
  return JSON.parse(output);
}

export function userError(error) {
  const message = String(error.message || error);
  if (/sign in|confirm.*bot|HTTP Error 429|Too Many Requests/i.test(message)) return 'YouTube blocked this request or requires sign-in. Try again later or run the tool locally. Cloud IP addresses are often blocked.';
  if (/403|forbidden/i.test(message)) return 'YouTube refused the media download (403). Reload the video, try another stream, or run locally. Updating yt-dlp may help.';
  if (/private video|members.only|age.restricted|not available|unavailable|copyright/i.test(message)) return 'This video is private, restricted, removed, or unavailable in this region. Try a public video.';
  if (/requested format.*not available/i.test(message)) return 'This stream is no longer available. Reload the video and choose a current quality.';
  if (/ENOSPC|No space left/i.test(message)) return 'The server is out of storage. Wait for older clips to expire or ask the owner to increase storage.';
  if (/certificate|SSL/i.test(message)) return 'A secure connection to YouTube failed. Check the server certificates or network settings.';
  if (/timed out|Cancelled|Missing video tool/i.test(message)) return message;
  return 'Video processing failed. Try another quality or a shorter clip. The server console has the technical details.';
}

export function stopChildren() { for (const child of children) { try { if (process.platform === 'win32') child.kill(); else process.kill(-child.pid, 'SIGKILL'); } catch {} } }

// Sends media straight to the HTTP response. No video buffers, files, or temporary directories.
export function streamMedia(args, response, { signal, onStart, onProgress }) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Cancelled.'));
    const child = spawn(ffmpeg, args, { windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let errorText = '', lineBuffer = '', started = false, stopped = '';
    function stop(reason) {
      if (stopped || child.exitCode !== null) return;
      stopped = reason;
      try { if (process.platform === 'win32') child.kill(); else process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
    const abort = () => stop('Cancelled.');
    const disconnect = () => { if (!response.writableEnded) stop('Download disconnected.'); };
    signal.addEventListener('abort', abort, { once: true }); response.on('close', disconnect);
    const timeout = setTimeout(() => stop('Processing timed out. Try a shorter clip.'), 3600000);
    child.stdout.on('data', chunk => {
      if (!started) { started = true; onStart(); }
      if (!response.write(chunk)) child.stdout.pause();
    });
    response.on('drain', () => child.stdout.resume());
    child.stderr.on('data', chunk => {
      errorText = (errorText + chunk).slice(-12000); lineBuffer += chunk;
      const lines = lineBuffer.split(/[\r\n]+/); lineBuffer = lines.pop();
      for (const line of lines) if (line.startsWith('out_time_us=')) onProgress(Number(line.slice(12)) / 1000000);
    });
    function cleanup() { clearTimeout(timeout); children.delete(child); signal.removeEventListener('abort', abort); response.removeListener('close', disconnect); }
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => {
      cleanup();
      if (stopped || code !== 0 || !started) reject(new Error(stopped || errorText || 'Video stream was empty.'));
      else { response.end(); resolve(); }
    });
  });
}
