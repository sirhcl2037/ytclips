import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (!args.includes('--frontend')) {
  console.error('Usage: npm run integrate -- --frontend ../pongmetrics/frontend [--api http://127.0.0.1:8787]'); process.exit(1);
}
const frontend = path.resolve(option('--frontend')), api = new URL(args.includes('--api') ? option('--api') : 'http://127.0.0.1:8787');
if ((api.protocol !== 'https:' && !(api.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(api.hostname))) || api.pathname !== '/' || api.search || api.hash || api.username || api.password) throw new Error('Use the HTTPS server origin, or HTTP localhost for the free local processor.');
const appPath = path.join(frontend, 'src/App.tsx');
let app = await readFile(appPath, 'utf8');
const anchor = '<span className="session-badge">';
if (!app.includes('href="/clips/"') && !app.includes(anchor)) throw new Error('Could not find the PongMetrics navigation. Add a link to /clips/ manually.');
const dest = path.join(frontend, 'public/clips');
await mkdir(dest, { recursive: true });
await cp(path.resolve('public'), dest, { recursive: true });
const sha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: frontend, encoding: 'utf8' }).stdout.trim() || 'unknown';
const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: frontend, encoding: 'utf8' }).stdout.trim();
await writeFile(path.join(dest, 'config.js'), `window.CLIPS_CONFIG = ${JSON.stringify({ apiBase: api.origin, build: `${sha}${dirty ? '-local' : ''} · ${new Date().toISOString()}` })};\n`);
if (!app.includes('href="/clips/"')) {
  app = app.replace(anchor, '<a className="clips-tool-link" href="/clips/">Trim YouTube video ↗</a>\n        ' + anchor);
  await writeFile(appPath, app);
  await writeFile(path.join(frontend, 'src/index.css'), (await readFile(path.join(frontend, 'src/index.css'), 'utf8')) + '\n.clips-tool-link { margin-left: auto; margin-right: 22px; font-size: 12px; color: #ffa5ad; white-space: nowrap; }\n@media (max-width: 640px) { .clips-tool-link { margin-right: 0; font-size: 10px; } }\n');
}
// Vite replaces this config on every build, preserving automatic commit and UTC identification.
const pluginPath = path.join(frontend, 'clips-build-plugin.mjs');
await writeFile(pluginPath, `import { execFileSync } from 'node:child_process';\nexport default function clipsBuild() { return { name: 'clips-build', generateBundle() {\n let sha = process.env.PONGMETRICS_COMMIT_SHA || process.env.BUILD_SOURCEVERSION || process.env.GITHUB_SHA || process.env.SCM_COMMIT_ID || '';\n let dirty = false; try { if (!sha) sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); dirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(); } catch {}\n this.emitFile({ type: 'asset', fileName: 'clips/config.js', source: 'window.CLIPS_CONFIG = ' + JSON.stringify({ apiBase: ${JSON.stringify(api.origin)}, build: (sha.slice(0, 8) || 'unknown') + (dirty ? '-local' : '') + ' · ' + new Date().toISOString() }) + ';' });\n} }; }\n`);
const vitePath = path.join(frontend, 'vite.config.ts');
let vite = await readFile(vitePath, 'utf8');
if (!vite.includes('clips-build-plugin')) {
  if (!/plugins:\s*\[/.test(vite)) throw new Error('Add clipsBuild() to Vite plugins manually.');
  vite = `// @ts-ignore: local build plugin is JavaScript.\nimport clipsBuild from './clips-build-plugin.mjs';\n` + vite.replace(/plugins:\s*\[/, 'plugins: [clipsBuild(), ');
  await writeFile(vitePath, vite);
}
console.log(`Installed trimmer at ${dest}. Run the PongMetrics frontend build and deploy its dist folder using the existing Azure workflow.`);
