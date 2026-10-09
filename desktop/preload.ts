import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('expertmeshDesktop', {
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke('desktop:choose-directory'),
});
