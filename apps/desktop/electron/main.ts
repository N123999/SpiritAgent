import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BrowserWindow, Menu, app, dialog, ipcMain, nativeTheme, net, shell } from 'electron';

import { openSystemTerminalInDirectory } from './open-system-terminal.js';
import { WorkspacePtyManager } from './workspace-pty.js';

import type { DesktopSnapshot } from '../src/types.js';
import {
  invokeDesktopHostCommand,
  setDesktopMarketplaceFetchImplementation,
  setDesktopExtensionHostAdapter,
  subscribeDesktopDreamUpdates,
} from '../src/host/service.js';
import {
  configFilePath,
  loadConfig,
  type DesktopWebHostConfigFile,
} from '../src/host/storage.js';
import { setDesktopWebHostRuntimeStatus } from '../src/host/web-host-state.js';
import { type ApplicationMenuSection, popupApplicationMenuSection } from './application-menu.js';
import {
  createDesktopHttpHost,
  createDesktopWebPairingCode,
  resolveDesktopWebHostFromEnv,
  type DesktopHttpHost,
} from './http-host.js';
import { resolveRendererDistPath } from './renderer-dist.js';
import { syncWindowsImmersiveDarkMode } from './win-dwm.js';

/** 与 `titleBarOverlay.height` 及自绘标题栏 CSS 高度一致（px） */
const TITLE_BAR_OVERLAY_HEIGHT = 32;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let desktopWebHost: DesktopHttpHost | undefined;
let desktopWebHostConfig: DesktopWebHostConfigFile | undefined;
let desktopWebHostPairingCode = createDesktopWebPairingCode();
let quittingAfterDesktopWebHostStop = false;
let unsubscribeDesktopDreamUpdates: (() => void) | undefined;

const workspacePtyManager = new WorkspacePtyManager();

setDesktopExtensionHostAdapter({
  async showMessageBox(request) {
    const targetWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    const options = {
      title: request.title,
      message: request.message,
      ...(request.detail ? { detail: request.detail } : {}),
      ...(request.buttons?.length ? { buttons: request.buttons } : {}),
      ...(request.cancelId !== undefined ? { cancelId: request.cancelId } : {}),
      ...(request.defaultId !== undefined ? { defaultId: request.defaultId } : {}),
      ...(request.noLink !== undefined ? { noLink: request.noLink } : {}),
      ...(request.type ? { type: request.type } : {}),
    };

    if (targetWindow) {
      await dialog.showMessageBox(targetWindow, options);
      return;
    }

    await dialog.showMessageBox(options);
  },
});

function shouldStartDesktopWebHostFromEnv(): boolean {
  return process.env.SPIRIT_DESKTOP_WEB_HOST === '1';
}

function getDesktopWebHost(config: DesktopWebHostConfigFile): DesktopHttpHost {
  if (!desktopWebHost) {
    desktopWebHost = createDesktopHttpHost({
      host: config.host,
      port: config.port,
      invokeHostCommand: invokeDesktopHostCommand,
      onHostCommandResult: handleDesktopWebHostCommandResult,
      auth: {
        getTokenHash: () => desktopWebHostConfig?.authTokenHash,
        getPairingCode: () => desktopWebHostPairingCode,
        completePairing: completeDesktopWebHostPairing,
      },
      static: {
        root: rendererDistPath(),
        spaFallback: true,
      },
    });
  }
  return desktopWebHost;
}

function rendererDistPath(): string {
  return resolveRendererDistPath(__dirname);
}

async function startDesktopWebHostFromEnv(): Promise<void> {
  if (!shouldStartDesktopWebHostFromEnv()) {
    return;
  }
  const { host, port } = resolveDesktopWebHostFromEnv();
  const config = await loadConfig();
  await syncDesktopWebHostWithConfig({
    ...config.webHost,
    enabled: true,
    host,
    port,
  });
}

async function syncInitialDesktopWebHost(): Promise<void> {
  if (shouldStartDesktopWebHostFromEnv()) {
    await startDesktopWebHostFromEnv();
    return;
  }
  const config = await loadConfig();
  await syncDesktopWebHostWithConfig(config.webHost);
}

async function stopDesktopWebHostIfRunning(): Promise<void> {
  if (!desktopWebHost?.isRunning()) {
    return;
  }
  await desktopWebHost.stop();
}

async function invokeMainDesktopHostCommand(
  command: Parameters<typeof invokeDesktopHostCommand>[0],
  payload?: unknown,
) {
  const result = await invokeDesktopHostCommand(command, payload);
  if (isDesktopSnapshot(result) && (command === 'bootstrap' || command === 'updateConfig')) {
    const config = await loadConfig();
    await syncDesktopWebHostWithConfig(config.webHost);
    if (command === 'updateConfig') {
      return invokeDesktopHostCommand('poll');
    }
  }
  return result;
}

async function handleDesktopWebHostCommandResult(
  command: Parameters<typeof invokeDesktopHostCommand>[0],
  _payload: unknown,
  result: unknown,
): Promise<void> {
  if (command !== 'updateConfig' || !isDesktopSnapshot(result)) {
    return;
  }
  const config = await loadConfig();
  await syncDesktopWebHostWithConfig(config.webHost);
}

async function syncDesktopWebHostWithConfig(
  config: DesktopWebHostConfigFile,
): Promise<void> {
  const previousConfig = desktopWebHostConfig;
  const changedEndpoint =
    previousConfig?.host !== config.host || previousConfig?.port !== config.port;
  desktopWebHostConfig = config;
  if (config.authTokenHash) {
    desktopWebHostPairingCode = '';
  } else if (!desktopWebHostPairingCode) {
    desktopWebHostPairingCode = createDesktopWebPairingCode();
  }

  if (!config.enabled) {
    await stopDesktopWebHostIfRunning();
    setDesktopWebHostRuntimeStatus({
      state: 'disabled',
      host: config.host,
      port: config.port,
    });
    return;
  }

  if (desktopWebHost?.isRunning() && !changedEndpoint) {
    const state = desktopWebHost.getState();
    setDesktopWebHostRuntimeStatus(state.running
      ? {
          state: 'running',
          host: config.host,
          port: config.port,
          url: state.url,
          ...(config.authTokenHash ? {} : { pairingCode: desktopWebHostPairingCode }),
        }
      : {
          state: 'stopped',
          host: config.host,
          port: config.port,
        });
    return;
  }

  if (desktopWebHost?.isRunning()) {
    await desktopWebHost.stop();
  }
  if (changedEndpoint) {
    desktopWebHost = undefined;
  }

  setDesktopWebHostRuntimeStatus({
    state: 'starting',
    host: config.host,
    port: config.port,
  });

  try {
    const state = await getDesktopWebHost(config).start();
    setDesktopWebHostRuntimeStatus({
      state: 'running',
      host: state.host,
      port: state.port,
      ...(state.url ? { url: state.url } : {}),
      ...(config.authTokenHash ? {} : { pairingCode: desktopWebHostPairingCode }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[spirit-desktop] start desktop web host failed', error);
    setDesktopWebHostRuntimeStatus({
      state: 'error',
      host: config.host,
      port: config.port,
      error: message,
    });
  }
}

async function completeDesktopWebHostPairing(authTokenHash: string): Promise<void> {
  await invokeDesktopHostCommand('setWebHostAuthTokenHash', { authTokenHash });
  const config = await loadConfig();
  desktopWebHostConfig = config.webHost;
  desktopWebHostPairingCode = '';
  if (desktopWebHost?.isRunning()) {
    const state = desktopWebHost.getState();
    setDesktopWebHostRuntimeStatus({
      state: 'running',
      host: config.webHost.host,
      port: config.webHost.port,
      ...(state.url ? { url: state.url } : {}),
    });
  }
}

function isDesktopSnapshot(value: unknown): value is DesktopSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    'webHost' in value &&
    'config' in value &&
    'conversation' in value
  );
}

/** Windows 任务栏 / 窗口角标：与 Vite 页 `public/favicon.ico` 同源（main 位于 dist-electron/electron）。 */
function resolveWindowIconPath(): string | undefined {
  const fromMain = path.join(__dirname, '..', '..', 'public', 'favicon.ico');
  if (existsSync(fromMain)) {
    return fromMain;
  }
  const fromCwd = path.join(process.cwd(), 'public', 'favicon.ico');
  if (existsSync(fromCwd)) {
    return fromCwd;
  }
  return undefined;
}

/** 与 `src/styles.css` 中 `.dark` 的 `--background`（oklch(0.145 0 0) ≈ #0a0a0a）一致；关 Mica 时 titleBarOverlay 与窗口底色用此值，勿用通用 #171717 */
const WIN32_APP_BACKGROUND_DARK = '#0a0a0a';
const WIN32_APP_BACKGROUND_LIGHT = '#fafafa';

/** 与 Tauri `frame_chrome` 一致：开 Mica 时用透明背景把绘制交给 DWM，避免与系统浅色不同步时出现大块「假白」。 */
function electronRootBackgroundForBackdrop(mica: boolean, darkContent: boolean): string {
  if (process.platform === 'win32' && mica) {
    return '#00000000';
  }
  return darkContent ? WIN32_APP_BACKGROUND_DARK : WIN32_APP_BACKGROUND_LIGHT;
}

function readWindowsMicaFromDisk(): boolean {
  const filePath = configFilePath();
  if (!existsSync(filePath)) {
    return true;
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as {
      windowsMica?: boolean;
    };
    return parsed.windowsMica !== false;
  } catch {
    return true;
  }
}

/** 与 `src/lib/theme.ts` 中 `THEME_STORAGE_KEY` 保持一致 */
const RENDERER_THEME_STORAGE_KEY = 'spirit-agent-desktop-theme';

type RendererThemePrefs = {
  dark: boolean;
  nativeTheme: 'system' | 'light' | 'dark';
  pref: string;
};

const READ_RENDERER_THEME_PREFS_JS = `(() => {
  const raw = localStorage.getItem(${JSON.stringify(RENDERER_THEME_STORAGE_KEY)});
  const pref =
    raw === 'dark' || raw === 'light' || raw === 'system' ? raw : 'system';
  const resolveDark = (p) => {
    if (p === 'dark') return true;
    if (p === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const nativeFor = (p) =>
    p === 'system' ? 'system' : p === 'dark' ? 'dark' : 'light';
  return { dark: resolveDark(pref), nativeTheme: nativeFor(pref), pref };
})()`;

async function readRendererThemePrefs(
  window: BrowserWindow,
): Promise<RendererThemePrefs | null> {
  try {
    return (await window.webContents.executeJavaScript(
      READ_RENDERER_THEME_PREFS_JS,
    )) as RendererThemePrefs;
  } catch (err) {
    console.error('[spirit-desktop] readRendererThemePrefs failed', err);
    return null;
  }
}

function applyRendererThemePrefs(window: BrowserWindow, prefs: RendererThemePrefs): void {
  nativeTheme.themeSource = prefs.nativeTheme;
  applyWin32Backdrop(window, prefs.dark);
}

/**
 * 不依赖 preload IPC：从 localStorage 读主题并同步 Mica/DWM。
 */
async function syncBrowserWindowFrameFromRendererStorage(
  window: BrowserWindow,
): Promise<RendererThemePrefs | null> {
  const prefs = await readRendererThemePrefs(window);
  if (!prefs) {
    return null;
  }
  applyRendererThemePrefs(window, prefs);
  return prefs;
}

function applyWin32Backdrop(window: BrowserWindow, darkContent: boolean): void {
  const mica = readWindowsMicaFromDisk();

  if (process.platform === 'win32') {
    try {
      window.setBackgroundMaterial(mica ? 'mica' : 'none');
    } catch (err) {
      console.error('[spirit-desktop] setBackgroundMaterial failed', err);
    }
  }

  window.setBackgroundColor(electronRootBackgroundForBackdrop(mica, darkContent));

  if (process.platform === 'win32') {
    syncWindowsImmersiveDarkMode(window, darkContent);
  }

  if (process.platform !== 'win32') {
    return;
  }

  try {
    // 关 Mica 时若用实色 overlay，会盖住 WebView 标题栏最底一行（含 `border-b`），金刚键下缺一块线。
    // 透明叠加：底色与底边由页面自绘透出，系统只画三个按钮图标（与开 Mica 时一致）。
    window.setTitleBarOverlay({
      height: TITLE_BAR_OVERLAY_HEIGHT,
      color: '#00000000',
      symbolColor: darkContent ? '#f5f5f5' : '#1f1f1f',
    });
  } catch {
    // 未启用 overlay 或平台限制时忽略
  }
}

async function createMainWindow(): Promise<BrowserWindow> {
  const micaOnDisk = readWindowsMicaFromDisk();
  const initialDark = nativeTheme.shouldUseDarkColors;
  const initialBg = electronRootBackgroundForBackdrop(
    process.platform === 'win32' && micaOnDisk,
    initialDark,
  );
  const preloadPath = path.join(__dirname, 'preload.cjs');
  if (!existsSync(preloadPath)) {
    console.error(
      '[spirit-desktop] preload 缺失（需 build:electron 生成 preload.cjs）:',
      preloadPath,
    );
  }

  const windowIcon = resolveWindowIconPath();

  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    ...(windowIcon ? { icon: windowIcon } : {}),
    backgroundColor: initialBg,
    titleBarStyle:
      process.platform === 'darwin' ? 'hiddenInset' : process.platform === 'win32' ? 'hidden' : undefined,
    titleBarOverlay:
      process.platform === 'win32'
        ? {
            height: TITLE_BAR_OVERLAY_HEIGHT,
            color: '#00000000',
            symbolColor: initialDark ? '#f5f5f5' : '#1f1f1f',
          }
        : undefined,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  if (DEV_SERVER_URL) {
    await window.loadURL(DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(rendererDistPath(), 'index.html'));
  }

  await syncBrowserWindowFrameFromRendererStorage(window);

  const webContentsId = window.webContents.id;
  window.webContents.once('destroyed', () => {
    workspacePtyManager.disposeAllForWebContents(webContentsId);
  });

  return window;
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    Menu.setApplicationMenu(null);
  }

  setDesktopMarketplaceFetchImplementation((input, init) =>
    net.fetch(input instanceof URL ? input.toString() : input, init),
  );

  unsubscribeDesktopDreamUpdates = subscribeDesktopDreamUpdates((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('desktop:dream-updated', snapshot);
      }
    }
  });

  ipcMain.handle('desktop:invoke', (_event, command: Parameters<typeof invokeDesktopHostCommand>[0], payload?: unknown) =>
    invokeMainDesktopHostCommand(command, payload),
  );

  ipcMain.handle('desktop:export-session-log', async () => {
    const result = await invokeMainDesktopHostCommand('exportSessionLog') as {
      snapshot: DesktopSnapshot;
      path: string;
    };
    const openError = await shell.openPath(result.path);
    if (openError) {
      throw new Error(`自动打开导出文件失败: ${openError}`);
    }
    return result.snapshot;
  });

  ipcMain.handle('desktop:pick-workspace-directory', async (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    const result = targetWindow
      ? await dialog.showOpenDialog(targetWindow, {
          properties: ['openDirectory'],
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory'],
        });
    if (result.canceled) {
      return null;
    }
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(
    'desktop:application-menu-popup',
    (
      event,
      payload: { section: ApplicationMenuSection; clientX: number; clientY: number },
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) {
        return;
      }
      popupApplicationMenuSection(win, payload.section, payload.clientX, payload.clientY);
    },
  );

  ipcMain.handle(
    'desktop:sync-window-frame',
    (event, request: { dark: boolean; nativeTheme: 'system' | 'light' | 'dark' }) => {
      nativeTheme.themeSource = request.nativeTheme;
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        console.warn('[spirit-desktop] desktop:sync-window-frame: no BrowserWindow for sender');
        return;
      }
      applyWin32Backdrop(window, request.dark);
    },
  );

  ipcMain.handle(
    'desktop:pty-create',
    (
      event,
      request: { cwd: string; cols: number; rows: number },
    ): { ok: true; id: string } | { ok: false; error: string } => {
      return workspacePtyManager.createSession(event.sender, request);
    },
  );

  ipcMain.on('desktop:pty-write', (event, payload: { id: string; data: string }) => {
    workspacePtyManager.write(event.sender, payload.id, payload.data);
  });

  ipcMain.on('desktop:pty-resize', (event, payload: { id: string; cols: number; rows: number }) => {
    workspacePtyManager.resize(event.sender, payload.id, payload.cols, payload.rows);
  });

  ipcMain.handle('desktop:pty-kill', (event, id: string) => {
    workspacePtyManager.kill(event.sender, id);
  });

  ipcMain.handle('desktop:open-system-terminal', (_event, cwd: string) => {
    openSystemTerminalInDirectory(cwd);
  });

  await syncInitialDesktopWebHost();
  await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('before-quit', (event) => {
  unsubscribeDesktopDreamUpdates?.();
  unsubscribeDesktopDreamUpdates = undefined;
  if (quittingAfterDesktopWebHostStop || !desktopWebHost?.isRunning()) {
    return;
  }

  event.preventDefault();
  quittingAfterDesktopWebHostStop = true;
  void stopDesktopWebHostIfRunning().finally(() => {
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});