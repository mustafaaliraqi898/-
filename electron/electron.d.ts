declare module 'electron' {
  export interface BrowserWindowConstructorOptions {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    title?: string;
    backgroundColor?: string;
    webPreferences?: {
      preload?: string;
      contextIsolation?: boolean;
      nodeIntegration?: boolean;
      sandbox?: boolean;
    };
  }

  export class BrowserWindow {
    constructor(options?: BrowserWindowConstructorOptions);
    loadURL(url: string): Promise<void>;
    loadFile(filePath: string): Promise<void>;
    setMenuBarVisibility(visible: boolean): void;
    static getAllWindows(): BrowserWindow[];
  }

  export const app: {
    whenReady(): Promise<void>;
    getPath(name: 'userData' | 'documents' | 'desktop'): string;
    quit(): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
  };

  export const ipcMain: {
    handle(
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => unknown
    ): void;
  };

  export const ipcRenderer: {
    invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  };

  export const contextBridge: {
    exposeInMainWorld(apiKey: string, api: Record<string, unknown>): void;
  };
}
