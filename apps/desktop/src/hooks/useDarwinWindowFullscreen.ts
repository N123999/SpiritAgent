import { useSyncExternalStore } from "react";

function subscribeDarwinFullscreenClass(onStoreChange: () => void): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getDarwinFullscreenFromDocument(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.documentElement.classList.contains("spirit-desktop-darwin-fullscreen");
}

/**
 * macOS 全屏态：与 `useDesktopShellEffects` 写入的 `spirit-desktop-darwin-fullscreen` 同步，
 * 不重复订阅 Electron IPC（红绿灯安全区 CSS 仍由 shell effects 维护）。
 */
export function useDarwinWindowFullscreen(enabled: boolean): boolean {
  return useSyncExternalStore(
    enabled ? subscribeDarwinFullscreenClass : () => () => {},
    () => (enabled ? getDarwinFullscreenFromDocument() : false),
    () => false,
  );
}
