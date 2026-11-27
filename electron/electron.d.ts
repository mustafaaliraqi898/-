declare module 'electron' {
  export interface BrowserWindowConstructorOptions {
    show?: boolean;
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
    webContents: {
      printToPDF(options?: {
        pageSize?: string;
        printBackground?: boolean;
        margins?: {
          top?: number;
          bottom?: number;
          left?: number;
          right?: number;
        };
      }): Promise<Uint8Array>;
    };
    loadURL(url: string): Promise<void>;
    loadFile(filePath: string): Promise<void>;
    setMenuBarVisibility(visible: boolean): void;
    isDestroyed(): boolean;
    destroy(): void;
    on(event: string, listener: (event: { preventDefault(): void }, ...args: unknown[]) => void): this;
    static getAllWindows(): BrowserWindow[];
  }

  export const app: {
    whenReady(): Promise<void>;
    getPath(name: 'userData' | 'documents' | 'desktop' | 'temp'): string;
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

  export const shell: {
    openPath(path: string): Promise<string>;
  };

  export const protocol: {
    registerSchemesAsPrivileged(
      customSchemes: Array<{
        scheme: string;
        privileges?: {
          standard?: boolean;
          secure?: boolean;
          supportFetchAPI?: boolean;
        };
      }>
    ): void;
    handle(
      scheme: string,
      handler: (request: { url: string }) => Response | Promise<Response>
    ): void;
  };

  export const dialog: {
    showSaveDialog(
      browserWindow: BrowserWindow,
      options: {
        title?: string;
        defaultPath?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }
    ): Promise<{ canceled: boolean; filePath?: string }>;
    showOpenDialog(
      browserWindow: BrowserWindow,
      options: {
        title?: string;
        defaultPath?: string;
        properties?: Array<'openFile' | 'openDirectory' | 'createDirectory'>;
      }
    ): Promise<{ canceled: boolean; filePaths: string[] }>;
    showMessageBox(
      browserWindow: BrowserWindow,
      options: {
        type?: 'none' | 'info' | 'error' | 'question' | 'warning';
        title?: string;
        message: string;
        detail?: string;
        buttons: string[];
        defaultId?: number;
        cancelId?: number;
      }
    ): Promise<{ response: number; checkboxChecked: boolean }>;
  };
}
