import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createApp } from '../server/app';
import { Store } from '../server/db';
import { Vault } from '../server/security';
import { externalUrl, isAppUrl } from '../desktop/policy';

test('desktop links stay in their own origin and system protocols are rejected', () => {
  const origin = 'http://127.0.0.1:43210';
  assert.equal(isAppUrl(`${origin}/api/export`, origin), true);
  for (const url of [
    'http://127.0.0.1:43211',
    'https://example.com',
    'file:///etc/passwd',
    'http://user:pass@127.0.0.1:43210',
    'invalid',
  ])
    assert.equal(isAppUrl(url, origin), false);
  assert.equal(externalUrl('https://example.com/docs'), 'https://example.com/docs');
  for (const url of [
    'file:///C:/secret',
    'javascript:alert(1)',
    'ms-settings:',
    'https://user:pass@example.com',
    'invalid',
  ])
    assert.equal(externalUrl(url), undefined);
});

test('desktop server requires its session token and bound origin, including static files', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'mesh-desktop-auth-'));
  const store = new Store(resolve(dir, 'test.db'));
  const { app, runtime } = createApp(store, new Vault(dir), { sessionToken: 'test-desktop-token' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(`${origin}/api/bootstrap`)).status, 403);
    assert.equal((await fetch(origin)).status, 403);
    assert.equal(
      (
        await fetch(`${origin}/api/health`, {
          headers: { 'X-ExpertMesh-Session': 'incorrect-token-value' },
        })
      ).status,
      403,
    );
    const headers = { 'X-ExpertMesh-Session': 'test-desktop-token', Origin: origin };
    assert.equal((await fetch(`${origin}/api/bootstrap`, { headers })).status, 200);
    assert.equal(
      (
        await fetch(`${origin}/api/health`, {
          headers: { ...headers, Origin: 'http://127.0.0.1:5173' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${origin}/api/health`, {
          headers: { ...headers, 'sec-fetch-site': 'cross-site' },
        })
      ).status,
      403,
    );
  } finally {
    await runtime.shutdown();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
