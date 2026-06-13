import { useCallback, useEffect, useRef, useState, type ComponentRef } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DetailPageTabs } from "@/components/detail-page-tabs";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkspacePrListRow } from "@/components/workspace-pr-list-row";
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

export type WorkspacePrListViewProps = {
  repository: GitHubRepositoryRef;
  listGitHubPullRequests: (
    request: ListGitHubPullRequestsRequest,
  ) => Promise<GitHubPullRequestListSnapshot>;
  getGitHubPullRequestTabCounts: (
    request: GetGitHubPullRequestTabCountsRequest,
  ) => Promise<GitHubPullRequestTabCounts>;
  onSelectPullRequest?: (item: GitHubPullRequestListItem) => void;
  className?: string;
};

export function WorkspacePrListView({
  repository,
  listGitHubPullRequests,
  getGitHubPullRequestTabCounts,
  onSelectPullRequest,
  className,
}: WorkspacePrListViewProps) {
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
  const scrollAreaRef = useRef<ComponentRef<typeof ScrollArea>>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreInFlightRef = useRef(false);
  const fetchGenerationRef = useRef(0);

  const showList = items.length > 0;

  useWorkspaceToolsShellRowDividers(listRef, [items.length, hasMore, loadingMore], {
    enabled: showList,
    trailingDivider: !hasMore && !loadingMore,
  });

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timerId);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;

    void getGitHubPullRequestTabCounts({
      owner: repository.owner,
      repo: repository.repo,
    })
      .then((counts) => {
        if (!cancelled) {
          setTabCounts(counts);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTabCounts({ open: 0, closed: 0 });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [getGitHubPullRequestTabCounts, repository.owner, repository.repo]);

  const fetchPage = useCallback(
    async (page: number, append: boolean) => {
      const generation = ++fetchGenerationRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError(null);
      }

      try {
        const snapshot = await listGitHubPullRequests({
          owner: repository.owner,
          repo: repository.repo,
          state: activeTab,
          page,
          ...(debouncedQuery ? { query: debouncedQuery } : {}),
        });

        if (generation !== fetchGenerationRef.current) {
          return;
        }

        setItems((current) => (append ? [...current, ...snapshot.items] : snapshot.items));
        setHasMore(snapshot.hasMore);
        setNextPage(snapshot.nextPage);

        if (!debouncedQuery && page === 1) {
          setTabCounts((current) => ({
            ...current,
            [activeTab]: snapshot.totalCount,
          }));
        }
      } catch (loadError) {
        if (generation !== fetchGenerationRef.current) {
          return;
        }
        if (!append) {
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
        }
      }
    },
    [
      activeTab,
      debouncedQuery,
      listGitHubPullRequests,
      repository.owner,
      repository.repo,
    ],
  );

  useEffect(() => {
    setItems([]);
    setHasMore(false);
    setNextPage(undefined);
    void fetchPage(1, false);
  }, [activeTab, debouncedQuery, fetchPage]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading || !nextPage || loadMoreInFlightRef.current) {
      return;
    }
    loadMoreInFlightRef.current = true;
    void fetchPage(nextPage, true);
  }, [fetchPage, hasMore, loading, loadingMore, nextPage]);

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
      <div className="shrink-0 px-3 pt-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("workspace.prListSearchPlaceholder")}
            className="h-8 pl-8"
            aria-label={t("workspace.prListSearchPlaceholder")}
          />
        </div>
      </div>

      <DetailPageTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel={t("workspace.prListTabsAria")}
        size="compact"
        className="min-h-0 flex-1"
        contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {listBody}
      </DetailPageTabs>

      {error ? <p className="shrink-0 px-3 pb-3 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
