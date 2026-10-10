import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopWindowState } from '../shared/desktop';

contextBridge.exposeInMainWorld('expertmeshDesktop', {
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke('desktop:choose-directory'),
  minimize: (): Promise<void> => ipcRenderer.invoke('desktop:window-action', 'minimize'),
  toggleMaximize: (): Promise<void> =>
    ipcRenderer.invoke('desktop:window-action', 'toggle-maximize'),
  close: (): Promise<void> => ipcRenderer.invoke('desktop:window-action', 'close'),
  getWindowState: (): Promise<DesktopWindowState> => ipcRenderer.invoke('desktop:window-state'),
  onWindowState: (listener: (state: DesktopWindowState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopWindowState) =>
      listener(state);
    ipcRenderer.on('desktop:window-state', handler);
    return () => ipcRenderer.removeListener('desktop:window-state', handler);
  },
});
