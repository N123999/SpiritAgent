import { useEffect, useRef, type ComponentRef } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";

import { PrConversationTimeline } from "@/components/workspace-pr-conversation-timeline";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { GitHubPullRequestConversationItem } from "@/types";

export type WorkspacePrConversationViewProps = {
  items: GitHubPullRequestConversationItem[];
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  className?: string;
};

export function WorkspacePrConversationView({
  items,
  loading = false,
  loadingMore = false,
  hasMore = false,
  onLoadMore,
  className,
}: WorkspacePrConversationViewProps) {
  const { t } = useTranslation();
  const scrollAreaRef = useRef<ComponentRef<typeof ScrollArea>>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreInFlightRef = useRef(false);

  useEffect(() => {
    if (!hasMore || !onLoadMore || loadingMore) {
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
        if (loadMoreInFlightRef.current || loadingMore) {
          return;
        }
        loadMoreInFlightRef.current = true;
        onLoadMore();
      },
      { root, rootMargin: "160px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, items.length, loadingMore, onLoadMore]);

  useEffect(() => {
    if (!loadingMore) {
      loadMoreInFlightRef.current = false;
    }
  }, [loadingMore]);

  const showLoadMoreFooter = hasMore || loadingMore;

  return (
    <ScrollArea ref={scrollAreaRef} className={cn("h-full min-h-0", className)} type="auto">
      <div className="space-y-2 px-3 py-3">
        <PrConversationTimeline items={items} loading={loading} />
        {showLoadMoreFooter ? (
          <div
            ref={loadMoreSentinelRef}
            className="flex min-h-10 items-center justify-center gap-2 text-xs text-muted-foreground"
          >
            {loadingMore ? (
              <>
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                {t("workspace.prConversationLoadingMore")}
              </>
            ) : hasMore && onLoadMore ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={onLoadMore}
              >
                {t("workspace.prConversationLoadMore")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}
