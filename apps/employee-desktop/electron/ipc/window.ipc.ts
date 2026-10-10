import { BrowserWindow, ipcMain } from 'electron';
import { IpcChannel } from './channels';

export function registerWindowIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IpcChannel.WindowMinimize, () => {
    getMainWindow()?.minimize();
  });

  ipcMain.handle(IpcChannel.WindowMaximizeToggle, () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.handle(IpcChannel.WindowClose, () => {
    getMainWindow()?.close();
  });
}
