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
  buildPickerInjectScript,
  PICKER_INJECT_CSS,
  type PickerMarqueeResult,
} from "@/lib/browser-element-picker";
import { desktopMicaBrowserTintClass } from "@/lib/desktop-mica-surface";
import { cn } from "@/lib/utils";

export type WorkspaceBrowserTabProps = {
  browserTabId: string;
  browserUrl: string | undefined;
  onBrowserUrlChange(url: string): void;
  /** 站外 / 新窗口链接：在工作区新建浏览器标签并打开 */
  onOpenUrlInNewTab?: (url: string) => void;
  /** 当前网页标题变化时通知父层；切到新标签页时传 undefined */
  onTitleChange?: (title: string | undefined) => void;
  /** 用户选中元素后的回调 */
  onElementPicked?: (attachment: BrowserElementAttachment) => void;
  /** Electron 桌面宿主为 true；Web Host 为 false */
  browserTabEnabled?: boolean;
  /** 当前浏览器工具标签是否为右侧工作区激活页 */
  isActive?: boolean;
  /** Windows 云母 / macOS Vibrancy：页槽使用略高的半透明底色。 */
  useMicaBackdrop?: boolean;
};

type LocalListeningEndpoint = {
  port: number;
  address?: string;
  processName?: string;
  url?: string;
  title?: string;
};

type PageViewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
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

/** 与 workspace-tools-panel 分隔条 w-1（0.25rem）一致 */
const WORKSPACE_PANEL_HANDLE_PX = 4;
/** 与 workspace-browser-view DEVTOOLS_SPLITTER_WIDTH_PX 一致 */
const DEVTOOLS_SPLITTER_WIDTH_PX = 4;
const DEVTOOLS_MIN_WIDTH_PX = 200;
const DEFAULT_DEVTOOLS_WIDTH_PX = 320;
const DEVTOOLS_WIDTH_STORAGE_KEY = "spirit-desktop-browser-devtools-width";

function readStoredDevtoolsWidthPx(): number {
  try {
    const raw = localStorage.getItem(DEVTOOLS_WIDTH_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (Number.isFinite(parsed) && parsed >= DEVTOOLS_MIN_WIDTH_PX) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return DEFAULT_DEVTOOLS_WIDTH_PX;
}

function writeStoredDevtoolsWidthPx(widthPx: number): void {
  try {
    localStorage.setItem(DEVTOOLS_WIDTH_STORAGE_KEY, String(Math.round(widthPx)));
  } catch {
    // ignore
  }
}

function clampDevtoolsWidthPx(totalWidth: number, widthPx: number): number {
  const maxDevtools = Math.max(
    DEVTOOLS_MIN_WIDTH_PX,
    totalWidth - DEVTOOLS_MIN_WIDTH_PX - DEVTOOLS_SPLITTER_WIDTH_PX,
  );
  return Math.max(DEVTOOLS_MIN_WIDTH_PX, Math.min(maxDevtools, Math.round(widthPx)));
}

/**
 * 按工具栏 shell 可见宽度计算 BrowserView bounds，使展开/收起与 CSS width 过渡同步。
 * slot 在折叠重开时 left 会漂到屏外，故水平位置以 shell 裁剪区为准。
 */
function readBrowserPageBounds(slot: HTMLElement): PageViewBounds | null {
  const slotRect = slot.getBoundingClientRect();
  const y = Math.round(slotRect.top);
  const height = Math.max(0, Math.round(slotRect.height));
  if (height < 1) {
    return null;
  }

  const shell = document.getElementById("workspace-tools-panel-shell");
  if (!shell) {
    return {
      x: Math.round(slotRect.left),
      y,
      width: Math.max(0, Math.round(slotRect.width)),
      height,
    };
  }

  const shellRect = shell.getBoundingClientRect();
  if (shellRect.width < 1) {
    return null;
  }

  const contentLeft = shellRect.left + WORKSPACE_PANEL_HANDLE_PX;
  const contentWidth = Math.max(0, shellRect.width - WORKSPACE_PANEL_HANDLE_PX);
  const width = Math.max(0, Math.round(Math.min(contentWidth, slotRect.width)));
  if (width < 1) {
    return null;
  }

  const x = Math.round(contentLeft);

  return { x, y, width, height };
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
  browserTabId,
  browserUrl,
  onBrowserUrlChange,
  onOpenUrlInNewTab,
  onTitleChange,
  onElementPicked,
  browserTabEnabled = false,
  isActive = false,
  useMicaBackdrop = false,
}: WorkspaceBrowserTabProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pageSlotRef = useRef<HTMLDivElement | null>(null);
  const showNewTab = isBrowserNewTabUrl(browserUrl);
  const [addressDraft, setAddressDraft] = useState("");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [lastVisitedUrl, setLastVisitedUrl] = useState<string | undefined>(undefined);
  const [isPickerActive, setIsPickerActive] = useState(false);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const [devtoolsWidthPx, setDevtoolsWidthPx] = useState(readStoredDevtoolsWidthPx);
  const [isDevtoolsResizing, setIsDevtoolsResizing] = useState(false);
  const devtoolsDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [currentPageUrl, setCurrentPageUrl] = useState<string | undefined>(browserUrl);
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

  const pageEmbeddable = isActive && !showNewTab && canEmbed;

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
    setCurrentPageUrl(browserUrl);
    if (browserUrl) {
      setLastVisitedUrl(browserUrl);
    }
  }, [browserUrl, showNewTab]);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.subscribeBrowserPageEvents) {
      return;
    }
    return bridge.subscribeBrowserPageEvents((event) => {
      if (event.tabId !== browserTabId) {
        return;
      }
      if (event.type === "url" && event.url) {
        setAddressDraft(event.url);
        setCurrentPageUrl(event.url);
      } else if (event.type === "title") {
        onTitleChangeRef.current?.(event.title || undefined);
      } else if (event.type === "nav-state") {
        setCanGoBack(event.canGoBack ?? false);
        setCanGoForward(event.canGoForward ?? false);
      } else if (event.type === "devtools") {
        setDevtoolsOpen(event.open === true);
        if (typeof event.widthPx === "number" && Number.isFinite(event.widthPx)) {
          setDevtoolsWidthPx(event.widthPx);
          writeStoredDevtoolsWidthPx(event.widthPx);
        }
      }
    });
  }, [browserTabId]);

  const syncPageView = useCallback(() => {
    const bridge = window.spiritDesktop;
    const slot = pageSlotRef.current;
    if (!bridge?.syncBrowserPageView || !slot) {
      return;
    }

    if (!pageEmbeddable) {
      void bridge.syncBrowserPageView({
        tabId: browserTabId,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        visible: false,
      });
      return;
    }

    const bounds = readBrowserPageBounds(slot);
    if (!bounds) {
      void bridge.syncBrowserPageView({
        tabId: browserTabId,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        visible: false,
      });
      return;
    }

    const syncedDevtoolsWidth = devtoolsOpen
      ? clampDevtoolsWidthPx(bounds.width, devtoolsWidthPx)
      : undefined;
    if (
      syncedDevtoolsWidth !== undefined &&
      syncedDevtoolsWidth !== devtoolsWidthPx
    ) {
      setDevtoolsWidthPx(syncedDevtoolsWidth);
      writeStoredDevtoolsWidthPx(syncedDevtoolsWidth);
    }
    void bridge.syncBrowserPageView({
      tabId: browserTabId,
      bounds,
      visible: true,
      url: browserUrl,
      ...(syncedDevtoolsWidth !== undefined
        ? { devtoolsWidthPx: syncedDevtoolsWidth }
        : {}),
    });
  }, [browserTabId, browserUrl, devtoolsOpen, devtoolsWidthPx, pageEmbeddable]);

  useEffect(() => {
    if (!canEmbed || showNewTab) {
      const bridge = window.spiritDesktop;
      if (bridge?.syncBrowserPageView) {
        void bridge.syncBrowserPageView({
          tabId: browserTabId,
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          visible: false,
        });
      }
      return;
    }

    const slot = pageSlotRef.current;
    const root = rootRef.current;
    if (!slot) {
      return;
    }

    syncPageView();
    const resizeObserver = new ResizeObserver(() => syncPageView());
    resizeObserver.observe(slot);
    if (root) {
      resizeObserver.observe(root);
    }
    window.addEventListener("resize", syncPageView);

    const shell = document.getElementById("workspace-tools-panel-shell");
    if (shell) {
      resizeObserver.observe(shell);
    }
    const onShellTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== shell || event.propertyName !== "width") {
        return;
      }
      syncPageView();
    };
    shell?.addEventListener("transitionend", onShellTransitionEnd);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncPageView);
      shell?.removeEventListener("transitionend", onShellTransitionEnd);
    };
  }, [browserTabId, canEmbed, showNewTab, syncPageView]);

  useEffect(() => {
    return () => {
      void window.spiritDesktop?.destroyBrowserPageView(browserTabId);
    };
  }, [browserTabId]);

  const submitAddress = useCallback(() => {
    const normalized = normalizeBrowserUrl(addressDraft);
    if (!normalized) {
      return;
    }
    onBrowserUrlChange(normalized);
    void window.spiritDesktop?.navigateBrowserPageView({
      tabId: browserTabId,
      action: "load",
      url: normalized,
    });
  }, [addressDraft, browserTabId, onBrowserUrlChange]);

  const exitPicker = useCallback(() => {
    setIsPickerActive(false);
  }, []);

  useEffect(() => {
    if (isPickerActive) exitPicker();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserUrl]);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!isPickerActive || showNewTab || !canEmbed || !pageEmbeddable || !bridge?.executeBrowserPageView) {
      return;
    }

    void bridge.executeBrowserPageView({
      tabId: browserTabId,
      kind: "script",
      script: buildPickerInjectScript(),
    });

    let cssKey: string | undefined;
    void bridge
      .executeBrowserPageView({
        tabId: browserTabId,
        kind: "insert-css",
        css: PICKER_INJECT_CSS,
      })
      .then((key) => {
        cssKey = typeof key === "string" ? key : undefined;
      });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitPicker();
    };
    window.addEventListener("keydown", handleKeyDown, true);

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
          const done = await bridge.executeBrowserPageView({
            tabId: browserTabId,
            kind: "script",
            script: "window.__spiritPickerDone || false",
          });
          if (done) {
            const result = await bridge.executeBrowserPageView({
              tabId: browserTabId,
              kind: "script",
              script: "window.__spiritPickerResult",
            });
            await bridge.executeBrowserPageView({
              tabId: browserTabId,
              kind: "script",
              script:
                "if(window.__spiritPickerCleanup){window.__spiritPickerCleanup();window.__spiritPickerCleanup=null;}window.__spiritPickerDone=false;",
            });
            const r = result as PickerMarqueeResult | null;
            if (r && r.tagName && r.outerHTML && !cancelled && bridge.captureBrowserPageView) {
              try {
                const base64 = await bridge.captureBrowserPageView(browserTabId, {
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
                    pageUrl: currentPageUrl || browserUrl || "",
                  });
                }
              } catch (err) {
                console.warn("[picker] capturePage failed:", err);
              }
              exitPicker();
              return;
            }
          }
        } catch {
          // page view may not be ready
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
      void bridge.executeBrowserPageView({
        tabId: browserTabId,
        kind: "script",
        script:
          "if(window.__spiritPickerCleanup){window.__spiritPickerCleanup();window.__spiritPickerCleanup=null;}window.__spiritPickerDone=false;",
      });
      if (cssKey) {
        void bridge.executeBrowserPageView({
          tabId: browserTabId,
          kind: "remove-css",
          cssKey,
        });
      }
    };
  }, [
    browserTabId,
    browserUrl,
    canEmbed,
    currentPageUrl,
    exitPicker,
    isPickerActive,
    pageEmbeddable,
    showNewTab,
  ]);

  const handleGoBack = useCallback(() => {
    if (canGoBack) {
      void window.spiritDesktop?.navigateBrowserPageView({
        tabId: browserTabId,
        action: "back",
      });
      return;
    }
    onBrowserUrlChange(BROWSER_NEW_TAB_SENTINEL);
  }, [browserTabId, canGoBack, onBrowserUrlChange]);

  const handleGoForward = useCallback(() => {
    if (showNewTab && lastVisitedUrl) {
      onBrowserUrlChange(lastVisitedUrl);
      return;
    }
    void window.spiritDesktop?.navigateBrowserPageView({
      tabId: browserTabId,
      action: "forward",
    });
  }, [browserTabId, lastVisitedUrl, onBrowserUrlChange, showNewTab]);

  const handleReload = useCallback(() => {
    if (showNewTab) {
      return;
    }
    void window.spiritDesktop?.navigateBrowserPageView({
      tabId: browserTabId,
      action: "reload",
    });
  }, [browserTabId, showNewTab]);

  const applyDevtoolsWidth = useCallback(
    (nextWidthPx: number) => {
      const slot = pageSlotRef.current;
      const totalWidth = slot ? Math.round(slot.getBoundingClientRect().width) : 0;
      const clamped =
        totalWidth > 0
          ? clampDevtoolsWidthPx(totalWidth, nextWidthPx)
          : Math.max(DEVTOOLS_MIN_WIDTH_PX, Math.round(nextWidthPx));
      setDevtoolsWidthPx(clamped);
      writeStoredDevtoolsWidthPx(clamped);
      void window.spiritDesktop?.setBrowserPageDevtoolsWidth(browserTabId, clamped);
    },
    [browserTabId],
  );

  const onDevtoolsResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDevtoolsResizing(true);
      devtoolsDragRef.current = { startX: event.clientX, startWidth: devtoolsWidthPx };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [devtoolsWidthPx],
  );

  const onDevtoolsResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = devtoolsDragRef.current;
      if (!drag) {
        return;
      }
      const delta = drag.startX - event.clientX;
      applyDevtoolsWidth(drag.startWidth + delta);
    },
    [applyDevtoolsWidth],
  );

  const endDevtoolsResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setIsDevtoolsResizing(false);
    devtoolsDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // 已释放或无 capture
    }
  }, []);

  useEffect(() => {
    if (!devtoolsOpen) {
      setIsDevtoolsResizing(false);
      devtoolsDragRef.current = null;
    }
  }, [devtoolsOpen]);

  useEffect(() => {
    if (!isActive || showNewTab || !canEmbed) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F12") {
        return;
      }
      const root = rootRef.current;
      const active = document.activeElement;
      if (!root || !active || !root.contains(active)) {
        return;
      }
      event.preventDefault();
      void window.spiritDesktop?.toggleBrowserPageDevTools(browserTabId).then((result) => {
        if (!result) {
          return;
        }
        setDevtoolsOpen(result.open);
        setDevtoolsWidthPx(result.widthPx);
        writeStoredDevtoolsWidthPx(result.widthPx);
      });
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [browserTabId, canEmbed, isActive, showNewTab]);

  const navDisabled = showNewTab;

  if (!canEmbed) {
    return (
      <div className="p-3 text-muted-foreground">
        <p>{t("workspace.browserElectronOnly")}</p>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
          <div className="relative min-h-0 min-w-0 flex-1">
            <div
              ref={pageSlotRef}
              className={cn(
                "electron-no-drag absolute inset-0",
                desktopMicaBrowserTintClass(useMicaBackdrop),
                isPickerActive && "cursor-crosshair",
              )}
            />
            {devtoolsOpen ? (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t("workspace.browserResizeDevtoolsWidth")}
                className={cn(
                  "electron-no-drag group absolute top-0 bottom-0 z-20 w-1 cursor-col-resize touch-none select-none",
                  "before:absolute before:inset-y-0 before:-left-1 before:w-3 before:content-['']",
                  isDevtoolsResizing && "cursor-col-resize",
                )}
                style={{ right: devtoolsWidthPx }}
                onPointerDown={onDevtoolsResizePointerDown}
                onPointerMove={onDevtoolsResizePointerMove}
                onPointerUp={endDevtoolsResize}
                onPointerCancel={endDevtoolsResize}
              >
                <div
                  className="pointer-events-none absolute inset-y-0 left-0 w-px bg-border/40 transition-colors group-hover:bg-border/55"
                  aria-hidden
                />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
