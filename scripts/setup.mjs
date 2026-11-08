import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const chosen = process.argv.indexOf('--python');
const python = chosen >= 0 ? process.argv[chosen + 1] : process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
mkdirSync('.tools/python', { recursive: true });
const result = spawnSync(python, ['-m', 'pip', 'install', '--upgrade', '--target', path.resolve('.tools/python'), 'yt-dlp[default]', 'imageio-ffmpeg'], { stdio: 'inherit', windowsHide: true });
if (result.error || result.status !== 0) { console.error('Install Python 3.12+ with pip, then rerun npm run setup. You can also pass -- --python <path-to-python>.'); process.exit(1); }
console.log('Video tools installed. Run npm start. If Python is not on PATH, set PYTHON_BIN in .env.');
