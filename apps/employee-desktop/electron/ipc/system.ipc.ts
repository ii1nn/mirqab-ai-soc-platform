import { app, ipcMain, shell } from 'electron';
import { IpcChannel } from './channels';

const SETTINGS_DEEP_LINKS: Record<string, string> = {
  'windows-defender': 'windowsdefender',
  'windows-firewall': 'network-firewall',
  'windows-update': 'windowsupdate',
};

export function registerSystemIpcHandlers(): void {
  ipcMain.handle(IpcChannel.SystemOpenSetting, async (_event, key: string) => {
    const target = SETTINGS_DEEP_LINKS[key];
    if (target && process.platform === 'win32') {
      await shell.openExternal(`ms-settings:${target}`);
    }
  });

  ipcMain.handle(IpcChannel.AppGetVersion, () => app.getVersion());
}
