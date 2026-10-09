import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
  utilityProcess,
} from 'electron';
import type { UtilityProcess } from 'electron';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { externalUrl, isAppUrl } from './policy';

app.setName('ExpertMesh');
const singleInstance = app.requestSingleInstanceLock();
let window: BrowserWindow | undefined;
let backend: UtilityProcess | undefined;
let origin = '';
let quitting = false;
let stopped = false;

async function startBackend(dataDir: string) {
  const token = randomBytes(32).toString('hex');
  backend = utilityProcess.fork(join(__dirname, 'backend.cjs'), [], {
    serviceName: 'ExpertMesh local service',
    cwd: dataDir,
    env: {
      ...process.env,
      EXPERTMESH_DESKTOP: '1',
      DATA_DIR: dataDir,
      EXPERTMESH_DIST_DIR: join(app.getAppPath(), 'dist'),
      EXPERTMESH_SESSION_TOKEN: token,
    },
    stdio: 'inherit',
  });
  const child = backend;
  child.on('exit', () => {
    backend = undefined;
    if (origin && !quitting) {
      dialog.showErrorBox('本地服务已停止', '请重新打开 ExpertMesh。未完成的任务会保留供继续。');
      app.quit();
    }
  });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => finish(Error('本地服务启动超时')), 20000);
    const onExit = () => finish(Error('本地服务启动失败'));
    const onMessage = (message: { type: string; port?: number; message?: string }) => {
      if (message.type === 'error') finish(Error(message.message || '本地服务启动失败'));
      if (message.type === 'ready' && Number.isInteger(message.port) && message.port! > 0)
        finish(undefined, message.port);
    };
    function finish(error?: Error, value?: number) {
      clearTimeout(timer);
      child.removeListener('message', onMessage);
      child.removeListener('exit', onExit);
      if (error) reject(error);
      else resolve(value!);
    }
    child.on('message', onMessage);
    child.once('exit', onExit);
  });
  origin = `http://127.0.0.1:${port}`;
  const desktopSession = session.fromPartition('expertmesh-desktop');
  desktopSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  desktopSession.setPermissionCheckHandler(() => false);
  desktopSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;
    if (isAppUrl(details.url, origin)) headers['X-ExpertMesh-Session'] = token;
    else delete headers['X-ExpertMesh-Session'];
    callback({ requestHeaders: headers });
  });
  return desktopSession;
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 720,
    minHeight: 540,
    show: false,
    backgroundColor: '#f8f5ef',
    title: 'ExpertMesh · 工作手记',
    webPreferences: {
      partition: 'expertmesh-desktop',
      preload: join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  const current = window;
  const openLink = (raw: string) => {
    const url = externalUrl(raw);
    if (url && !isAppUrl(url, origin)) void shell.openExternal(url).catch(() => {});
  };
  current.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, origin)) {
      event.preventDefault();
      openLink(url);
    }
  });
  current.webContents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url, origin)) event.preventDefault();
  });
  current.webContents.setWindowOpenHandler(({ url }) => {
    openLink(url);
    return { action: 'deny' };
  });
  current.on('closed', () => {
    window = undefined;
  });
  current.once('ready-to-show', () => current.show());
  await current.loadURL(origin);
}

async function shutdown() {
  const child = backend;
  if (!child) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve();
    }, 7000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.postMessage({ type: 'shutdown' });
  });
}

if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.on('before-quit', (event) => {
    if (stopped) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void shutdown().finally(() => {
      stopped = true;
      app.quit();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (!window && origin && backend && !quitting) void createWindow();
  });
  ipcMain.handle('desktop:choose-directory', async (event) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !isAppUrl(event.senderFrame.url, origin)
    )
      throw Error('请求来源不允许');
    const result = await dialog.showOpenDialog(window, {
      title: '选择只读工作区',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  void app
    .whenReady()
    .then(async () => {
      const dataDir =
        process.env.EXPERTMESH_DESKTOP_DATA_DIR || join(app.getPath('userData'), 'data');
      mkdirSync(dataDir, { recursive: true });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
          { role: 'fileMenu' },
          { role: 'editMenu' },
          {
            label: '视图',
            submenu: [
              { role: 'reload' },
              { role: 'resetZoom' },
              { role: 'zoomIn' },
              { role: 'zoomOut' },
              { role: 'togglefullscreen' },
            ],
          },
        ]),
      );
      await startBackend(dataDir);
      await createWindow();
    })
    .catch((error: Error) => {
      dialog.showErrorBox('无法启动 ExpertMesh', error.message);
      app.quit();
    });
}
