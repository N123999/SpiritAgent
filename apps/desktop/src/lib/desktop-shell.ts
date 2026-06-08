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
