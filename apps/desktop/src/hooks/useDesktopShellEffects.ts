import { useEffect } from "react";

import i18n from "@/lib/i18n";
import {
  desktopNativeThemeForPreference,
  resolveDark,
  syncDesktopWindowFrame,
  type ThemePreference,
} from "@/lib/theme";
import type { DesktopExtensionCssLayer } from "@/types";

export type UseDesktopShellEffectsOptions = {
  isElectronShell: boolean;
  darwinElectronChrome: boolean;
  useMicaBackdrop: boolean;
  theme: ThemePreference;
  extensionCss: DesktopExtensionCssLayer[] | undefined;
  windowsMica: boolean | undefined;
};

export function useDesktopShellEffects({
  isElectronShell,
  darwinElectronChrome,
  useMicaBackdrop,
  theme,
  extensionCss,
  windowsMica,
}: UseDesktopShellEffectsOptions) {
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    if (isElectronShell) {
      document.documentElement.classList.add("spirit-desktop-native");
    } else {
      document.documentElement.classList.remove("spirit-desktop-native");
    }
  }, [isElectronShell]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    if (darwinElectronChrome) {
      document.documentElement.classList.add("spirit-desktop-darwin");
    } else {
      document.documentElement.classList.remove("spirit-desktop-darwin");
      document.documentElement.classList.remove("spirit-desktop-darwin-fullscreen");
    }
  }, [darwinElectronChrome]);

  useEffect(() => {
    if (!darwinElectronChrome || typeof document === "undefined") {
      return;
    }
    const bridge = window.spiritDesktop;
    if (!bridge?.getWindowFullScreen || !bridge.subscribeWindowFullScreen) {
      return;
    }
    const applyFullscreenChrome = (fullScreen: boolean) => {
      document.documentElement.classList.toggle("spirit-desktop-darwin-fullscreen", fullScreen);
    };
    void bridge.getWindowFullScreen().then(applyFullscreenChrome);
    return bridge.subscribeWindowFullScreen(applyFullscreenChrome);
  }, [darwinElectronChrome]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    if (useMicaBackdrop) {
      document.documentElement.classList.add("spirit-desktop-mica");
    } else {
      document.documentElement.classList.remove("spirit-desktop-mica");
    }
  }, [useMicaBackdrop]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const styleNodes = Array.from(
      document.head.querySelectorAll<HTMLStyleElement>('style[data-spirit-extension-css="true"]'),
    );
    for (const node of styleNodes) {
      node.remove();
    }

    const layers = extensionCss ?? [];
    for (const layer of layers) {
      const style = document.createElement("style");
      style.dataset.spiritExtensionCss = "true";
      style.dataset.extensionId = layer.extensionId;
      style.dataset.sourcePath = layer.sourcePath;
      if (layer.media) {
        style.media = layer.media;
      }
      style.textContent = layer.cssText;
      document.head.append(style);
    }

    return () => {
      for (const node of document.head.querySelectorAll<HTMLStyleElement>('style[data-spirit-extension-css="true"]')) {
        node.remove();
      }
    };
  }, [extensionCss]);

  // Align with persisted `config.windows_mica` (host syncs one frame on save; re-sync border via `html.dark` here).
  useEffect(() => {
    if (!isElectronShell) {
      return;
    }
    syncDesktopWindowFrame(resolveDark(theme), desktopNativeThemeForPreference(theme));
    // Theme changes are synced by `applyThemeToDocument`; this effect tracks mica config only.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- windowsMica / native blur host only
  }, [isElectronShell, windowsMica]);

  useEffect(() => {
    if (!isElectronShell) {
      return;
    }
    void window.spiritDesktop?.syncLanguage?.(i18n.language);
  }, [isElectronShell]);
}
