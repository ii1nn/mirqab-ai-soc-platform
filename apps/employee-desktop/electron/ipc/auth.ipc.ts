import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, ipcMain, safeStorage } from 'electron';
import { IpcChannel } from './channels';

function getTokenFilePath(): string {
  return path.join(app.getPath('userData'), 'session.enc');
}

/**
 * Refresh tokens are the only credential persisted on disk, and only as
 * ciphertext via the OS keychain-backed safeStorage API (DPAPI on Windows).
 * Access tokens stay in renderer memory only — see src/store/auth.store.ts.
 */
export function registerAuthIpcHandlers(): void {
  ipcMain.handle(IpcChannel.AuthSaveRefreshToken, (_event, refreshToken: string): void => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS-level credential encryption is not available on this device');
    }
    const encrypted = safeStorage.encryptString(refreshToken);
    fs.writeFileSync(getTokenFilePath(), encrypted);
  });

  ipcMain.handle(IpcChannel.AuthGetRefreshToken, (): string | null => {
    const filePath = getTokenFilePath();
    if (!fs.existsSync(filePath) || !safeStorage.isEncryptionAvailable()) {
      return null;
    }

    try {
      const encrypted = fs.readFileSync(filePath);
      return safeStorage.decryptString(encrypted);
    } catch {
      return null;
    }
  });

  ipcMain.handle(IpcChannel.AuthClearRefreshToken, (): void => {
    const filePath = getTokenFilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
}
