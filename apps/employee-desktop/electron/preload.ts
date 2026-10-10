import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel } from './ipc/channels';
import type { DeviceInfo, DeviceMetrics, InstalledApp, ProcessInfo } from './ipc/device.ipc';

const mirqabApi = {
  device: {
    getInfo: (): Promise<DeviceInfo> => ipcRenderer.invoke(IpcChannel.DeviceGetInfo),
    getMetrics: (): Promise<DeviceMetrics> => ipcRenderer.invoke(IpcChannel.DeviceGetMetrics),
    getProcesses: (): Promise<ProcessInfo[]> => ipcRenderer.invoke(IpcChannel.DeviceGetProcesses),
    getInstalledApps: (): Promise<InstalledApp[]> =>
      ipcRenderer.invoke(IpcChannel.DeviceGetInstalledApps),
  },
  auth: {
    saveRefreshToken: (token: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.AuthSaveRefreshToken, token),
    getRefreshToken: (): Promise<string | null> =>
      ipcRenderer.invoke(IpcChannel.AuthGetRefreshToken),
    clearRefreshToken: (): Promise<void> => ipcRenderer.invoke(IpcChannel.AuthClearRefreshToken),
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke(IpcChannel.WindowMinimize),
    maximizeToggle: (): Promise<void> => ipcRenderer.invoke(IpcChannel.WindowMaximizeToggle),
    close: (): Promise<void> => ipcRenderer.invoke(IpcChannel.WindowClose),
  },
  system: {
    openSetting: (key: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.SystemOpenSetting, key),
    getVersion: (): Promise<string> => ipcRenderer.invoke(IpcChannel.AppGetVersion),
  },
};

contextBridge.exposeInMainWorld('mirqab', mirqabApi);

export type MirqabApi = typeof mirqabApi;
