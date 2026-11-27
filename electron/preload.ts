/// <reference path="./electron.d.ts" />
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  printCurrentPage: (): Promise<{ opened: boolean; filename: string }> =>
    ipcRenderer.invoke('print:current-page'),
  printHtml: (html: string): Promise<{ opened: boolean; filename: string }> =>
    ipcRenderer.invoke('print:html', html),
  invoke: <T = unknown>(channel: string, payload?: unknown): Promise<T> =>
    ipcRenderer.invoke(channel, payload),
});
