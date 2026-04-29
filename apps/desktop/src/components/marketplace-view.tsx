import { useEffect, useState } from "react";

import {
  Download,
  LoaderCircle,
  Package,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

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
import { cn } from "@/lib/utils";
import type {
  DesktopExtensionListItem,
  DesktopMarketplaceCatalogItem,
  DesktopMarketplaceDetail,
  DesktopMarketplacePreparedInstall,
} from "@/types";

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
};

type MarketplaceTab = "overview" | "readme" | "changelog" | "versions";

type PendingInstall = {
  extensionId: string;
  version: string;
  displayName: string;
  reviewStatus: DesktopMarketplacePreparedInstall["reviewStatus"];
};

function reviewStatusBadgeVariant(status: DesktopMarketplaceCatalogItem["defaultReviewStatus"]) {
  if (status === "verified") {
    return "default" as const;
  }
  if (status === "revoked") {
    return "destructive" as const;
  }
  return "secondary" as const;
}

function reviewStatusLabel(status: DesktopMarketplaceCatalogItem["defaultReviewStatus"]) {
  if (status === "verified") {
    return "Verified";
  }
  if (status === "revoked") {
    return "Revoked";
  }
  return "Unverified";
}

function installedExtensionForCatalog(
  catalog: DesktopMarketplaceCatalogItem | undefined,
  installed: DesktopExtensionListItem[],
): DesktopExtensionListItem | undefined {
  if (!catalog) {
    return undefined;
  }
  return installed.find((item) => item.id === catalog.packageName);
}

function installedBadgeLabel(installed: DesktopExtensionListItem, targetVersion: string) {
  if (installed.version === targetVersion) {
    return `已安装 ${installed.version}`;
  }
  return `可更新 ${installed.version} -> ${targetVersion}`;
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
}: MarketplaceViewProps) {
  const [catalog, setCatalog] = useState<DesktopMarketplaceCatalogItem[]>([]);
  const [selectedExtensionId, setSelectedExtensionId] = useState("");
  const [activeTab, setActiveTab] = useState<MarketplaceTab>("overview");
  const [searchText, setSearchText] = useState("");
  const [detailById, setDetailById] = useState<Record<string, DesktopMarketplaceDetail>>({});
  const [readmeById, setReadmeById] = useState<Record<string, string>>({});
  const [selectedVersionById, setSelectedVersionById] = useState<Record<string, string>>({});
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
    filteredCatalog.find((item) => item.extensionId === selectedExtensionId) ?? filteredCatalog[0];
  const selectedDetail = selectedCatalog ? detailById[selectedCatalog.extensionId] : undefined;
  const installedItem = installedExtensionForCatalog(selectedCatalog, installedExtensions);
  const selectedVersion = selectedCatalog
    ? selectedVersionById[selectedCatalog.extensionId] ?? selectedDetail?.defaultVersion ?? selectedCatalog.defaultVersion
    : "";
  const selectedVersionDetail = selectedDetail?.versions.find((item) => item.version === selectedVersion);
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
        setSelectedExtensionId((current) => current || items[0]?.extensionId || "");
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
    if (!selectedCatalog) {
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
        setSelectedVersionById((current) => {
          if (current[selectedCatalog.extensionId]) {
            return current;
          }
          return {
            ...current,
            [selectedCatalog.extensionId]: detail.defaultVersion,
          };
        });
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
  }, [detailById, onGetMarketplaceExtensionDetail, selectedCatalog]);

  useEffect(() => {
    if (activeTab !== "readme" || !selectedCatalog) {
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
  }, [activeTab, onGetMarketplaceExtensionReadme, readmeById, selectedCatalog]);

  useEffect(() => {
    if (!selectedCatalog) {
      return;
    }
    if (filteredCatalog.some((item) => item.extensionId === selectedExtensionId)) {
      return;
    }
    setSelectedExtensionId(selectedCatalog.extensionId);
  }, [filteredCatalog, selectedCatalog, selectedExtensionId]);

  const refreshCatalog = async () => {
    setLoadingCatalog(true);
    setLocalError("");
    setPendingInstall(null);
    try {
      const items = await onListMarketplaceExtensions();
      setCatalog(items);
      setDetailById({});
      setReadmeById({});
      setSelectedVersionById({});
      setSelectedExtensionId((current) => current || items[0]?.extensionId || "");
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
      setSelectedVersionById((current) => ({
        ...current,
        [prepared.extensionId]: prepared.version,
      }));
      if (!prepared.supportsCurrentHost) {
        setLocalError(`扩展 ${prepared.displayName}@${prepared.version} 不支持当前 Desktop 宿主。`);
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
    override?: { extensionId: string; version: string },
  ) => {
    const extensionId = override?.extensionId ?? selectedCatalog?.extensionId ?? "";
    const version = override?.version ?? selectedVersion;
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

  const requestInstall = async () => {
    if (!selectedCatalog || !selectedVersion) {
      return;
    }
    const prepared = await prepareInstall({
      extensionId: selectedCatalog.extensionId,
      version: selectedVersion,
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

  return (
    <div data-spirit-surface="marketplace-shell" className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="border-b border-border/40 px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Marketplace</h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              搜索、查看详情并安装 awesome-SpiritAgent registry 中发布的扩展。
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <div className="relative min-w-0 flex-1 lg:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="搜索扩展名、能力或包名"
                className="pl-9"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              disabled={loadingCatalog || marketplaceBusy}
              onClick={() => {
                void refreshCatalog();
              }}
            >
              {loadingCatalog ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" aria-hidden />}
              刷新目录
            </Button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="border-b border-r border-border/40 bg-muted/10 lg:border-b-0">
          <ScrollArea className="h-full">
            <div className="space-y-2 p-3">
              {filteredCatalog.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/50 bg-background/80 px-4 py-10 text-center text-sm text-muted-foreground">
                  {loadingCatalog ? "正在读取目录…" : "没有匹配的扩展。"}
                </div>
              ) : (
                filteredCatalog.map((item) => {
                  const selected = item.extensionId === selectedCatalog?.extensionId;
                  const installed = installedExtensionForCatalog(item, installedExtensions);
                  return (
                    <button
                      key={item.extensionId}
                      type="button"
                      onClick={() => {
                        setSelectedExtensionId(item.extensionId);
                        setActiveTab("overview");
                      }}
                      className={cn(
                        "flex w-full flex-col gap-2 rounded-2xl border px-3 py-3 text-left transition-colors",
                        selected
                          ? "border-foreground/20 bg-background shadow-sm"
                          : "border-border/40 bg-background/70 hover:border-border hover:bg-background",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          {item.iconUrl ? (
                            <img
                              src={item.iconUrl}
                              alt=""
                              className="mt-0.5 size-10 rounded-xl border border-border/40 bg-muted object-cover"
                            />
                          ) : (
                            <div className="mt-0.5 flex size-10 items-center justify-center rounded-xl border border-border/40 bg-muted text-muted-foreground">
                              <Sparkles className="size-4" aria-hidden />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium text-foreground">{item.displayName}</span>
                              {item.featured ? <Badge variant="secondary">Featured</Badge> : null}
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                              {item.description}
                            </p>
                            {item.author ? (
                              <p className="mt-1 text-[11px] text-muted-foreground">by {item.author}</p>
                            ) : null}
                          </div>
                        </div>
                        <Package className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <Badge variant="outline">{item.defaultVersion}</Badge>
                        <Badge variant={reviewStatusBadgeVariant(item.defaultReviewStatus)}>
                          {reviewStatusLabel(item.defaultReviewStatus)}
                        </Badge>
                        {installed ? (
                          <Badge variant="secondary">{installedBadgeLabel(installed, item.defaultVersion)}</Badge>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="min-h-0 bg-background">
          {!selectedCatalog ? (
            <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
              选择左侧扩展以查看详情。
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="space-y-5 px-5 py-5">
                <div className="rounded-3xl border border-border/50 bg-background shadow-sm">
                  <div className="space-y-4 px-5 py-5">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                            {selectedCatalog.displayName}
                          </h2>
                          <Badge variant="outline">{selectedCatalog.defaultChannel}</Badge>
                          <Badge variant={reviewStatusBadgeVariant(selectedCatalog.defaultReviewStatus)}>
                            {reviewStatusLabel(selectedCatalog.defaultReviewStatus)}
                          </Badge>
                          {installedItem ? (
                            <Badge variant="secondary">
                              {installedBadgeLabel(installedItem, selectedCatalog.defaultVersion)}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
                          {selectedCatalog.description}
                        </p>
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span className="rounded-full bg-muted px-2.5 py-1">扩展 ID: {selectedCatalog.extensionId}</span>
                          <span className="rounded-full bg-muted px-2.5 py-1">包名: {selectedCatalog.packageName}</span>
                          <span className="rounded-full bg-muted px-2.5 py-1">
                            支持宿主: {selectedCatalog.supportedHosts.join(" / ")}
                          </span>
                        </div>
                      </div>

                      <div className="flex min-w-0 flex-col items-stretch gap-2 xl:w-72">
                        <div className="rounded-2xl border border-border/50 bg-muted/20 px-4 py-3 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">当前选择</span>
                            <span className="font-medium text-foreground">{selectedVersion || selectedCatalog.defaultVersion}</span>
                          </div>
                          {selectedVersionDetail ? (
                            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                              {selectedVersionDetail.supportedHosts.includes("desktop")
                                ? "该版本在版本元数据中声明支持 Desktop。"
                                : "该版本在版本元数据中未声明支持 Desktop。"}
                            </p>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          className="justify-center"
                          disabled={marketplaceBusy || !selectedVersion}
                          onClick={() => {
                            void requestInstall();
                          }}
                        >
                          {marketplaceBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" aria-hidden />}
                          安装 {selectedVersion || selectedCatalog.defaultVersion}
                        </Button>
                        {selectedCatalog.defaultVersion !== selectedVersion ? (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={marketplaceBusy}
                            onClick={() => {
                              setSelectedVersionById((current) => ({
                                ...current,
                                [selectedCatalog.extensionId]: selectedCatalog.defaultVersion,
                              }));
                            }}
                          >
                            切回默认版本 {selectedCatalog.defaultVersion}
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 border-t border-border/40 pt-3">
                      {([
                        ["overview", "概览"],
                        ["readme", "README"],
                        ["changelog", "更新日志"],
                        ["versions", "版本"],
                      ] as const).map(([tabId, label]) => (
                        <Button
                          key={tabId}
                          type="button"
                          variant={activeTab === tabId ? "default" : "outline"}
                          size="sm"
                          onClick={() => setActiveTab(tabId)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                {effectiveError ? (
                  <div className="rounded-2xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {effectiveError}
                  </div>
                ) : null}

                {activeTab === "overview" ? (
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
                    <div className="space-y-4 rounded-3xl border border-border/50 bg-background px-5 py-5 shadow-sm">
                      <div>
                        <h3 className="text-sm font-medium text-foreground">说明</h3>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                          {selectedVersionDetail?.description ?? selectedCatalog.description}
                        </p>
                      </div>

                      <div>
                        <h3 className="text-sm font-medium text-foreground">请求能力</h3>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(selectedVersionDetail?.requestedCapabilities ?? selectedCatalog.requestedCapabilities).map((capability) => (
                            <Badge key={capability} variant="outline">
                              {capability}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {selectedCatalog.keywords.length > 0 ? (
                        <div>
                          <h3 className="text-sm font-medium text-foreground">关键词</h3>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {selectedCatalog.keywords.map((keyword) => (
                              <Badge key={keyword} variant="secondary">
                                {keyword}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-4 rounded-3xl border border-border/50 bg-background px-5 py-5 shadow-sm">
                      <div>
                        <h3 className="text-sm font-medium text-foreground">安装状态</h3>
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                          {installedItem
                            ? installedItem.version === (selectedVersion || selectedCatalog.defaultVersion)
                              ? `本地已安装当前版本 ${installedItem.version}。`
                              : `本地当前是 ${installedItem.version}，你正在查看 ${selectedVersion || selectedCatalog.defaultVersion}。`
                            : "本地尚未安装此 marketplace 条目。"}
                        </p>
                      </div>

                      <div>
                        <h3 className="text-sm font-medium text-foreground">审核状态</h3>
                        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                          {selectedCatalog.defaultReviewStatus === "verified" ? (
                            <ShieldCheck className="size-4 text-emerald-600" aria-hidden />
                          ) : (
                            <ShieldAlert className="size-4 text-amber-600" aria-hidden />
                          )}
                          {reviewStatusLabel(selectedCatalog.defaultReviewStatus)}
                        </div>
                      </div>

                      <div>
                        <h3 className="text-sm font-medium text-foreground">来源</h3>
                        <p className="mt-2 break-all text-sm leading-relaxed text-muted-foreground">
                          {selectedCatalog.packageName}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activeTab === "readme" ? (
                  <div className="rounded-3xl border border-border/50 bg-background px-5 py-5 shadow-sm">
                    {loadingReadmeId === selectedCatalog.extensionId ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <LoaderCircle className="size-4 animate-spin" aria-hidden />
                        正在加载 README…
                      </div>
                    ) : selectedReadme ? (
                      <MarkdownMessage content={selectedReadme} />
                    ) : (
                      <p className="text-sm text-muted-foreground">README 尚未加载。</p>
                    )}
                  </div>
                ) : null}

                {activeTab === "changelog" ? (
                  <div className="space-y-3 rounded-3xl border border-border/50 bg-background p-4 shadow-sm">
                    {selectedDetail?.versions.some((version) => version.changelog) ? (
                      selectedDetail.versions.map((version) =>
                        version.changelog ? (
                          <div key={version.version} className="rounded-2xl border border-border/40 bg-background px-4 py-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-foreground">{version.version}</span>
                              <Badge variant="outline">{version.channel}</Badge>
                            </div>
                            <p className="mt-2 text-sm leading-relaxed text-foreground">
                              {version.changelog.summary}
                            </p>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                              {version.changelog.body}
                            </p>
                          </div>
                        ) : null,
                      )
                    ) : (
                      <p className="px-1 py-2 text-sm text-muted-foreground">当前没有可展示的更新日志。</p>
                    )}
                  </div>
                ) : null}

                {activeTab === "versions" ? (
                  <div className="space-y-3 rounded-3xl border border-border/50 bg-background p-4 shadow-sm">
                    {loadingDetailId === selectedCatalog.extensionId && !selectedDetail ? (
                      <div className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
                        <LoaderCircle className="size-4 animate-spin" aria-hidden />
                        正在读取版本列表…
                      </div>
                    ) : selectedDetail ? (
                      selectedDetail.versions.map((version) => {
                        const selected = version.version === selectedVersion;
                        const desktopSupported = version.supportedHosts.includes("desktop");
                        const installedHere = installedItem?.version === version.version;
                        return (
                          <div
                            key={version.version}
                            className={cn(
                              "rounded-2xl border px-4 py-4 transition-colors",
                              selected ? "border-foreground/20 bg-muted/20" : "border-border/40 bg-background",
                            )}
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    className="text-left text-sm font-medium text-foreground"
                                    onClick={() => {
                                      setSelectedVersionById((current) => ({
                                        ...current,
                                        [selectedCatalog.extensionId]: version.version,
                                      }));
                                    }}
                                  >
                                    {version.version}
                                  </button>
                                  <Badge variant="outline">{version.channel}</Badge>
                                  <Badge variant={version.reviewStatus === "verified" ? "default" : "secondary"}>
                                    {version.reviewStatus}
                                  </Badge>
                                  {installedHere ? <Badge variant="secondary">本地已安装</Badge> : null}
                                  {!desktopSupported ? <Badge variant="destructive">不支持 Desktop</Badge> : null}
                                </div>
                                <p className="text-sm leading-relaxed text-muted-foreground">
                                  {version.description}
                                </p>
                                {version.changelog?.summary ? (
                                  <p className="text-xs leading-relaxed text-muted-foreground">
                                    {version.changelog.summary}
                                  </p>
                                ) : null}
                              </div>

                              <div className="flex shrink-0 items-center gap-2">
                                <Button
                                  type="button"
                                  variant={selected ? "default" : "outline"}
                                  size="sm"
                                  onClick={() => {
                                    setSelectedVersionById((current) => ({
                                      ...current,
                                      [selectedCatalog.extensionId]: version.version,
                                    }));
                                  }}
                                >
                                  {selected ? "当前选择" : "选择版本"}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={marketplaceBusy || !desktopSupported}
                                  onClick={() => {
                                    void requestInstallVersion(version.version);
                                  }}
                                >
                                  安装此版本
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
            </ScrollArea>
          )}
        </div>
      </div>

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
            <DialogTitle>确认安装未验证扩展</DialogTitle>
            <DialogDescription>
              {pendingInstall
                ? pendingInstall.reviewStatus === "revoked"
                  ? `「${pendingInstall.displayName} ${pendingInstall.version}」当前状态是 revoked。只有在你明确接受高风险的情况下才应继续安装。`
                  : `「${pendingInstall.displayName} ${pendingInstall.version}」当前不是 verified 状态。确认后仍会继续进行宿主兼容性与安装校验。`
                : "该扩展当前不是 verified 状态。"}
            </DialogDescription>
          </DialogHeader>

          <div
            className={cn(
              "rounded-2xl px-4 py-3 text-sm leading-relaxed",
              pendingInstall?.reviewStatus === "revoked"
                ? "border border-destructive/35 bg-destructive/10 text-destructive"
                : "border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100",
            )}
          >
            建议在安装前检查 requested capabilities、README 与仓库来源。该确认只允许继续本次安装，不会放宽后续校验。
          </div>

          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => setPendingInstall(null)} disabled={marketplaceBusy}>
              取消
            </Button>
            <Button
              type="button"
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
              {marketplaceBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              继续安装
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
