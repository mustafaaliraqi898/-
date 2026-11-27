/// <reference path="./electron.d.ts" />
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  printCurrentPage: (): Promise<{ opened: boolean }> => ipcRenderer.invoke('print:current-page'),
  invoke: <T = unknown>(channel: string, payload?: unknown): Promise<T> =>
    ipcRenderer.invoke(channel, payload),
});
