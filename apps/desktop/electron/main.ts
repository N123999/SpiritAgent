import './load-env.js';

import { existsSync, readFileSync } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BrowserWindow,
  IpcMainInvokeEvent,
  Menu,
  app,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  shell,
  webContents,
  type WebContents,
} from 'electron';

import {
  registerDesktopNotifications,
  registerWindowsToastActivationHandler,
  showDesktopNotification,
  type DesktopNotificationPayload,
} from './desktop-notifications.js';
import {
  registerDesktopAttention,
  setDesktopAttentionPending,
  refreshDesktopAttention,
} from './desktop-attention.js';
import {
  installSpiritGeneratedAssetProtocolHandler,
  registerSpiritGeneratedAssetPrivilegedScheme,
} from './generated-asset-protocol.js';
import {
  bindSpiritNotificationProtocolHandlers,
  handleSpiritNotificationProtocolArgv,
  installSpiritNotificationProtocolRouting,
  registerSpiritNotificationProtocolClient,
} from './notification-protocol.js';
import {
  getAppAwayFromUser,
  registerWindowPresence,
  setRendererVisibility,
} from './window-presence.js';
import { openSystemTerminalInDirectory } from './open-system-terminal.js';
import { WorkspacePtyManager } from './workspace-pty.js';
import { isAllowedExternalUrl, getCachedLocalListeningEndpoints, getScanningPromise, startLocalListenersScan } from './local-listeners.js';
import {
  capturePageView,
  destroyAllPageViewsForHostId,
  destroyPageView,
  executeInPageView,
  insertCssInPageView,
  navigatePageView,
  removeInsertedCssInPageView,
  setPageDevtoolsWidth,
  syncPageView,
  togglePageDevTools,
  type PageViewBounds,
} from './workspace-browser-view.js';

import type { DesktopSnapshot } from '../src/types.js';

function parsePageViewBounds(bounds: PageViewBounds | undefined): PageViewBounds {
  const x = bounds?.x;
  const y = bounds?.y;
  const width = bounds?.width;
  const height = bounds?.height;
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    throw new Error('Invalid page view bounds');
  }
  return { x, y, width, height };
}

registerSpiritGeneratedAssetPrivilegedScheme();
registerSpiritNotificationProtocolClient();
installSpiritNotificationProtocolRouting();

const gotSpiritSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSpiritSingleInstanceLock) {
  app.quit();
} else {
  const spiritDataDir = resolveConfiguredSpiritAgentDataDir();
  app.setPath('userData', spiritDataDir);
  setSpiritAgentDataDirOverride(spiritDataDir);

  app.on('second-instance', (_event, argv) => {
    handleSpiritNotificationProtocolArgv(argv);
  });
}

function focusSpiritDesktopWindows(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  }
}

import {
  invokeDesktopHostCommand,
  setDesktopMarketplaceFetchImplementation,
  setDesktopExtensionHostAdapter,
  subscribeDesktopAutomationsUpdates,
  subscribeDesktopDreamUpdates,
  subscribeDesktopSessionListUpdates,
} from '../src/host/service.js';
import {
  configFilePath,
  loadConfig,
  resolveConfiguredSpiritAgentDataDir,
  setSpiritAgentDataDirOverride,
  spiritAgentDataDir,
  type DesktopWebHostConfigFile,
} from '../src/host/storage.js';
import { setDesktopWebHostRuntimeStatus } from '../src/host/web-host-state.js';
import { type ApplicationMenuSection, popupApplicationMenuSection, setMacOSApplicationMenu } from './application-menu.js';
import {
  createDesktopHttpHost,
  createDesktopWebPairingCode,
  resolveDesktopWebHostFromEnv,
  type DesktopHttpHost,
} from './http-host.js';
import {
  beginGitHubDeviceLoginInElectron,
  clearPendingGitHubDeviceAuth,
  completeGitHubDeviceLoginInElectron,
} from './github-oauth-flow.js';
import { resolveRendererDistPath } from './renderer-dist.js';
import { registerGitHubDeviceLoginRunners } from '../src/host/github-oauth-bridge.js';
import { listSystemFonts } from './system-fonts.js';
import { syncWindowsImmersiveDarkMode } from './win-dwm.js';
import i18nHost from '../src/lib/i18n-host.js';

/** 与 `titleBarOverlay.height` 及自绘标题栏 CSS 高度一致（px） */
const TITLE_BAR_OVERLAY_HEIGHT = 32;
const LOCAL_IMAGE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
const MANAGED_ASSET_PROTOCOL = 'spirit:';
const MANAGED_ASSET_HOST = 'generated';
const MANAGED_GENERATED_IMAGES_DIR = 'generated-images';
const MANAGED_GENERATED_VIDEOS_DIR = 'generated-videos';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let desktopWebHost: DesktopHttpHost | undefined;
let desktopWebHostConfig: DesktopWebHostConfigFile | undefined;
let desktopWebHostPairingCode = createDesktopWebPairingCode();
let quittingAfterDesktopWebHostStop = false;
let unsubscribeDesktopDreamUpdates: (() => void) | undefined;
let unsubscribeDesktopAutomationsUpdates: (() => void) | undefined;
let unsubscribeDesktopSessionListUpdates: (() => void) | undefined;

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

async function handleApprovalNotificationAction(decision: 'allow' | 'deny'): Promise<void> {
  let deliveredToRenderer = false;
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      continue;
    }
    window.webContents.send('desktop:approval-from-notification', { decision });
    deliveredToRenderer = true;
  }
  if (deliveredToRenderer) {
    return;
  }

  try {
    const next = await invokeMainDesktopHostCommand('replyPendingApproval', {
      decision: { kind: decision },
    });
    if (isDesktopSnapshot(next)) {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send('desktop:notify-refresh');
        }
      }
    }
  } catch (error) {
    console.error('[spirit-desktop] approval notification action failed:', error);
  }
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
  const fromDist = path.join(__dirname, '..', '..', 'dist', 'favicon.ico');
  if (existsSync(fromDist)) {
    return fromDist;
  }
  const fromPublic = path.join(__dirname, '..', '..', 'public', 'favicon.ico');
  if (existsSync(fromPublic)) {
    return fromPublic;
  }
  const fromCwd = path.join(process.cwd(), 'public', 'favicon.ico');
  if (existsSync(fromCwd)) {
    return fromCwd;
  }
  return undefined;
}

/** 与 `src/styles.css` Void 暗色 `--background`（#000000）一致；关 Mica 时窗口底色用此值，避免 WebView 透底呈 Chromium #121212 */
const WIN32_APP_BACKGROUND_DARK = '#000000';
const WIN32_APP_BACKGROUND_LIGHT = '#fafafa';

/** 与 Tauri `frame_chrome` 一致：开原生模糊时用透明背景，把绘制交给系统合成层。 */
function electronRootBackgroundForBackdrop(blurEnabled: boolean, darkContent: boolean): string {
  if (blurEnabled && (process.platform === 'win32' || process.platform === 'darwin')) {
    return '#00000000';
  }
  return darkContent ? WIN32_APP_BACKGROUND_DARK : WIN32_APP_BACKGROUND_LIGHT;
}

/** 配置键仍为 `windowsMica`，表示各平台原生窗口模糊（Win Mica / macOS Vibrancy）。 */
function readBackdropBlurFromDisk(): boolean {
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

const MACOS_WINDOW_VIBRANCY = 'under-window' as const;

function nativeBackdropBlurActive(blurEnabled: boolean): boolean {
  return blurEnabled && (process.platform === 'win32' || process.platform === 'darwin');
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
  applyNativeWindowBackdrop(window, prefs.dark);
}

/**
 * 不依赖 preload IPC：从 localStorage 读主题并同步原生窗口材质。
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

function applyNativeWindowBackdrop(window: BrowserWindow, darkContent: boolean): void {
  const blurEnabled = readBackdropBlurFromDisk();

  if (process.platform === 'win32') {
    try {
      window.setBackgroundMaterial(blurEnabled ? 'mica' : 'none');
    } catch (err) {
      console.error('[spirit-desktop] setBackgroundMaterial failed', err);
    }
  } else if (process.platform === 'darwin') {
    try {
      window.setVibrancy(blurEnabled ? MACOS_WINDOW_VIBRANCY : null);
    } catch (err) {
      console.error('[spirit-desktop] setVibrancy failed', err);
    }
  }

  window.setBackgroundColor(
    electronRootBackgroundForBackdrop(nativeBackdropBlurActive(blurEnabled), darkContent),
  );

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
  const blurOnDisk = readBackdropBlurFromDisk();
  const initialDark = nativeTheme.shouldUseDarkColors;
  const initialBg = electronRootBackgroundForBackdrop(
    nativeBackdropBlurActive(blurOnDisk),
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
    // macOS：构造时始终挂载 vibrancy 层，使运行时 setVibrancy 与透明背景切换走同一合成路径；
    // 关 Blur 时在 load 前立即 setVibrancy(null)，避免首帧误显模糊。
    ...(process.platform === 'darwin'
      ? {
          vibrancy: MACOS_WINDOW_VIBRANCY,
          visualEffectState: 'followWindow',
        }
      : {}),
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

  if (process.platform === 'darwin' && !blurOnDisk) {
    try {
      window.setVibrancy(null);
    } catch (err) {
      console.error('[spirit-desktop] setVibrancy(null) during create failed', err);
    }
  }

  if (DEV_SERVER_URL) {
    await window.loadURL(DEV_SERVER_URL);
  } else {
    await window.loadFile(path.join(rendererDistPath(), 'index.html'));
  }

  await syncBrowserWindowFrameFromRendererStorage(window);

  if (process.platform === 'darwin') {
    const broadcastWindowFullscreen = () => {
      if (window.isDestroyed()) {
        return;
      }
      window.webContents.send('desktop:window-fullscreen-changed', window.isFullScreen());
    };
    window.on('enter-full-screen', broadcastWindowFullscreen);
    window.on('leave-full-screen', broadcastWindowFullscreen);
    broadcastWindowFullscreen();
  }

  const webContentsId = window.webContents.id;
  window.once('closed', () => {
    destroyAllPageViewsForHostId(webContentsId);
    workspacePtyManager.disposeAllForWebContents(webContentsId);
  });

  registerDesktopNotifications(window, {
    onApprovalAction: handleApprovalNotificationAction,
    onNotificationReply: (payload) => {
      if (!window.webContents.isDestroyed()) {
        window.webContents.send('desktop:notification-reply', payload);
      }
    },
  });
  registerDesktopAttention(window);
  registerWindowPresence(window);

  window.webContents.setWindowOpenHandler((details) => {
    const url = typeof details.url === 'string' ? details.url.trim() : '';
    if (url && isAllowedExternalUrl(url) && !window.webContents.isDestroyed()) {
      window.webContents.send('desktop:browser-open-url', { url });
    }
    return { action: 'deny' };
  });

  return window;
}

if (gotSpiritSingleInstanceLock) {
  app.whenReady().then(async () => {
  installSpiritGeneratedAssetProtocolHandler({
    resolveManagedGeneratedAssetPath,
    videoPreviewMimeType,
    imagePreviewMimeType,
  });
  bindSpiritNotificationProtocolHandlers({
    onApproval: handleApprovalNotificationAction,
    onFocus: focusSpiritDesktopWindows,
  });
  handleSpiritNotificationProtocolArgv(process.argv);
  registerWindowsToastActivationHandler();
  if (process.platform === 'win32') {
    Menu.setApplicationMenu(null);
  } else if (process.platform === 'darwin') {
    setMacOSApplicationMenu();
  }

  registerGitHubDeviceLoginRunners({
    begin: () => beginGitHubDeviceLoginInElectron(),
    complete: () => completeGitHubDeviceLoginInElectron(),
    cancel: () => clearPendingGitHubDeviceAuth(),
  });

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

  unsubscribeDesktopAutomationsUpdates = subscribeDesktopAutomationsUpdates((snapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('desktop:automations-updated', snapshot);
      }
    }
  });

  unsubscribeDesktopSessionListUpdates = subscribeDesktopSessionListUpdates(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('desktop:session-list-updated');
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

  ipcMain.handle('desktop:pick-local-file', async (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    const result = targetWindow
      ? await dialog.showOpenDialog(targetWindow, {
          properties: ['openFile'],
        })
      : await dialog.showOpenDialog({
          properties: ['openFile'],
        });
    if (result.canceled) {
      return null;
    }
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle('desktop:ingest-browser-element-screenshot', async (_event: IpcMainInvokeEvent, payload: { base64: string }) => {
    const base64 = typeof payload?.base64 === 'string' ? payload.base64 : '';
    if (!base64) return null;
    const dir = path.join(spiritAgentDataDir(), 'clipboard-paste');
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `element-${Date.now()}.png`);
    await writeFile(filePath, Buffer.from(base64, 'base64'));
    return filePath;
  });

  ipcMain.handle('desktop:ingest-clipboard-image', async () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return null;
    }

    const dir = path.join(spiritAgentDataDir(), 'clipboard-paste');
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `paste-${Date.now()}.png`);
    await writeFile(filePath, image.toPNG());
    return filePath;
  });

  ipcMain.handle('desktop:list-system-fonts', () => listSystemFonts());

  ipcMain.handle('desktop:read-local-image-preview', async (_event, payload: { filePath?: string }) => {
    const filePath = typeof payload?.filePath === 'string' ? payload.filePath.trim() : '';
    if (!filePath) {
      return null;
    }

    return readImagePreviewDataUrlFromPath(filePath);
  });

  ipcMain.handle('desktop:read-managed-image-preview', async (_event, payload: { reference?: string }) => {
    const reference = typeof payload?.reference === 'string' ? payload.reference.trim() : '';
    if (!reference) {
      return null;
    }

    const filePath = await resolveManagedGeneratedAssetPath(reference);
    if (!filePath) {
      return null;
    }

    return readImagePreviewDataUrlFromPath(filePath);
  });

  ipcMain.handle('desktop:read-managed-video-preview', async (_event, payload: { reference?: string }) => {
    const reference = typeof payload?.reference === 'string' ? payload.reference.trim() : '';
    if (!reference) {
      return null;
    }

    const filePath = await resolveManagedGeneratedAssetPath(reference);
    if (!filePath) {
      return null;
    }

    return managedGeneratedVideoRefFromPath(filePath);
  });

  ipcMain.handle('desktop:read-local-video-preview', async (_event, payload: { filePath?: string }) => {
    const filePath = typeof payload?.filePath === 'string' ? payload.filePath.trim() : '';
    if (!filePath) {
      return null;
    }

    return readLocalVideoPreviewUrlFromPath(filePath);
  });

  ipcMain.handle(
    'desktop:save-local-image-as',
    async (event, payload: { filePath?: string }) => {
      const sourcePath = typeof payload?.filePath === 'string' ? payload.filePath.trim() : '';
      if (!sourcePath) {
        return false;
      }

      const extension = path.extname(sourcePath).toLowerCase();
      const mimeType = imagePreviewMimeType(extension);
      if (!mimeType) {
        throw new Error('当前仅支持另存常见图片格式。');
      }

      const sourceStat = await stat(sourcePath);
      if (!sourceStat.isFile()) {
        throw new Error('要另存的图片文件不存在。');
      }

      const targetWindow = BrowserWindow.fromWebContents(event.sender);
      const saveResult = targetWindow
        ? await dialog.showSaveDialog(targetWindow, buildSaveImageDialogOptions(sourcePath, extension))
        : await dialog.showSaveDialog(buildSaveImageDialogOptions(sourcePath, extension));

      if (saveResult.canceled || !saveResult.filePath) {
        return false;
      }

      if (path.resolve(saveResult.filePath) === path.resolve(sourcePath)) {
        return true;
      }

      await copyFile(sourcePath, saveResult.filePath);
      return true;
    },
  );

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
    'desktop:execute-window-action',
    (event, action: string) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      switch (action) {
        case 'quit':
          app.quit();
          break;
        case 'minimize':
          (win ?? BrowserWindow.getFocusedWindow())?.minimize();
          break;
        case 'maximize': {
          const w = win ?? BrowserWindow.getFocusedWindow();
          if (w) {
            if (w.isMaximized()) {
              w.unmaximize();
            } else {
              w.maximize();
            }
          }
          break;
        }
        case 'close':
          (win ?? BrowserWindow.getFocusedWindow())?.close();
          break;
        case 'toggleFullscreen': {
          const w = win ?? BrowserWindow.getFocusedWindow();
          if (w) {
            w.setFullScreen(!w.isFullScreen());
          }
          break;
        }
        case 'toggleDevTools':
          event.sender.toggleDevTools();
          break;
        case 'reload':
          event.sender.reload();
          break;
        case 'forceReload':
          event.sender.reloadIgnoringCache();
          break;
        case 'showAbout':
          void dialog.showMessageBox(win ?? BrowserWindow.getFocusedWindow()!, {
            type: 'info',
            title: 'Spirit Agent',
            message: 'Spirit Agent',
            detail: `版本 ${app.getVersion()}`,
          });
          break;
        default:
          break;
      }
    },
  );

  ipcMain.on('desktop:read-native-backdrop-blur', (event) => {
    event.returnValue = readBackdropBlurFromDisk();
  });

  ipcMain.handle('desktop:get-window-fullscreen', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window?.isFullScreen() ?? false;
  });

  ipcMain.handle(
    'desktop:sync-window-frame',
    (event, request: { dark: boolean; nativeTheme: 'system' | 'light' | 'dark' }) => {
      nativeTheme.themeSource = request.nativeTheme;
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        console.warn('[spirit-desktop] desktop:sync-window-frame: no BrowserWindow for sender');
        return;
      }
      applyNativeWindowBackdrop(window, request.dark);
    },
  );

  ipcMain.handle('desktop:sync-language', async (_event, lang: string) => {
    console.log('[spirit-desktop] language synced:', lang);
    try {
      await i18nHost.changeLanguage(lang);
    } catch {
      // ignore i18n errors
    }
    if (process.platform === 'darwin') {
      setMacOSApplicationMenu();
    }
  });

  ipcMain.handle(
    'desktop:pty-create',
    (
      event,
      request: { cwd: string; cols: number; rows: number },
    ): { ok: true; id: string; shellDisplayName: string } | { ok: false; error: string } => {
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

  ipcMain.handle('desktop:open-external-url', async (event, payload: { url?: string }) => {
    const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
    if (!url || !isAllowedExternalUrl(url)) {
      throw new Error('Invalid external URL');
    }
    if (event.sender.isDestroyed()) {
      return;
    }
    event.sender.send('desktop:browser-open-url', { url });
  });

  ipcMain.handle(
    'desktop:browser-page-sync',
    (
      event: IpcMainInvokeEvent,
      payload: {
        tabId?: string;
        bounds?: PageViewBounds;
        visible?: boolean;
        url?: string;
        devtoolsWidthPx?: number;
      },
    ) => {
      const tabId = payload?.tabId;
      if (typeof tabId !== 'string' || !tabId) {
        throw new Error('Invalid browser tab id');
      }
      const devtoolsWidthPx = payload?.devtoolsWidthPx;
      syncPageView(event.sender, {
        tabId,
        bounds: parsePageViewBounds(payload?.bounds),
        visible: payload?.visible === true,
        url: typeof payload?.url === 'string' ? payload.url : undefined,
        ...(typeof devtoolsWidthPx === 'number' && Number.isFinite(devtoolsWidthPx)
          ? { devtoolsWidthPx }
          : {}),
      });
    },
  );

  ipcMain.handle(
    'desktop:browser-page-nav',
    (
      event: IpcMainInvokeEvent,
      payload: {
        tabId?: string;
        action?: 'back' | 'forward' | 'reload' | 'load';
        url?: string;
      },
    ) => {
      const tabId = payload?.tabId;
      const action = payload?.action;
      if (typeof tabId !== 'string' || !tabId || !action) {
        throw new Error('Invalid browser page navigation request');
      }
      navigatePageView(event.sender, tabId, action, payload?.url);
    },
  );

  ipcMain.handle(
    'desktop:browser-page-toggle-devtools',
    (event: IpcMainInvokeEvent, payload: { tabId?: string }) => {
      const tabId = payload?.tabId;
      if (typeof tabId !== 'string' || !tabId) {
        throw new Error('Invalid browser tab id');
      }
      return togglePageDevTools(event.sender, tabId);
    },
  );

  ipcMain.handle(
    'desktop:browser-page-set-devtools-width',
    (event: IpcMainInvokeEvent, payload: { tabId?: string; widthPx?: number }) => {
      const tabId = payload?.tabId;
      const widthPx = payload?.widthPx;
      if (typeof tabId !== 'string' || !tabId) {
        throw new Error('Invalid browser tab id');
      }
      if (typeof widthPx !== 'number' || !Number.isFinite(widthPx)) {
        throw new Error('Invalid DevTools width');
      }
      return setPageDevtoolsWidth(event.sender, tabId, widthPx);
    },
  );

  ipcMain.handle(
    'desktop:browser-page-execute',
    async (
      event: IpcMainInvokeEvent,
      payload: {
        tabId?: string;
        kind?: 'script' | 'insert-css' | 'remove-css';
        script?: string;
        css?: string;
        cssKey?: string;
      },
    ) => {
      const tabId = payload?.tabId;
      if (typeof tabId !== 'string' || !tabId) {
        throw new Error('Invalid browser tab id');
      }
      switch (payload?.kind) {
        case 'insert-css': {
          const css = payload?.css;
          if (typeof css !== 'string') {
            throw new Error('Invalid CSS payload');
          }
          return insertCssInPageView(event.sender, tabId, css);
        }
        case 'remove-css': {
          const cssKey = payload?.cssKey;
          if (typeof cssKey !== 'string') {
            throw new Error('Invalid CSS key');
          }
          await removeInsertedCssInPageView(event.sender, tabId, cssKey);
          return;
        }
        case 'script':
        default: {
          const script = payload?.script;
          if (typeof script !== 'string') {
            throw new Error('Invalid script payload');
          }
          return executeInPageView(event.sender, tabId, script);
        }
      }
    },
  );

  ipcMain.handle(
    'desktop:browser-page-capture',
    async (
      event: IpcMainInvokeEvent,
      payload: { tabId?: string; rect?: PageViewBounds },
    ) => {
      const tabId = payload?.tabId;
      if (typeof tabId !== 'string' || !tabId) {
        throw new Error('Invalid browser tab id');
      }
      return capturePageView(event.sender, tabId, parsePageViewBounds(payload?.rect));
    },
  );

  ipcMain.handle(
    'desktop:browser-page-destroy',
    (event: IpcMainInvokeEvent, payload: { tabId?: string }) => {
      const tabId = payload?.tabId;
      if (typeof tabId !== 'string' || !tabId) {
        throw new Error('Invalid browser tab id');
      }
      destroyPageView(event.sender, tabId);
    },
  );

  ipcMain.handle('desktop:list-local-listeners', () => {
    const cached = getCachedLocalListeningEndpoints();
    if (cached !== null) return cached;
    return getScanningPromise() ?? [];
  });

  ipcMain.on('desktop:scan-local-listeners', (event) => {
    const { sender } = event;
    void startLocalListenersScan((item) => {
      if (!sender.isDestroyed()) {
        sender.send('desktop:local-listener-found', item);
      }
    }).then(() => {
      if (!sender.isDestroyed()) {
        sender.send('desktop:local-listeners-done');
      }
    });
  });

  ipcMain.handle('desktop:show-notification', async (_event, payload: DesktopNotificationPayload) => {
    if (!getAppAwayFromUser()) {
      return false;
    }
    if (!payload || typeof payload.title !== 'string' || !payload.title.trim()) {
      return false;
    }
    return showDesktopNotification(payload);
  });

  ipcMain.handle('desktop:get-app-away', () => getAppAwayFromUser());

  ipcMain.handle('desktop:report-renderer-visibility', (_event, payload: { hidden?: boolean }) => {
    setRendererVisibility(payload?.hidden === true);
    return getAppAwayFromUser();
  });

  ipcMain.handle(
    'desktop:sync-attention-pending',
    (
      _event,
      payload: { needsApproval?: boolean; needsQuestions?: boolean; needsTaskComplete?: boolean },
    ) => {
      setDesktopAttentionPending({
        needsApproval: payload?.needsApproval === true,
        needsQuestions: payload?.needsQuestions === true,
        needsTaskComplete: payload?.needsTaskComplete === true,
      });
      refreshDesktopAttention(getAppAwayFromUser());
    },
  );

  await syncInitialDesktopWebHost();
  await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
  });
}

app.on('before-quit', (event) => {
  unsubscribeDesktopDreamUpdates?.();
  unsubscribeDesktopDreamUpdates = undefined;
  unsubscribeDesktopAutomationsUpdates?.();
  unsubscribeDesktopAutomationsUpdates = undefined;
  unsubscribeDesktopSessionListUpdates?.();
  unsubscribeDesktopSessionListUpdates = undefined;
  if (quittingAfterDesktopWebHostStop || !desktopWebHost?.isRunning()) {
    return;
  }

  event.preventDefault();
  quittingAfterDesktopWebHostStop = true;
  void stopDesktopWebHostIfRunning().finally(() => {
    app.quit();
  });
});

function imagePreviewMimeType(extension: string): string | undefined {
  switch (extension) {
    case '.bmp':
      return 'image/bmp';
    case '.gif':
      return 'image/gif';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return undefined;
  }
}

function videoPreviewMimeType(extension: string): string | null {
  switch (extension) {
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.mpeg':
    case '.mpg':
      return 'video/mpeg';
    default:
      return null;
  }
}

async function readLocalVideoPreviewUrlFromPath(filePath: string): Promise<string | null> {
  const extension = path.extname(filePath).toLowerCase();
  if (!videoPreviewMimeType(extension)) {
    return null;
  }

  try {
    const managedRoot = path.join(spiritAgentDataDir(), MANAGED_GENERATED_VIDEOS_DIR);
    const [rootStats, candidateStats] = await Promise.all([lstat(managedRoot), lstat(filePath)]);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      return null;
    }
    if (!candidateStats.isFile() || candidateStats.isSymbolicLink()) {
      return null;
    }

    const [canonicalRoot, canonicalPath] = await Promise.all([realpath(managedRoot), realpath(filePath)]);
    if (!pathIsWithinRoot(canonicalPath, canonicalRoot)) {
      return null;
    }

    return managedGeneratedVideoRefFromPath(canonicalPath);
  } catch {
    return null;
  }
}

function managedGeneratedVideoRefFromPath(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase();
  if (!videoPreviewMimeType(extension)) {
    return null;
  }

  const assetId = path.basename(filePath);
  if (!assetId || assetId === '.' || assetId === '..') {
    return null;
  }

  return `${MANAGED_ASSET_PROTOCOL}//${MANAGED_ASSET_HOST}/video/${encodeURIComponent(assetId)}`;
}

async function readImagePreviewDataUrlFromPath(filePath: string): Promise<string | null> {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = imagePreviewMimeType(extension);
  if (!mimeType) {
    return null;
  }

  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile() || metadata.size > LOCAL_IMAGE_PREVIEW_MAX_BYTES) {
      return null;
    }

    const bytes = await readFile(filePath);
    return `data:${mimeType};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

async function resolveManagedGeneratedAssetPath(reference: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(reference);
  } catch {
    return null;
  }

  if (url.protocol !== MANAGED_ASSET_PROTOCOL || url.hostname !== MANAGED_ASSET_HOST) {
    return null;
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    return null;
  }

  const segments = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  if (segments.length !== 2) {
    return null;
  }

  const kind = segments[0]?.toLowerCase();
  if (kind !== 'image' && kind !== 'video') {
    return null;
  }

  let assetId: string;
  try {
    assetId = decodeURIComponent(segments[1] ?? '').trim();
  } catch {
    return null;
  }
  if (!assetId || assetId !== path.basename(assetId) || assetId === '.' || assetId === '..') {
    return null;
  }

  const managedDir = kind === 'image' ? MANAGED_GENERATED_IMAGES_DIR : MANAGED_GENERATED_VIDEOS_DIR;
  const managedRoot = path.join(spiritAgentDataDir(), managedDir);
  const candidatePath = path.join(managedRoot, assetId);

  try {
    const [rootStats, candidateStats] = await Promise.all([lstat(managedRoot), lstat(candidatePath)]);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      return null;
    }
    if (!candidateStats.isFile() || candidateStats.isSymbolicLink()) {
      return null;
    }

    const [canonicalRoot, canonicalPath] = await Promise.all([realpath(managedRoot), realpath(candidatePath)]);
    if (!pathIsWithinRoot(canonicalPath, canonicalRoot)) {
      return null;
    }

    return canonicalPath;
  } catch {
    return null;
  }
}

function pathIsWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function buildSaveImageDialogOptions(sourcePath: string, extension: string): Electron.SaveDialogOptions {
  const normalizedExtension = extension.startsWith('.') ? extension.slice(1) : extension;
  return {
    defaultPath: path.basename(sourcePath),
    filters: [
      {
        name: 'Image',
        extensions: normalizedExtension ? [normalizedExtension] : ['png'],
      },
      {
        name: 'All Files',
        extensions: ['*'],
      },
    ],
  };
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});