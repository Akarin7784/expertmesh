import { createStore } from './db';
import { Vault } from './security';
import { createApp } from './app';
const store = createStore(),
  { app, runtime } = createApp(store, new Vault());
const port = Number(process.env.PORT || 3001),
  host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log(`ExpertMesh: http://${host}:${port}`));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  await runtime.shutdown();
  store.close();
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
