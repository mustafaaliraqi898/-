/// <reference path="./electron.d.ts" />
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  invoke: <T = unknown>(channel: string, payload?: unknown): Promise<T> =>
    ipcRenderer.invoke(channel, payload),
});
