import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Home, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeBrowserUrl, toLocalHostUrl } from "@/lib/browser-url";
import {
  BROWSER_NEW_TAB_SENTINEL,
  isBrowserNewTabUrl,
} from "@/lib/workspace-tool-tabs";
import { cn } from "@/lib/utils";

export type WorkspaceBrowserTabProps = {
  browserUrl: string | undefined;
  onBrowserUrlChange(url: string): void;
};

type LocalListeningEndpoint = {
  port: number;
  address?: string;
  processName?: string;
  url?: string;
};

type WebviewElement = HTMLElement & {
  src?: string;
  getURL?(): string;
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

function BrowserNewTabPage({
  onNavigate,
}: {
  onNavigate(url: string): void;
}) {
  const { t } = useTranslation();
  const [endpoints, setEndpoints] = useState<LocalListeningEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    const bridge = window.spiritDesktop;
    if (!bridge?.listLocalListeningEndpoints) {
      setError(t("workspace.browserScanPortsFailed"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await bridge.listLocalListeningEndpoints();
      setEndpoints(next);
    } catch {
      setError(t("workspace.browserScanPortsFailed"));
      setEndpoints([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void scan();
  }, [scan]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{t("workspace.browserNewTabTitle")}</h3>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="electron-no-drag h-7 gap-1 px-2 text-xs"
          disabled={loading}
          onClick={() => void scan()}
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden />
          {t("workspace.browserRefreshPorts")}
        </Button>
      </div>
      {loading ? (
        <p className="text-muted-foreground">{t("workspace.browserScanningPorts")}</p>
      ) : error ? (
        <p className="text-destructive">{error}</p>
      ) : endpoints.length === 0 ? (
        <p className="text-muted-foreground">{t("workspace.browserNoLocalPorts")}</p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {endpoints.map((item) => {
            const url = item.url ?? toLocalHostUrl(item.port);
            const subtitle = [item.address, item.processName].filter(Boolean).join(" · ");
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
                  <span className="block truncate font-medium text-foreground">{url}</span>
                  {subtitle ? (
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {subtitle}
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
}: WorkspaceBrowserTabProps) {
  const { t } = useTranslation();
  const webviewRef = useRef<WebviewElement | null>(null);
  const showNewTab = isBrowserNewTabUrl(browserUrl);
  const [addressDraft, setAddressDraft] = useState("");
  const canEmbed = canUseEmbeddedBrowser();

  useEffect(() => {
    if (showNewTab) {
      setAddressDraft("");
      return;
    }
    setAddressDraft(browserUrl ?? "");
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

    const onDidNavigate = (event: Event) => {
      const url = (event as Event & { url?: string }).url;
      if (url && url !== "about:blank") {
        setAddressDraft(url);
      }
    };

    const onDidStopLoading = () => {
      const url = el.getURL?.() ?? "";
      if (url && url !== "about:blank") {
        setAddressDraft(url);
      }
    };

    const onNewWindow = (event: Event) => {
      const detail = event as Event & { url?: string; preventDefault?: () => void };
      detail.preventDefault?.();
      const url = detail.url;
      if (url) {
        void window.spiritDesktop?.openExternalUrl(url);
      }
    };

    el.addEventListener("did-navigate", onDidNavigate);
    el.addEventListener("did-navigate-in-page", onDidNavigate);
    el.addEventListener("did-stop-loading", onDidStopLoading);
    el.addEventListener("new-window", onNewWindow);

    return () => {
      el.removeEventListener("did-navigate", onDidNavigate);
      el.removeEventListener("did-navigate-in-page", onDidNavigate);
      el.removeEventListener("did-stop-loading", onDidStopLoading);
      el.removeEventListener("new-window", onNewWindow);
    };
  }, [canEmbed, showNewTab]);

  if (!canEmbed) {
    return (
      <div className="p-3 text-muted-foreground">
        <p>{t("workspace.browserElectronOnly")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="electron-no-drag flex shrink-0 items-center gap-1 border-b border-border/40 px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0"
          aria-label={t("workspace.browserGoHome")}
          onClick={() => onBrowserUrlChange(BROWSER_NEW_TAB_SENTINEL)}
        >
          <Home className="size-3.5" aria-hidden />
        </Button>
        <Input
          value={addressDraft}
          aria-label={t("workspace.browserAddressBar")}
          className="h-7 min-w-0 flex-1 text-xs"
          onChange={(event) => setAddressDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitAddress();
            }
          }}
        />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {showNewTab ? (
          <BrowserNewTabPage onNavigate={onBrowserUrlChange} />
        ) : (
          <webview
            ref={webviewRef as React.RefObject<HTMLElement>}
            src={browserUrl}
            allowpopups
            className="electron-no-drag h-full w-full flex-1 border-0 bg-background"
          />
        )}
      </div>
    </div>
  );
}
