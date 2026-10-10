import path from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { registerAuthIpcHandlers } from './ipc/auth.ipc';
import { registerDeviceIpcHandlers } from './ipc/device.ipc';
import { registerSystemIpcHandlers } from './ipc/system.ipc';
import { registerWindowIpcHandlers } from './ipc/window.ipc';

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;

/**
 * Phase 13: `shell.openExternal()` hands the string straight to the OS
 * shell/URI handler — Electron's own security guidance is explicit that
 * this must never be called with an unvalidated URL (a `file:`, custom
 * protocol handler, or `javascript:` scheme can trigger unintended local
 * behavior, not just "open a browser tab"). Only allow the two schemes an
 * external link legitimately needs.
 */
function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: '#0B1220',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Endpoint agent renders only its own UI — any window.open target (e.g. a
  // link inside a scan finding) is handed to the OS browser, never rendered
  // inside a second Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Phase 13: standard Electron hardening baseline — this window should
  // only ever display its own bundled UI (or the dev server in dev mode),
  // never navigate itself to a different origin. Defense-in-depth: nothing
  // in this app currently triggers an in-page navigation to anything else
  // (confirmed by inspection — every `<Link>` is an internal react-router
  // route, external targets only ever go through the handler above), but
  // this closes the path off structurally rather than relying on that
  // staying true as the app grows.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isOwnDevServer = VITE_DEV_SERVER_URL && url.startsWith(VITE_DEV_SERVER_URL);
    const isOwnPackagedFile = url.startsWith('file://');
    if (!isOwnDevServer && !isOwnPackagedFile) {
      event.preventDefault();
    }
  });

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerDeviceIpcHandlers();
    registerAuthIpcHandlers();
    registerWindowIpcHandlers(() => mainWindow);
    registerSystemIpcHandlers();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
