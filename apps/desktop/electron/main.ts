import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';

import { invokeDesktopHostCommand } from '../src/host/service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

function currentWindowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#171717' : '#fafafa';
}

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: currentWindowBackground(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    titleBarOverlay:
      process.platform === 'win32'
        ? {
            color: currentWindowBackground(),
            symbolColor: nativeTheme.shouldUseDarkColors ? '#f5f5f5' : '#1f1f1f',
          }
        : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (DEV_SERVER_URL) {
    await window.loadURL(DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  return window;
}

app.whenReady().then(async () => {
  ipcMain.handle('desktop:invoke', (_event, command: Parameters<typeof invokeDesktopHostCommand>[0], payload?: unknown) =>
    invokeDesktopHostCommand(command, payload),
  );

  ipcMain.handle('desktop:set-native-theme', (_event, theme: 'system' | 'light' | 'dark') => {
    nativeTheme.themeSource = theme;
  });

  ipcMain.handle('desktop:sync-window-frame', (event, request: { dark: boolean }) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return;
    }
    window.setBackgroundColor(request.dark ? '#171717' : '#fafafa');
  });

  await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});