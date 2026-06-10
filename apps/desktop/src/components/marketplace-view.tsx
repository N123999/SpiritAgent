import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/lib/i18n";
import { ArrowLeft, ArrowLeftRight, Download, LoaderCircle, RefreshCw, Search, Sparkles } from "lucide-react";

import { MarkdownMessage } from "@/components/markdown-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { desktopMicaTintInnerClass } from "@/lib/desktop-mica-surface";
import { cn } from "@/lib/utils";
import type {
  DesktopExtensionListItem,
  DesktopMarketplaceCatalogItem,
  DesktopMarketplaceDetail,
  DesktopMarketplacePreparedInstall,
} from "@/types";

/** 与对话区正文一致，便于视觉连贯 */
const MARKETPLACE_READING_W = "max-w-[min(86vw,44rem)]";
/** 列表略宽，便于双列卡片 */
const MARKETPLACE_LIST_W = "max-w-[min(92vw,52rem)]";

type MarketplaceViewProps = {
  snapshot: {
    extensionsList: DesktopExtensionListItem[];
  } | null;
  apiReady: boolean;
  busyAction: string;
  runtimeError: string;
  onListMarketplaceExtensions: () => Promise<DesktopMarketplaceCatalogItem[]>;
  onGetMarketplaceExtensionDetail: (extensionId: string) => Promise<DesktopMarketplaceDetail>;
  onGetMarketplaceExtensionReadme: (extensionId: string) => Promise<string>;
  onPrepareMarketplaceExtensionInstall: (request: {
    extensionId: string;
    version?: string;
  }) => Promise<DesktopMarketplacePreparedInstall>;
  onInstallMarketplaceExtension: (request: {
    extensionId: string;
    version?: string;
    reviewAcknowledged?: boolean;
  }) => Promise<void>;
  /** Windows 云母 / macOS Vibrancy：内层透明以避免与 marketplace-layout 双层 tint 叠深。 */
  useMicaBackdrop?: boolean;
};

type MarketplaceTab = "readme" | "changelog" | "versions";

type PendingInstall = {
  extensionId: string;
  version: string;
  displayName: string;
  reviewStatus: DesktopMarketplacePreparedInstall["reviewStatus"];
};

function reviewStatusBadgeVariant(status: DesktopMarketplaceCatalogItem["defaultReviewStatus"]) {
  if (status === "verified") {
    return "secondary" as const;
  }
  if (status === "revoked") {
    return "destructive" as const;
  }
  return "outline" as const;
}

function reviewStatusLabel(status: DesktopMarketplaceCatalogItem["defaultReviewStatus"]) {
  if (status === "verified") {
    return i18n.t('marketplace.verified');
  }
  if (status === "revoked") {
    return i18n.t('marketplace.revoked');
  }
  return i18n.t('marketplace.unverified');
}

function installedExtensionForCatalog(
  catalog: DesktopMarketplaceCatalogItem | undefined,
  installed: DesktopExtensionListItem[],
): DesktopExtensionListItem | undefined {
  if (!catalog) {
    return undefined;
  }
  return installed.find(
    (item) => item.id === catalog.extensionId || item.id === catalog.packageName,
  );
}

function installedBadgeLabel(installed: DesktopExtensionListItem, targetVersion: string) {
  if (installed.version === targetVersion) {
    return i18n.t('marketplace.installedVersion', { version: installed.version });
  }
  return i18n.t('marketplace.updateAvailable', { current: installed.version, target: targetVersion });
}

export function MarketplaceView({
  snapshot,
  apiReady,
  busyAction,
  runtimeError,
  onListMarketplaceExtensions,
  onGetMarketplaceExtensionDetail,
  onGetMarketplaceExtensionReadme,
  onPrepareMarketplaceExtensionInstall,
  onInstallMarketplaceExtension,
  useMicaBackdrop = false,
}: MarketplaceViewProps) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<DesktopMarketplaceCatalogItem[]>([]);
  /** null = 列表；非 null = 该扩展的详情页 */
  const [detailExtensionId, setDetailExtensionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MarketplaceTab>("readme");
  const [searchText, setSearchText] = useState("");
  const [detailById, setDetailById] = useState<Record<string, DesktopMarketplaceDetail>>({});
  const [readmeById, setReadmeById] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState("");
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingDetailId, setLoadingDetailId] = useState("");
  const [loadingReadmeId, setLoadingReadmeId] = useState("");
  const [pendingInstall, setPendingInstall] = useState<PendingInstall | null>(null);

  const installedExtensions = snapshot?.extensionsList ?? [];
  const marketplaceBusy = busyAction === "marketplace";
  const effectiveError = runtimeError || localError;

  const filteredCatalog = catalog.filter((item) => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return [
      item.displayName,
      item.description,
      item.extensionId,
      item.packageName,
      item.author ?? "",
      item.keywords.join(" "),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  const selectedCatalog =
    detailExtensionId !== null
      ? catalog.find((item) => item.extensionId === detailExtensionId)
      : undefined;
  const selectedDetail = selectedCatalog ? detailById[selectedCatalog.extensionId] : undefined;
  const installedItem = installedExtensionForCatalog(selectedCatalog, installedExtensions);
  /** 目录推荐 / registry 最新默认版本（无「选中版本」状态，仅此一处作为顶栏安装目标） */
  const latestVersion = selectedCatalog
    ? selectedDetail?.defaultVersion ?? selectedCatalog.defaultVersion
    : "";
  /** 顶栏主按钮：仅「目录默认最新版 vs 本地已装版本」比较，无单独选中版本状态 */
  const headerPrimaryDisabled =
    marketplaceBusy ||
    !latestVersion ||
    (installedItem !== undefined && installedItem.version === latestVersion);
  const headerPrimaryTitle = !latestVersion
    ? undefined
    : installedItem
      ? installedItem.version === latestVersion
        ? t('marketplace.alreadyLatest')
        : t('marketplace.goToVersionList')
      : t('marketplace.installVersion', { version: latestVersion });
  const selectedReadme = selectedCatalog ? readmeById[selectedCatalog.extensionId] : undefined;

  useEffect(() => {
    if (!apiReady) {
      return;
    }

    let cancelled = false;
    setLoadingCatalog(true);
    setLocalError("");

    void onListMarketplaceExtensions()
      .then((items) => {
        if (cancelled) {
          return;
        }
        setCatalog(items);
      })
      .catch((error) => {
        if (!cancelled) {
          setLocalError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingCatalog(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiReady, onListMarketplaceExtensions]);

  useEffect(() => {
    if (!selectedCatalog || detailExtensionId === null) {
      return;
    }
    if (detailById[selectedCatalog.extensionId]) {
      return;
    }

    let cancelled = false;
    setLoadingDetailId(selectedCatalog.extensionId);
    setLocalError("");

    void onGetMarketplaceExtensionDetail(selectedCatalog.extensionId)
      .then((detail) => {
        if (cancelled) {
          return;
        }
        setDetailById((current) => ({
          ...current,
          [selectedCatalog.extensionId]: detail,
        }));
      })
      .catch((error) => {
        if (!cancelled) {
          setLocalError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDetailId("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detailById, detailExtensionId, onGetMarketplaceExtensionDetail, selectedCatalog]);

  useEffect(() => {
    if (activeTab !== "readme" || !selectedCatalog || detailExtensionId === null) {
      return;
    }
    if (readmeById[selectedCatalog.extensionId] !== undefined) {
      return;
    }

    let cancelled = false;
    setLoadingReadmeId(selectedCatalog.extensionId);
    setLocalError("");

    void onGetMarketplaceExtensionReadme(selectedCatalog.extensionId)
      .then((readme) => {
        if (cancelled) {
          return;
        }
        setReadmeById((current) => ({
          ...current,
          [selectedCatalog.extensionId]: readme,
        }));
      })
      .catch((error) => {
        if (!cancelled) {
          setLocalError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingReadmeId("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, detailExtensionId, onGetMarketplaceExtensionReadme, readmeById, selectedCatalog]);

  const refreshCatalog = async () => {
    setLoadingCatalog(true);
    setLocalError("");
    setPendingInstall(null);
    try {
      const items = await onListMarketplaceExtensions();
      setCatalog(items);
      setDetailById({});
      setReadmeById({});
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingCatalog(false);
    }
  };

  const prepareInstall = async (request: {
    extensionId: string;
    version?: string;
  }): Promise<DesktopMarketplacePreparedInstall | null> => {
    try {
      const prepared = await onPrepareMarketplaceExtensionInstall(request);
      if (!prepared.supportsCurrentHost) {
        setLocalError(t('marketplace.extensionNotSupported', { name: prepared.displayName, version: prepared.version }));
        return null;
      }
      setPendingInstall(null);
      setLocalError("");
      return prepared;
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  const installSelectedVersion = async (
    reviewAcknowledged: boolean,
    payload: { extensionId: string; version: string },
  ) => {
    const { extensionId, version } = payload;
    if (!extensionId || !version) {
      return;
    }

    try {
      await onInstallMarketplaceExtension({
        extensionId,
        version,
        ...(reviewAcknowledged ? { reviewAcknowledged: true } : {}),
      });
      setPendingInstall(null);
      setLocalError("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  const requestInstallLatest = async () => {
    if (!selectedCatalog || !latestVersion) {
      return;
    }
    const prepared = await prepareInstall({
      extensionId: selectedCatalog.extensionId,
      version: latestVersion,
    });
    if (!prepared) {
      return;
    }
    if (prepared.reviewStatus !== "verified") {
      setPendingInstall({
        extensionId: prepared.extensionId,
        version: prepared.version,
        displayName: prepared.displayName,
        reviewStatus: prepared.reviewStatus,
      });
      return;
    }
    await installSelectedVersion(false, {
      extensionId: prepared.extensionId,
      version: prepared.version,
    });
  };

  const handleHeaderPrimaryClick = () => {
    if (!selectedCatalog || !latestVersion || marketplaceBusy) {
      return;
    }
    if (installedItem) {
      setActiveTab("versions");
      return;
    }
    void requestInstallLatest();
  };

  const requestInstallVersion = async (version: string) => {
    if (!selectedCatalog) {
      return;
    }
    const prepared = await prepareInstall({
      extensionId: selectedCatalog.extensionId,
      version,
    });
    if (!prepared) {
      return;
    }
    if (prepared.reviewStatus !== "verified") {
      setPendingInstall({
        extensionId: prepared.extensionId,
        version: prepared.version,
        displayName: prepared.displayName,
        reviewStatus: prepared.reviewStatus,
      });
      return;
    }
    await installSelectedVersion(false, {
      extensionId: prepared.extensionId,
      version: prepared.version,
    });
  };

  const openDetail = (extensionId: string) => {
    setDetailExtensionId(extensionId);
    setActiveTab("readme");
    setLocalError("");
  };

  const closeDetail = () => {
    setDetailExtensionId(null);
    setPendingInstall(null);
  };

  const listEmpty = filteredCatalog.length === 0 && !loadingCatalog;

  return (
    <div data-spirit-surface="marketplace-shell" className={cn("flex min-h-0 min-w-0 flex-1 flex-col text-sm", desktopMicaTintInnerClass(useMicaBackdrop))}>
      {detailExtensionId === null ? (
        <ScrollArea className="min-h-0 flex-1" type="hover" scrollHideDelay={450}>
          <div
            className={cn(
              "mx-auto w-full px-3 pb-12 pt-6 sm:pt-7",
              MARKETPLACE_LIST_W,
            )}
          >
            <div className="flex flex-col items-center gap-6">
              <div className="flex w-full flex-col items-center gap-2">
                <p className="text-center text-lg font-medium tracking-tight text-foreground">{t('marketplace.title')}</p>
                <div className="flex w-full max-w-sm items-center gap-1.5">
                  <div className="relative min-w-0 flex-1">
                    <Search
                      className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      value={searchText}
                      onChange={(event) => setSearchText(event.target.value)}
                      placeholder={t('marketplace.searchPlaceholder')}
                      className="h-8 pl-8 text-sm"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8 shrink-0"
                    disabled={loadingCatalog || marketplaceBusy}
                    title={t('marketplace.refreshCatalog')}
                    onClick={() => {
                      void refreshCatalog();
                    }}
                  >
                    {loadingCatalog ? (
                      <LoaderCircle className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <RefreshCw className="size-4" aria-hidden />
                    )}
                  </Button>
                </div>
              </div>

              {listEmpty ? (
                <p className="text-center text-sm text-muted-foreground">
                  {loadingCatalog ? t('marketplace.loadingCatalog') : t('marketplace.noMatches')}
                </p>
              ) : (
                <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                  {filteredCatalog.map((item) => (
                      <button
                        key={item.extensionId}
                        type="button"
                        onClick={() => openDetail(item.extensionId)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2.5 text-left transition-colors",
                          "hover:border-border hover:bg-muted/30",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                        )}
                      >
                        {item.iconUrl ? (
                          <img
                            src={item.iconUrl}
                            alt=""
                            className="size-10 shrink-0 rounded-md border border-border/50 bg-muted object-cover"
                          />
                        ) : (
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted text-muted-foreground">
                            <Sparkles className="size-4" aria-hidden />
                          </div>
                        )}
                        <span className="min-w-0 flex-1 space-y-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-medium text-foreground">{item.displayName}</span>
                            {item.featured ? (
                              <Badge variant="secondary" className="text-[10px] font-normal">
                                {t('marketplace.featured')}
                              </Badge>
                            ) : null}
                            <Badge variant={reviewStatusBadgeVariant(item.defaultReviewStatus)} className="text-[10px]">
                              {reviewStatusLabel(item.defaultReviewStatus)}
                            </Badge>
                          </span>
                          <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            {item.description}
                          </span>
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      ) : (
        <>
          <div className="shrink-0 bg-background/90 backdrop-blur-sm">
            <div className={cn("mx-auto flex items-center px-3 py-2", MARKETPLACE_READING_W)}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 h-8 gap-1 text-muted-foreground hover:text-foreground"
                onClick={closeDetail}
              >
                <ArrowLeft className="size-4" aria-hidden />
                {t('common.back')}
              </Button>
            </div>
          </div>

          {!selectedCatalog ? (
            <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
              {t('marketplace.extensionNotFound')}
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1" type="hover" scrollHideDelay={450}>
              <div className={cn("mx-auto w-full space-y-4 px-3 pb-12 pt-5", MARKETPLACE_READING_W)}>
                {effectiveError ? (
                  <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
                    {effectiveError}
                  </div>
                ) : null}

                {/* 详情顶栏：图标与文本垂直居中；正文压缩为标题行 + 单行摘要（作者并入摘要前缀） */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {selectedCatalog.iconUrl ? (
                      <img
                        src={selectedCatalog.iconUrl}
                        alt=""
                        className="size-11 shrink-0 rounded-md border border-border/50 bg-muted object-cover"
                      />
                    ) : (
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border/50 bg-muted text-muted-foreground">
                        <Sparkles className="size-[18px]" aria-hidden />
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <h2 className="text-base font-medium leading-snug tracking-tight text-foreground">
                          {selectedCatalog.displayName}
                        </h2>
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {selectedCatalog.defaultChannel}
                        </Badge>
                        <Badge variant={reviewStatusBadgeVariant(selectedCatalog.defaultReviewStatus)} className="text-[10px]">
                          {reviewStatusLabel(selectedCatalog.defaultReviewStatus)}
                        </Badge>
                        {installedItem ? (
                          <Badge variant="secondary" className="max-w-full truncate text-[10px]">
                            {installedBadgeLabel(installedItem, selectedCatalog.defaultVersion)}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-sm leading-snug text-muted-foreground line-clamp-2">
                        {selectedCatalog.author ? (
                          <span className="text-muted-foreground">{selectedCatalog.author}</span>
                        ) : null}
                        {selectedCatalog.author ? <span className="text-muted-foreground/70"> · </span> : null}
                        {selectedCatalog.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col gap-2 sm:w-52 sm:items-end sm:self-center">
                    <Button
                      type="button"
                      size="sm"
                      className="w-full sm:w-auto"
                      title={headerPrimaryTitle}
                      disabled={headerPrimaryDisabled}
                      onClick={handleHeaderPrimaryClick}
                    >
                      {marketplaceBusy ? (
                        <LoaderCircle className="size-4 animate-spin" aria-hidden />
                      ) : installedItem ? (
                        <ArrowLeftRight className="size-4" aria-hidden />
                      ) : (
                        <Download className="size-4" aria-hidden />
                      )}
                      {installedItem ? t('marketplace.switch') : t('marketplace.install')}
                    </Button>
                  </div>
                </div>

                {/* Tabs：无整条顶部分割线，仅当前项底边 */}
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {(
                      [
                        ["readme", t('marketplace.tabReadme')],
                        ["changelog", t('marketplace.tabChangelog')],
                        ["versions", t('marketplace.tabVersions')],
                      ] as const
                    ).map(([tabId, label]) => (
                      <button
                        key={tabId}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === tabId}
                        className={cn(
                          "rounded-md px-3 py-2 text-sm transition-colors",
                          activeTab === tabId
                            ? "font-medium text-foreground underline decoration-foreground/80 underline-offset-[10px]"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                        )}
                        onClick={() => setActiveTab(tabId)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {activeTab === "readme" ? (
                    <div className="rounded-lg border border-border/60 bg-background px-3 py-3">
                      {loadingReadmeId === selectedCatalog.extensionId ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <LoaderCircle className="size-4 animate-spin" aria-hidden />
                          {t('common.loading')}
                        </div>
                      ) : selectedReadme ? (
                        <MarkdownMessage content={selectedReadme} />
                      ) : (
                        <p className="text-sm text-muted-foreground">{t('marketplace.noReadme')}</p>
                      )}
                    </div>
                  ) : null}

                  {activeTab === "changelog" ? (
                    <div className="space-y-2">
                      {selectedDetail?.versions.some((version) => version.changelog) ? (
                        selectedDetail.versions.map((version) =>
                          version.changelog ? (
                            <div
                              key={version.version}
                              className="rounded-lg border border-border/60 bg-background px-3 py-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-xs text-foreground">{version.version}</span>
                                <Badge variant="outline" className="text-[10px]">
                                  {version.channel}
                                </Badge>
                              </div>
                              <p className="mt-2 text-sm leading-relaxed text-foreground">{version.changelog.summary}</p>
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                                {version.changelog.body}
                              </p>
                            </div>
                          ) : null,
                        )
                      ) : (
                        <p className="text-sm text-muted-foreground">{t('marketplace.noChangelog')}</p>
                      )}
                    </div>
                  ) : null}

                  {activeTab === "versions" ? (
                    <div className="space-y-2">
                      {loadingDetailId === selectedCatalog.extensionId && !selectedDetail ? (
                        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                          <LoaderCircle className="size-4 animate-spin" aria-hidden />
                          {t('marketplace.loadingVersions')}
                        </div>
                      ) : selectedDetail ? (
                        selectedDetail.versions.map((version) => {
                          const desktopSupported = version.supportedHosts.includes("desktop");
                          const installedHere = installedItem?.version === version.version;
                          return (
                            <div
                              key={version.version}
                              className="rounded-lg border border-border/60 bg-background px-3 py-3"
                            >
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0 flex-1 space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono text-xs text-foreground">{version.version}</span>
                                    <Badge variant="outline" className="text-[10px]">
                                      {version.channel}
                                    </Badge>
                                    <div className="flex flex-wrap gap-1">
                                      {version.supportedHosts.map((host) => (
                                        <Badge key={host} variant="outline" className="text-[10px] font-normal">
                                          {host}
                                        </Badge>
                                      ))}
                                    </div>
                                    {installedHere ? (
                                      <Badge variant="secondary" className="text-[10px]">
                                        {t('marketplace.installed')}
                                      </Badge>
                                    ) : null}
                                    {!desktopSupported ? (
                                      <Badge variant="destructive" className="text-[10px]">
                                        {t('marketplace.unsupportedDesktop')}
                                      </Badge>
                                    ) : null}
                                  </div>
                                  {version.description ? (
                                    <p className="text-sm leading-relaxed text-muted-foreground">{version.description}</p>
                                  ) : null}
                                </div>
                                <div className="flex shrink-0 items-center justify-end sm:pl-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-8 text-xs"
                                    title={
                                      installedHere
                                        ? t('marketplace.currentVersionInUse')
                                        : t('marketplace.switchToVersion', { version: version.version })
                                    }
                                    disabled={marketplaceBusy || !desktopSupported || installedHere}
                                    onClick={() => {
                                      void requestInstallVersion(version.version);
                                    }}
                                  >
                                    {t('marketplace.switch')}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </ScrollArea>
          )}
        </>
      )}

      <Dialog
        open={pendingInstall !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingInstall(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t('marketplace.confirmSwitchUnverified')}</DialogTitle>
            <DialogDescription>
              {pendingInstall
                ? pendingInstall.reviewStatus === "revoked"
                  ? t('marketplace.revokedExtensionWarning', { name: pendingInstall.displayName, version: pendingInstall.version })
                  : t('marketplace.unverifiedExtensionWarning', { name: pendingInstall.displayName, version: pendingInstall.version })
                : t('marketplace.notVerifiedStatus')}
            </DialogDescription>
          </DialogHeader>

          <div
            className={cn(
              "rounded-md px-3 py-2 text-xs leading-relaxed",
              pendingInstall?.reviewStatus === "revoked"
                ? "border border-destructive/35 bg-destructive/10 text-destructive"
                : "border border-border bg-muted/40 text-foreground",
            )}
          >
            {t('marketplace.switchAdvice')}
          </div>

          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => setPendingInstall(null)} disabled={marketplaceBusy}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (!pendingInstall) {
                  return;
                }
                void installSelectedVersion(true, {
                  extensionId: pendingInstall.extensionId,
                  version: pendingInstall.version,
                });
              }}
              disabled={marketplaceBusy}
            >
              {marketplaceBusy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
              {t('marketplace.continueSwitch')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
