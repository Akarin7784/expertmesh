import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/db';
import { Vault } from '../server/security';
import { createApp } from '../server/app';
import { mockProvider } from './mock-provider';
const dir = mkdtempSync(resolve(tmpdir(), 'expertmesh-e2e-'));
const mock = await mockProvider(3901),
  store = new Store(resolve(dir, 'test.db')),
  { app, runtime } = createApp(store, new Vault(dir));
const server = app.listen(3001, '127.0.0.1', () => console.log('E2E API ready'));
async function stop() {
  await runtime.shutdown();
  server.closeAllConnections();
  server.close();
  store.close();
  await mock.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
