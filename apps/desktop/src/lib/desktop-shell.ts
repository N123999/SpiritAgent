/** 当前 Desktop Electron 宿主平台；Web 或未注入 preload 时为 `undefined`。 */
export function desktopShellPlatform(): NodeJS.Platform | undefined {
  return typeof window !== "undefined" ? window.spiritDesktop?.platform : undefined;
}

export function isNativeBackdropBlurPlatform(
  platform: NodeJS.Platform | undefined,
): platform is "win32" | "darwin" {
  return platform === "win32" || platform === "darwin";
}

/** Windows Mica / macOS Vibrancy 等原生模糊是否可用。 */
export function isNativeBackdropBlurSupported(): boolean {
  return isNativeBackdropBlurPlatform(desktopShellPlatform());
}

export function isElectronChrome(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.spiritDesktop) {
    return true;
  }
  return typeof navigator !== "undefined" && /\bElectron\//.test(navigator.userAgent);
}

/** 与 Electron `readBackdropBlurFromDisk` 对齐；首屏 snapshot 未就绪时用于避免误开 Mica 透明层。 */
export function readStoredNativeBackdropBlur(): boolean {
  if (!isNativeBackdropBlurSupported()) {
    return false;
  }
  try {
    return window.spiritDesktop?.readNativeBackdropBlur() !== false;
  } catch {
    return true;
  }
}

export function resolveUseMicaBackdrop(windowsMica: boolean | undefined): boolean {
  if (!isNativeBackdropBlurSupported()) {
    return false;
  }
  if (windowsMica === undefined) {
    return readStoredNativeBackdropBlur();
  }
  return windowsMica !== false;
}

/** 首屏前写入 Desktop 原生壳 class，避免启动层在 snapshot 就绪前误用 Mica 透明样式。 */
export function applyDesktopNativeChromeToDocument(): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  const native = isElectronChrome();
  const mica = native && readStoredNativeBackdropBlur();
  root.classList.toggle("spirit-desktop-native", native);
  root.classList.toggle("spirit-desktop-mica", mica);
  // 与 LaunchSplash 同步：首帧即隐藏 Mica 下的主布局，避免 useEffect 前闪白。
  root.classList.toggle("spirit-launch-splash-active", mica);
}

/** LaunchSplash 挂载/卸载时同步 html 上的启动层 class（须与 styles.css 规则一致）。 */
export function syncLaunchSplashChromeToDocument(
  phase: "running" | "leaving" | "gone",
): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  if (phase === "gone") {
    root.classList.remove("spirit-launch-splash-active", "spirit-launch-splash-exiting");
    return;
  }
  root.classList.add("spirit-launch-splash-active");
  root.classList.toggle("spirit-launch-splash-exiting", phase === "leaving");
}

/** 当前宿主是否为 macOS（Electron preload 注入的平台值）。 */
export function isMacDesktopPlatform(): boolean {
  return desktopShellPlatform() === "darwin";
}

/**
 * 根据当前平台格式化快捷键标签。
 * - macOS: `mod` → `⌘`，拼接无分隔符（如 `⌘N`）
 * - Windows / Linux: `mod` → `Ctrl`，用 `+` 拼接（如 `Ctrl+N`）
 */
export function shortcutLabel(key: string): string {
  const letter = key.toUpperCase();
  return isMacDesktopPlatform() ? `⌘${letter}` : `Ctrl+${letter}`;
}

/** Physical Ctrl + letter shortcut keys for tooltip Kbd chips (not Cmd on macOS). */
export function ctrlLetterShortcutKbdKeys(key: string): readonly string[] {
  const letter = key.toUpperCase();
  return isMacDesktopPlatform() ? ['⌃', letter] : ['Ctrl', letter];
}

/** Cmd/Ctrl + letter shortcut keys for tooltip Kbd chips. */
export function modLetterShortcutKbdKeys(key: string): readonly string[] {
  const letter = key.toUpperCase();
  return isMacDesktopPlatform() ? ["⌘", letter] : ["Ctrl", letter];
}

/** Alt+Cmd / Ctrl+Alt + letter shortcut keys for tooltip Kbd chips. */
export function modAltLetterShortcutKbdKeys(key: string): readonly string[] {
  const letter = key.toUpperCase();
  return isMacDesktopPlatform() ? ["⌥", "⌘", letter] : ["Ctrl", "Alt", letter];
}

/** Cmd/Ctrl + / shortcut keys for tooltip Kbd chips. */
export function modSlashShortcutKbdKeys(): readonly string[] {
  return isMacDesktopPlatform() ? ["⌘", "/"] : ["Ctrl", "/"];
}

/** Cmd/Ctrl + / shortcut label for the model picker. */
export function modSlashShortcutLabel(): string {
  const keys = modSlashShortcutKbdKeys();
  return isMacDesktopPlatform() ? keys.join("") : keys.join("+");
}

type KeyboardModifierState = Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey">;

/** Whether the platform primary shortcut modifier (⌘ on macOS, Ctrl elsewhere) is held. */
export function isModShortcutPressed(event: KeyboardModifierState): boolean {
  return isMacDesktopPlatform() ? event.metaKey : event.ctrlKey;
}

/** Whether Alt + primary shortcut modifier is held (⌥⌘ on macOS, Ctrl+Alt elsewhere). */
export function isModAltShortcutPressed(event: KeyboardModifierState): boolean {
  if (!event.altKey) {
    return false;
  }
  return isModShortcutPressed(event);
}

/** Windows Electron：使用 `titleBarOverlay` + 自绘顶栏；macOS 仍走系统菜单栏 */
export function isWin32ElectronShell(): boolean {
  if (!isElectronChrome() || typeof navigator === "undefined") {
    return false;
  }
  return /Windows/i.test(navigator.userAgent);
}

/** macOS Electron：`titleBarStyle: hiddenInset`，需预留红绿灯安全区 */
export function isDarwinElectronShell(): boolean {
  if (!isElectronChrome()) {
    return false;
  }
  return window.spiritDesktop?.platform === "darwin";
}
