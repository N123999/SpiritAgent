import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ArrowLeft, ArrowRight, PenTool, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeBrowserUrl, toLocalHostUrl } from "@/lib/browser-url";
import {
  BROWSER_NEW_TAB_SENTINEL,
  isBrowserNewTabUrl,
} from "@/lib/workspace-tool-tabs";
import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import { truncateOuterHtml } from "@/lib/browser-element-attachment";
import {
  applyPickerOverlayBox,
  buildPickerInjectScript,
  clearPickerOverlayInlineStyles,
  hidePickerOverlayBox,
  PICKER_INJECT_CSS,
  pickerRectsEqual,
  type PickerMarqueeResult,
  type PickerOverlayMode,
} from "@/lib/browser-element-picker";
import { cn } from "@/lib/utils";

export type WorkspaceBrowserTabProps = {
  browserUrl: string | undefined;
  onBrowserUrlChange(url: string): void;
  /** 站外 / 新窗口链接：在工作区新建浏览器标签并打开 */
  onOpenUrlInNewTab?: (url: string) => void;
  /** 当前网页标题变化时通知父层；切到新标签页时传 undefined */
  onTitleChange?: (title: string | undefined) => void;
  /** 用户选中元素后的回调 */
  onElementPicked?: (attachment: BrowserElementAttachment) => void;
  /** Electron 桌面宿主为 true；Web Host 为 false（即使 UA 为 Electron 也不嵌入 webview） */
  browserTabEnabled?: boolean;
};

type LocalListeningEndpoint = {
  port: number;
  address?: string;
  processName?: string;
  url?: string;
  title?: string;
};

type WebviewElement = HTMLElement & {
  src?: string;
  getURL?(): string;
  getWebContentsId?(): number;
  canGoBack?(): boolean;
  canGoForward?(): boolean;
  goBack?(): void;
  goForward?(): void;
  reload?(): void;
  executeJavaScript?(code: string): Promise<unknown>;
  insertCSS?(css: string): Promise<string>;
  removeInsertedCSS?(key: string): Promise<void>;
};

function isElectronDesktop(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.spiritDesktop) {
    return true;
  }
  return typeof navigator !== "undefined" && /\bElectron\//.test(navigator.userAgent);
}

function canUseEmbeddedBrowser(): boolean {
  return isElectronDesktop();
}

function safeWebviewCall<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function safeWebviewGetUrl(el: WebviewElement): string {
  return safeWebviewCall(() => el.getURL?.() ?? "", "");
}

function BrowserNewTabPage({
  onNavigate,
}: {
  onNavigate(url: string): void;
}) {
  const { t } = useTranslation();
  const [endpoints, setEndpoints] = useState<LocalListeningEndpoint[]>([]);
  const [scanning, setScanning] = useState(false);

  const addEndpoint = useCallback((item: LocalListeningEndpoint) => {
    setEndpoints((prev) => {
      if (prev.some((e) => e.port === item.port)) return prev;
      return [...prev, item].sort((a, b) => a.port - b.port);
    });
  }, []);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge) return;

    void bridge.listLocalListeningEndpoints().then((items) => {
      setEndpoints((prev) => {
        const merged = [...prev];
        for (const item of items) {
          if (!merged.some((e) => e.port === item.port)) merged.push(item);
        }
        merged.sort((a, b) => a.port - b.port);
        return merged;
      });
    });

    if (!bridge.subscribeLocalListeners) return;
    const unsubscribe = bridge.subscribeLocalListeners({
      onFound: addEndpoint,
      onDone: () => setScanning(false),
    });

    return unsubscribe;
  }, [addEndpoint]);

  const handleRefresh = useCallback(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.scanLocalListeners) return;
    setEndpoints([]);
    setScanning(true);
    bridge.scanLocalListeners();
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{t("workspace.browserNewTabTitle")}</h3>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="electron-no-drag h-7 gap-1 px-2 text-xs"
          disabled={scanning}
          onClick={handleRefresh}
        >
          <RefreshCw className={cn("size-3.5", scanning && "animate-spin")} aria-hidden />
          {t("workspace.browserRefreshPorts")}
        </Button>
      </div>
      {endpoints.length === 0 && scanning ? (
        <p className="text-muted-foreground">{t("workspace.browserScanningPorts")}</p>
      ) : endpoints.length === 0 ? (
        <p className="text-muted-foreground">{t("workspace.browserNoLocalPorts")}</p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {endpoints.map((item) => {
            const url = item.url ?? toLocalHostUrl(item.port);
            const subtitle = [item.address, item.processName].filter(Boolean).join(" · ");
            const displayTitle = item.title || url;
            const displaySubtitle = item.title ? url : subtitle;
            return (
              <li key={`${item.port}-${url}`}>
                <button
                  type="button"
                  className={cn(
                    "electron-no-drag w-full rounded-md border border-border/50 px-2.5 py-2 text-left",
                    "hover:bg-foreground/[0.04] dark:hover:bg-foreground/10",
                  )}
                  onClick={() => onNavigate(url)}
                >
                  <span className="block truncate font-medium text-foreground">{displayTitle}</span>
                  {displaySubtitle ? (
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {displaySubtitle}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function WorkspaceBrowserTab({
  browserUrl,
  onBrowserUrlChange,
  onOpenUrlInNewTab,
  onTitleChange,
  onElementPicked,
  browserTabEnabled = false,
}: WorkspaceBrowserTabProps) {
  const { t } = useTranslation();
  const webviewRef = useRef<WebviewElement | null>(null);
  const pickerOverlayRef = useRef<HTMLDivElement>(null);
  const showNewTab = isBrowserNewTabUrl(browserUrl);
  const [addressDraft, setAddressDraft] = useState("");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [lastVisitedUrl, setLastVisitedUrl] = useState<string | undefined>(undefined);
  const [isPickerActive, setIsPickerActive] = useState(false);
  const [overlayRect, setOverlayRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [overlayMode, setOverlayMode] = useState<PickerOverlayMode | null>(null);
  const onElementPickedRef = useRef(onElementPicked);
  useLayoutEffect(() => {
    onElementPickedRef.current = onElementPicked;
  });
  const canEmbed = browserTabEnabled && canUseEmbeddedBrowser();
  const onTitleChangeRef = useRef(onTitleChange);
  useLayoutEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  });
  const prevBrowserUrlRef = useRef(browserUrl);
  const onOpenUrlInNewTabRef = useRef(onOpenUrlInNewTab);
  useLayoutEffect(() => {
    onOpenUrlInNewTabRef.current = onOpenUrlInNewTab;
  });

  const syncNavState = useCallback(() => {
    const el = webviewRef.current;
    if (!el) {
      setCanGoBack(false);
      setCanGoForward(false);
      return;
    }
    const back = safeWebviewCall(() => el.canGoBack?.() ?? false, false);
    const forward = safeWebviewCall(() => el.canGoForward?.() ?? false, false);
    setCanGoBack((prev) => (prev === back ? prev : back));
    setCanGoForward((prev) => (prev === forward ? prev : forward));
  }, []);

  useEffect(() => {
    const prevUrl = prevBrowserUrlRef.current;
    prevBrowserUrlRef.current = browserUrl;
    if (showNewTab) {
      setAddressDraft("");
      const prevWasRealUrl = prevUrl && !isBrowserNewTabUrl(prevUrl);
      if (prevWasRealUrl) {
        onTitleChangeRef.current?.(undefined);
      }
      return;
    }
    setAddressDraft(browserUrl ?? "");
    if (browserUrl) {
      setLastVisitedUrl(browserUrl);
    }
  }, [browserUrl, showNewTab]);

  const submitAddress = useCallback(() => {
    const normalized = normalizeBrowserUrl(addressDraft);
    if (!normalized) {
      return;
    }
    onBrowserUrlChange(normalized);
  }, [addressDraft, onBrowserUrlChange]);

  useLayoutEffect(() => {
    if (showNewTab || !canEmbed) {
      return;
    }
    const el = webviewRef.current;
    if (!el) {
      return;
    }

    const scheduleSyncNavState = () => {
      queueMicrotask(() => syncNavState());
    };

    const onDidNavigate = (event: Event) => {
      const url = (event as Event & { url?: string }).url;
      if (url && url !== "about:blank") {
        setAddressDraft(url);
      }
      scheduleSyncNavState();
    };

    const onDidStopLoading = () => {
      const url = safeWebviewGetUrl(el);
      if (url && url !== "about:blank") {
        setAddressDraft(url);
      }
      scheduleSyncNavState();
    };

    const onNewWindow = (event: Event) => {
      const detail = event as Event & { url?: string; preventDefault?: () => void };
      detail.preventDefault?.();
      const url = detail.url;
      if (url) {
        onOpenUrlInNewTabRef.current?.(url);
      }
    };

    const onPageTitleUpdated = (event: Event) => {
      const title = (event as Event & { title?: string }).title;
      onTitleChangeRef.current?.(title || undefined);
    };

    el.addEventListener("did-navigate", onDidNavigate);
    el.addEventListener("did-navigate-in-page", onDidNavigate);
    el.addEventListener("did-stop-loading", onDidStopLoading);
    el.addEventListener("new-window", onNewWindow);
    el.addEventListener("dom-ready", scheduleSyncNavState);
    el.addEventListener("page-title-updated", onPageTitleUpdated);

    return () => {
      el.removeEventListener("did-navigate", onDidNavigate);
      el.removeEventListener("did-navigate-in-page", onDidNavigate);
      el.removeEventListener("did-stop-loading", onDidStopLoading);
      el.removeEventListener("new-window", onNewWindow);
      el.removeEventListener("dom-ready", scheduleSyncNavState);
      el.removeEventListener("page-title-updated", onPageTitleUpdated);
    };
  }, [browserUrl, canEmbed, showNewTab, syncNavState]);

  const exitPicker = useCallback(() => {
    setIsPickerActive(false);
    setOverlayRect(null);
    setOverlayMode(null);
  }, []);

  useEffect(() => {
    if (isPickerActive) exitPicker();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserUrl]);

  useEffect(() => {
    const el = webviewRef.current;
    if (!isPickerActive || showNewTab || !canEmbed || !el) return;

    void el.executeJavaScript?.(buildPickerInjectScript());

    let cssKey: string | undefined;
    void el.insertCSS?.(PICKER_INJECT_CSS).then((key) => {
      cssKey = key;
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitPicker();
    };
    window.addEventListener('keydown', handleKeyDown, true);

    let frameId = 0;
    let cancelled = false;
    let syncInFlight = false;

    const tick = () => {
      if (cancelled) return;
      frameId = requestAnimationFrame(tick);
      if (syncInFlight) return;

      syncInFlight = true;
      void (async () => {
        try {
          const done = await el.executeJavaScript?.("window.__spiritPickerDone || false");
          if (done) {
            const result = await el.executeJavaScript?.("window.__spiritPickerResult");
            await el.executeJavaScript?.(
              "if(window.__spiritPickerCleanup){window.__spiritPickerCleanup();window.__spiritPickerCleanup=null;}window.__spiritPickerDone=false;",
            );
            const r = result as PickerMarqueeResult | null;
            if (r && r.tagName && r.outerHTML && !cancelled) {
              const webContentsId = safeWebviewCall(() => el.getWebContentsId?.(), undefined);
              const bridge = window.spiritDesktop;
              if (webContentsId && bridge?.captureWebviewRect) {
                try {
                  const base64 = await bridge.captureWebviewRect(webContentsId, {
                    x: r.x,
                    y: r.y,
                    width: Math.max(r.width, 1),
                    height: Math.max(r.height, 1),
                  });
                  if (!cancelled) {
                    onElementPickedRef.current?.({
                      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                      tagName: r.tagName.toLowerCase(),
                      outerHtml: truncateOuterHtml(r.outerHTML),
                      screenshotDataUrl: `data:image/png;base64,${base64}`,
                      pageUrl: safeWebviewGetUrl(el) || browserUrl || "",
                    });
                  }
                } catch (err) {
                  console.warn("[picker] capturePage failed:", err);
                }
              }
              exitPicker();
              return;
            }
          } else {
            const snapshot = await el.executeJavaScript?.(
              "({ rect: window.__spiritPickerRect, mode: window.__spiritPickerRectMode })",
            );
            const { rect, mode } = (snapshot ?? {}) as {
              rect: { x: number; y: number; width: number; height: number } | null;
              mode: PickerOverlayMode | null;
            };
            if (cancelled) return;

            const overlayEl = pickerOverlayRef.current;

            if (rect && overlayEl && (mode === "element" || mode === "marquee")) {
              applyPickerOverlayBox(overlayEl, rect);
              setOverlayMode((prev) => (prev === mode ? prev : mode));
              if (mode === "element") {
                setOverlayRect((prev) => (pickerRectsEqual(prev, rect) ? prev : rect));
              }
              return;
            }

            if (overlayEl) {
              hidePickerOverlayBox(overlayEl);
            }
            setOverlayRect((prev) => (prev === null ? prev : null));
            setOverlayMode((prev) => (prev === null ? prev : null));
          }
        } catch {
          // webview may not be ready
        } finally {
          syncInFlight = false;
        }
      })();
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", handleKeyDown, true);
      void el.executeJavaScript?.(
        "if(window.__spiritPickerCleanup){window.__spiritPickerCleanup();window.__spiritPickerCleanup=null;}window.__spiritPickerDone=false;",
      );
      if (cssKey) void el.removeInsertedCSS?.(cssKey);
      const overlayEl = pickerOverlayRef.current;
      if (overlayEl) clearPickerOverlayInlineStyles(overlayEl);
      setOverlayRect(null);
      setOverlayMode(null);
    };
  }, [isPickerActive, showNewTab, canEmbed, browserUrl, exitPicker]);

  const handleGoBack = useCallback(() => {
    const el = webviewRef.current;
    if (safeWebviewCall(() => el?.canGoBack?.() ?? false, false)) {
      safeWebviewCall(() => {
        el?.goBack?.();
      }, undefined);
    } else {
      onBrowserUrlChange(BROWSER_NEW_TAB_SENTINEL);
    }
  }, [onBrowserUrlChange]);

  const handleGoForward = useCallback(() => {
    if (showNewTab && lastVisitedUrl) {
      onBrowserUrlChange(lastVisitedUrl);
      return;
    }
    webviewRef.current?.goForward?.();
  }, [showNewTab, lastVisitedUrl, onBrowserUrlChange]);

  const handleReload = useCallback(() => {
    if (showNewTab) {
      return;
    }
    webviewRef.current?.reload?.();
  }, [showNewTab]);

  const navDisabled = showNewTab;

  if (!canEmbed) {
    return (
      <div className="p-3 text-muted-foreground">
        <p>{t("workspace.browserElectronOnly")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="electron-no-drag flex shrink-0 items-center gap-0.5 border-b border-border/40 px-1.5 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0"
          aria-label={t("workspace.browserBack")}
          disabled={navDisabled}
          onClick={handleGoBack}
        >
          <ArrowLeft className="size-3.5" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0"
          aria-label={t("workspace.browserForward")}
          disabled={showNewTab ? !lastVisitedUrl : !canGoForward}
          onClick={handleGoForward}
        >
          <ArrowRight className="size-3.5" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0"
          aria-label={t("workspace.browserReload")}
          disabled={navDisabled}
          onClick={handleReload}
        >
          <RefreshCw className="size-3.5" aria-hidden />
        </Button>
        <Input
          value={addressDraft}
          aria-label={t("workspace.browserAddressBar")}
          placeholder={t("workspace.browserAddressBarPlaceholder")}
          className={cn(
            "h-7 min-w-0 flex-1 border-0 bg-transparent px-2 text-xs shadow-none",
            "focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent",
          )}
          onChange={(event) => setAddressDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitAddress();
            }
          }}
        />
        {!showNewTab && onElementPicked ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(
              "size-7 shrink-0",
              isPickerActive && "bg-accent text-accent-foreground",
            )}
            aria-label={t("workspace.browserPickerToggle")}
            aria-pressed={isPickerActive}
            onClick={() => setIsPickerActive((v) => !v)}
          >
            <PenTool className="size-3.5" aria-hidden />
          </Button>
        ) : null}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {showNewTab ? (
          <BrowserNewTabPage onNavigate={onBrowserUrlChange} />
        ) : (
          <>
            <webview
              ref={webviewRef as React.RefObject<HTMLElement>}
              src={browserUrl}
              allowpopups={true}
              className={cn(
                "electron-no-drag h-full w-full flex-1 border-0 bg-background",
                isPickerActive && "cursor-crosshair",
              )}
            />
            {isPickerActive ? (
              <div
                ref={pickerOverlayRef}
                aria-hidden
                className={cn(
                  "pointer-events-none absolute z-10 box-border opacity-0",
                  overlayMode === "element" &&
                    "transition-[left,top,width,height,opacity] duration-200 ease-out",
                )}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
