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
  root.classList.toggle("spirit-desktop-native", native);
  root.classList.toggle("spirit-desktop-mica", native && readStoredNativeBackdropBlur());
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
