import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DetailPageTabs } from "@/components/detail-page-tabs";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkspacePrListRow } from "@/components/workspace-pr-list-row";
import { useWorkspaceToolsShellHorizontalDivider } from "@/lib/use-workspace-tools-shell-horizontal-divider";
import { PR_LIST_SEARCH_SHELL_DIVIDER_ATTR } from "@/lib/workspace-tools-panel-edge";
import { useWorkspaceToolsShellRowDividers } from "@/lib/use-workspace-tools-shell-row-dividers";
import { cn } from "@/lib/utils";
import type {
  GetGitHubPullRequestTabCountsRequest,
  GitHubPullRequestListItem,
  GitHubPullRequestListSnapshot,
  GitHubPullRequestTabCounts,
  GitHubRepositoryRef,
  ListGitHubPullRequestsRequest,
} from "@/types";

const SEARCH_DEBOUNCE_MS = 300;

type PrListTab = "open" | "closed";

type TabListCacheEntry = {
  items: GitHubPullRequestListItem[];
  hasMore: boolean;
  nextPage?: number;
};

function buildListCacheKey(
  repository: GitHubRepositoryRef,
  tab: PrListTab,
  query: string,
): string {
  return `${repository.owner}/${repository.repo}\0${tab}\0${query}`;
}

function buildTabCountsCacheKey(repository: GitHubRepositoryRef, query: string): string {
  return `${repository.owner}/${repository.repo}\0counts\0${query}`;
}

export type WorkspacePrListViewHandle = {
  refreshInBackground(): void;
  invalidateCacheAndRefreshInBackground(): void;
};

export type WorkspacePrListViewProps = {
  repository: GitHubRepositoryRef;
  listGitHubPullRequests: (
    request: ListGitHubPullRequestsRequest,
  ) => Promise<GitHubPullRequestListSnapshot>;
  getGitHubPullRequestTabCounts: (
    request: GetGitHubPullRequestTabCountsRequest,
  ) => Promise<GitHubPullRequestTabCounts>;
  onSelectPullRequest?: (item: GitHubPullRequestListItem) => void;
  onInitialLoadSettled?: () => void;
  className?: string;
};

export const WorkspacePrListView = forwardRef<WorkspacePrListViewHandle, WorkspacePrListViewProps>(
  function WorkspacePrListView(
    {
      repository,
      listGitHubPullRequests,
      getGitHubPullRequestTabCounts,
      onSelectPullRequest,
      onInitialLoadSettled,
      className,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<PrListTab>("open");
    const [searchInput, setSearchInput] = useState("");
    const [debouncedQuery, setDebouncedQuery] = useState("");
    const [tabCounts, setTabCounts] = useState<GitHubPullRequestTabCounts>({ open: 0, closed: 0 });
    const [items, setItems] = useState<GitHubPullRequestListItem[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [nextPage, setNextPage] = useState<number | undefined>(undefined);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const listRef = useRef<HTMLDivElement>(null);
    const searchBarRef = useRef<HTMLDivElement>(null);
    const scrollAreaRef = useRef<ComponentRef<typeof ScrollArea>>(null);
    const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
    const loadMoreInFlightRef = useRef(false);
    const fetchGenerationRef = useRef(0);
    const listCacheRef = useRef(new Map<string, TabListCacheEntry>());
    const tabCountsCacheRef = useRef(new Map<string, GitHubPullRequestTabCounts>());
    const initialLoadSettledRef = useRef(false);
    const activeTabRef = useRef(activeTab);
    const debouncedQueryRef = useRef(debouncedQuery);
    activeTabRef.current = activeTab;
    debouncedQueryRef.current = debouncedQuery;

    useWorkspaceToolsShellHorizontalDivider(
      searchBarRef,
      {
        enabled: true,
        edge: "bottom",
        dividerAttr: PR_LIST_SEARCH_SHELL_DIVIDER_ATTR,
      },
      [],
    );

    const showList = items.length > 0;

    useWorkspaceToolsShellRowDividers(listRef, [items.length, hasMore, loadingMore], {
      enabled: showList,
      trailingDivider: !hasMore && !loadingMore,
    });

    useEffect(() => {
      listCacheRef.current.clear();
      tabCountsCacheRef.current.clear();
      initialLoadSettledRef.current = false;
    }, [repository.owner, repository.repo]);

    const notifyInitialLoadSettled = useCallback(() => {
      if (initialLoadSettledRef.current) {
        return;
      }
      initialLoadSettledRef.current = true;
      onInitialLoadSettled?.();
    }, [onInitialLoadSettled]);

    useEffect(() => {
      const timerId = window.setTimeout(() => {
        setDebouncedQuery(searchInput.trim());
      }, SEARCH_DEBOUNCE_MS);
      return () => window.clearTimeout(timerId);
    }, [searchInput]);

    const readTabCountsCache = useCallback(
      (query: string): GitHubPullRequestTabCounts | undefined =>
        tabCountsCacheRef.current.get(buildTabCountsCacheKey(repository, query)),
      [repository],
    );

    const refreshTabCountsInBackground = useCallback(async () => {
      try {
        const counts = await getGitHubPullRequestTabCounts({
          owner: repository.owner,
          repo: repository.repo,
        });
        tabCountsCacheRef.current.set(buildTabCountsCacheKey(repository, ""), counts);
        if (!debouncedQueryRef.current) {
          setTabCounts(counts);
        }
      } catch {
        // Keep stale counts on background refresh failure.
      }
    }, [getGitHubPullRequestTabCounts, repository.owner, repository.repo]);

    useEffect(() => {
      void refreshTabCountsInBackground();
    }, [refreshTabCountsInBackground]);

    const writeListCache = useCallback(
      (tab: PrListTab, query: string, entry: TabListCacheEntry) => {
        listCacheRef.current.set(buildListCacheKey(repository, tab, query), entry);
      },
      [repository],
    );

    const fetchPage = useCallback(
      async (
        tab: PrListTab,
        query: string,
        page: number,
        append: boolean,
        options?: { background?: boolean },
      ) => {
        const generation = fetchGenerationRef.current;
        const background = options?.background ?? false;
        if (append) {
          setLoadingMore(true);
        } else if (!background) {
          setLoading(true);
          setError(null);
        }

        try {
          const snapshot = await listGitHubPullRequests({
            owner: repository.owner,
            repo: repository.repo,
            state: tab,
            page,
            ...(query ? { query } : {}),
          });

          if (generation !== fetchGenerationRef.current) {
            return;
          }

          setItems((current) => {
            const nextItems = append ? [...current, ...snapshot.items] : snapshot.items;
            writeListCache(tab, query, {
              items: nextItems,
              hasMore: snapshot.hasMore,
              ...(snapshot.nextPage != null ? { nextPage: snapshot.nextPage } : {}),
            });
            return nextItems;
          });
          setHasMore(snapshot.hasMore);
          setNextPage(snapshot.nextPage);

          if (query && page === 1) {
            setTabCounts((current) => {
              const next = {
                ...current,
                [tab]: snapshot.totalCount,
              };
              tabCountsCacheRef.current.set(buildTabCountsCacheKey(repository, query), next);
              return next;
            });
          }
        } catch (loadError) {
          if (generation !== fetchGenerationRef.current) {
            return;
          }
          if (!append && !background) {
            setItems([]);
            setHasMore(false);
            setNextPage(undefined);
          }
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        } finally {
          if (generation === fetchGenerationRef.current) {
            setLoading(false);
            setLoadingMore(false);
            loadMoreInFlightRef.current = false;
            if (page === 1 && !append) {
              notifyInitialLoadSettled();
            }
          }
        }
      },
      [listGitHubPullRequests, notifyInitialLoadSettled, repository.owner, repository.repo, writeListCache],
    );

    const refreshInBackground = useCallback(() => {
      fetchGenerationRef.current += 1;
      const query = debouncedQueryRef.current;
      void fetchPage(activeTabRef.current, query, 1, false, { background: true });
      if (!query) {
        void refreshTabCountsInBackground();
      }
    }, [fetchPage, refreshTabCountsInBackground]);

    const invalidateCacheAndRefreshInBackground = useCallback(() => {
      listCacheRef.current.clear();
      tabCountsCacheRef.current.clear();
      refreshInBackground();
    }, [refreshInBackground]);

    useImperativeHandle(
      ref,
      () => ({
        refreshInBackground,
        invalidateCacheAndRefreshInBackground,
      }),
      [invalidateCacheAndRefreshInBackground, refreshInBackground],
    );

    useEffect(() => {
      fetchGenerationRef.current += 1;

      const query = debouncedQuery;

      const cachedCounts = readTabCountsCache(query);
      if (cachedCounts) {
        setTabCounts(cachedCounts);
      }

      const cacheKey = buildListCacheKey(repository, activeTab, query);
      const cached = listCacheRef.current.get(cacheKey);
      if (cached) {
        setItems(cached.items);
        setHasMore(cached.hasMore);
        setNextPage(cached.nextPage);
        setLoading(false);
        setLoadingMore(false);
        setError(null);
        notifyInitialLoadSettled();
        return;
      }

      setItems([]);
      setHasMore(false);
      setNextPage(undefined);
      void fetchPage(activeTab, query, 1, false);
    }, [activeTab, debouncedQuery, fetchPage, notifyInitialLoadSettled, readTabCountsCache, repository]);

    const handleLoadMore = useCallback(() => {
      if (!hasMore || loadingMore || loading || !nextPage || loadMoreInFlightRef.current) {
        return;
      }
      loadMoreInFlightRef.current = true;
      void fetchPage(activeTab, debouncedQuery, nextPage, true);
    }, [activeTab, debouncedQuery, fetchPage, hasMore, loading, loadingMore, nextPage]);

    useEffect(() => {
      if (!hasMore || loadingMore) {
        return;
      }
      const root = scrollAreaRef.current?.querySelector("[data-radix-scroll-area-viewport]");
      const sentinel = loadMoreSentinelRef.current;
      if (!root || !sentinel) {
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) {
            return;
          }
          handleLoadMore();
        },
        { root, rootMargin: "160px 0px" },
      );
      observer.observe(sentinel);
      return () => observer.disconnect();
    }, [handleLoadMore, hasMore, items.length, loadingMore]);

    const tabs = [
      {
        id: "open" as const,
        label: t("workspace.prListTabOpen", { count: tabCounts.open }),
      },
      {
        id: "closed" as const,
        label: t("workspace.prListTabClosed", { count: tabCounts.closed }),
      },
    ];

    const listBody = loading && items.length === 0 ? (
      <div className="px-3 py-3 text-xs text-muted-foreground">{t("workspace.prListLoading")}</div>
    ) : !loading && items.length === 0 ? (
      <div className="px-3 py-3 text-xs text-muted-foreground">
        {debouncedQuery ? t("workspace.prListSearchEmpty") : t("workspace.prListEmpty")}
      </div>
    ) : (
      <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1" type="auto">
        <div ref={listRef}>
          {items.map((item) => (
            <WorkspacePrListRow
              key={item.number}
              item={item}
              onSelect={onSelectPullRequest}
            />
          ))}
          {hasMore || loadingMore ? (
            <div
              ref={loadMoreSentinelRef}
              className="flex min-h-10 items-center justify-center gap-2 py-2 text-xs text-muted-foreground"
            >
              {loadingMore ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                  {t("workspace.prListLoadingMore")}
                </>
              ) : hasMore ? (
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={handleLoadMore}>
                  {t("workspace.prListLoadMore")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    );

    return (
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className)}>
        <div ref={searchBarRef} className="electron-no-drag shrink-0 px-1.5 py-1.5">
          <div className="relative min-w-0">
            <Search
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t("workspace.prListSearchPlaceholder")}
              aria-label={t("workspace.prListSearchPlaceholder")}
              className={cn(
                "h-7 min-w-0 w-full border-0 bg-transparent py-0 pl-7 pr-2 text-xs shadow-none",
                "focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent",
              )}
            />
          </div>
        </div>

        <DetailPageTabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          ariaLabel={t("workspace.prListTabsAria")}
          size="compact"
          tabListClassName="pt-3"
          className="min-h-0 flex-1"
          contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {listBody}
        </DetailPageTabs>

        {error ? <p className="shrink-0 px-3 pb-3 text-xs text-destructive">{error}</p> : null}
      </div>
    );
  },
);
