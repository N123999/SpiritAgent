export const THEME_STORAGE_KEY = "spirit-agent-desktop-theme" as const;

export type ThemePreference = "system" | "light" | "dark";

const VALID: readonly ThemePreference[] = ["system", "light", "dark"];

function isThemePreference(v: string): v is ThemePreference {
  return (VALID as readonly string[]).includes(v);
}

export function getStoredTheme(): ThemePreference {
  if (typeof localStorage === "undefined") {
    return "system";
  }
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  if (raw && isThemePreference(raw)) {
    return raw;
  }
  return "system";
}

export function setStoredTheme(pref: ThemePreference): void {
  localStorage.setItem(THEME_STORAGE_KEY, pref);
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveDark(pref: ThemePreference): boolean {
  if (pref === "dark") {
    return true;
  }
  if (pref === "light") {
    return false;
  }
  return systemPrefersDark();
}

export function desktopNativeThemeForPreference(
  pref: ThemePreference,
): "light" | "dark" | "system" {
  if (pref === "system") {
    return "system";
  }
  if (pref === "dark") {
    return "dark";
  }
  return "light";
}

/** 在 `document.documentElement` 上切换 `dark` 类，与 shadcn / tw-animate 的 `.dark` 变体一致。 */
export function applyThemeToDocument(pref: ThemePreference): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.classList.toggle("dark", resolveDark(pref));
  const nativeTheme = desktopNativeThemeForPreference(pref);
  syncDesktopWindowFrame(resolveDark(pref), nativeTheme);
}

/** 与 Tauri `sync_tauri_frame_styling` 对齐：同一 IPC 内先设 `nativeTheme.themeSource` 再刷背景，避免与系统主题错位。 */
export function syncDesktopWindowFrame(
  dark: boolean,
  nativeTheme: "system" | "light" | "dark",
): void {
  if (typeof window === "undefined" || !window.spiritDesktop) {
    if (
      typeof navigator !== "undefined" &&
      /\bElectron\//.test(navigator.userAgent) &&
      import.meta.env.DEV
    ) {
      console.warn(
        "[spirit-desktop] 无 spiritDesktop 预加载桥，窗口/Mica IPC 未发送（检查 preload 与 webPreferences）",
      );
    }
    return;
  }
  void window.spiritDesktop.syncWindowFrame({ dark, nativeTheme }).catch((err) => {
    console.error("[spirit-desktop] syncWindowFrame IPC 失败:", err);
  });
}
