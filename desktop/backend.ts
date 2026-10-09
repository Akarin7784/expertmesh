import { createStore } from '../server/db';
import { Vault } from '../server/security';
import { createApp } from '../server/app';

const parent = process.parentPort;
const token = process.env.EXPERTMESH_SESSION_TOKEN;
if (!parent || !token || !process.env.DATA_DIR || !process.env.EXPERTMESH_DIST_DIR)
  throw Error('桌面后端只能由主进程启动');
const store = createStore();
const { app, runtime } = createApp(store, new Vault(), {
  sessionToken: token,
  distDir: process.env.EXPERTMESH_DIST_DIR,
});
const server = app.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string')
    parent.postMessage({ type: 'ready', port: address.port });
});
server.on('error', (error) => {
  parent.postMessage({ type: 'error', message: error.message });
  void stop();
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  await runtime.shutdown();
  server.closeAllConnections();
  store.close();
  process.exit(0);
}
parent.on('message', ({ data }) => {
  if (data?.type === 'shutdown') void stop();
});
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
