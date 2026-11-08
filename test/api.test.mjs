import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('API serves UI, enforces password/CORS, and rejects unsafe URLs before creating jobs', async () => {
  const port = 18000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), APP_PASSWORD: 'test-password-123456' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(() => { throw new Error('Server exited before ready'); }), new Promise((_, reject) => setTimeout(() => reject(new Error('Server startup timed out')), 10000).unref())]);
    assert.equal((await fetch(`${base}/clips/`)).status, 200);
    assert.equal((await (await fetch(`${base}/api/health`)).json()).passwordRequired, true);
    assert.equal((await fetch(`${base}/api/inspect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(`${base}/api/inspect`, { method: 'POST', headers: { Origin: 'https://evil.test' } })).status, 403);
    const invalid = await fetch(`${base}/api/inspect`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-password-123456' }, body: JSON.stringify({ url: 'https://localhost/private' }) });
    assert.equal(invalid.status, 400);
    const preflight = await fetch(`${base}/api/inspect`, { method: 'OPTIONS', headers: { Origin: 'https://green-wave-01024401e.3.azurestaticapps.net' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
    const local = await fetch(`${base}/api/health`, { headers: { Origin: 'http://127.0.0.1:5173' } });
    assert.equal(local.status, 200); assert.equal(local.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
    assert.equal((await fetch(`${base}/api/files/00000000-0000-0000-0000-000000000000?ticket=bad`)).status, 404);
  } finally { server.kill(); }
});
