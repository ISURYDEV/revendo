import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';

const api = {
  invoke: <T = unknown>(channel: string, payload?: unknown): Promise<T> =>
    ipcRenderer.invoke(channel, payload),
  on: (channel: string, callback: (payload: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  channels: IPC
};

contextBridge.exposeInMainWorld('revendo', api);

// Type augmentation for the renderer (also re-declared in src/lib/api.ts)
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace globalThis {
    interface Window {
      revendo: typeof api;
    }
  }
}
