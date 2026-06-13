import { useEffect, useRef, type ComponentRef } from "react";
import { useTranslation } from "react-i18next";
import { Check, Circle, LoaderCircle, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { formatCiDuration } from "@/lib/format-ci-duration";
import { useElapsedDuration } from "@/lib/use-elapsed-duration";
import { useWorkspaceToolsShellRowDividers } from "@/lib/use-workspace-tools-shell-row-dividers";
import { cn } from "@/lib/utils";
import type { GitHubPullRequestCheck, GitHubPullRequestCheckState } from "@/types";

export type WorkspacePrChecksViewProps = {
  checks: GitHubPullRequestCheck[];
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onOpenExternal?: (url: string) => void;
  className?: string;
};

function CheckStateIcon({
  state,
  label,
}: {
  state: GitHubPullRequestCheckState;
  label: string;
}) {
  if (state === "success") {
    return <Check className="size-4 shrink-0 text-emerald-500" aria-label={label} />;
  }

  if (state === "failure") {
    return <X className="size-4 shrink-0 text-destructive" aria-label={label} />;
  }

  if (state === "pending") {
    return (
      <Circle
        className="size-4 shrink-0 text-muted-foreground/55"
        strokeWidth={1.5}
        aria-label={label}
      />
    );
  }

  return <Spinner className="size-3 shrink-0 text-primary" aria-label={label} />;
}

function PrCheckRow({
  check,
  onOpenExternal,
}: {
  check: GitHubPullRequestCheck;
  onOpenExternal?: (url: string) => void;
}) {
  const { t } = useTranslation();
  const isActive = check.state === "in_progress";
  const elapsedMs = useElapsedDuration(check.startedAt, isActive, check.completedAt);
  const timeLabel = formatCiDuration(Math.floor(elapsedMs / 1000));
  const stateLabel =
    check.state === "success"
      ? t("workspace.prCheckStateSuccess")
      : check.state === "failure"
        ? t("workspace.prCheckStateFailure")
        : check.state === "pending"
          ? t("workspace.prCheckStatePending")
          : t("workspace.prCheckStateInProgress");

  const row = (
    <div className="flex min-w-0 items-center gap-2 px-3 py-3">
      <CheckStateIcon state={check.state} label={stateLabel} />
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/80">
        {check.name}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/75 dark:text-muted-foreground/65">
        {check.state === "pending" ? "—" : timeLabel}
      </span>
    </div>
  );

  if (check.url && onOpenExternal) {
    return (
      <button
        type="button"
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        onClick={() => onOpenExternal(check.url!)}
      >
        {row}
      </button>
    );
  }

  return row;
}

export function WorkspacePrChecksView({
  checks,
  loading = false,
  loadingMore = false,
  hasMore = false,
  onLoadMore,
  onOpenExternal,
  className,
}: WorkspacePrChecksViewProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<ComponentRef<typeof ScrollArea>>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreInFlightRef = useRef(false);
  const showList = checks.length > 0;

  useWorkspaceToolsShellRowDividers(listRef, [checks.length, hasMore, loadingMore], {
    enabled: showList,
    trailingDivider: !hasMore && !loadingMore,
  });

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
  }, [checks.length, hasMore, loadingMore, onLoadMore]);

  useEffect(() => {
    if (!loadingMore) {
      loadMoreInFlightRef.current = false;
    }
  }, [loadingMore]);

  if (loading && checks.length === 0) {
    return (
      <div className={cn("px-3 py-3 text-xs text-muted-foreground", className)}>
        {t("workspace.prChecksLoading")}
      </div>
    );
  }

  if (!loading && checks.length === 0) {
    return (
      <div className={cn("px-3 py-3 text-xs text-muted-foreground", className)}>
        {t("workspace.prChecksEmpty")}
      </div>
    );
  }

  const showLoadMoreFooter = hasMore || loadingMore;

  return (
    <ScrollArea ref={scrollAreaRef} className={cn("min-h-0 flex-1", className)} type="auto">
      <div ref={listRef}>
        {checks.map((check) => (
          <PrCheckRow key={check.id} check={check} onOpenExternal={onOpenExternal} />
        ))}
        {showLoadMoreFooter ? (
          <div
            ref={loadMoreSentinelRef}
            className="flex min-h-10 items-center justify-center gap-2 py-2 text-xs text-muted-foreground"
          >
            {loadingMore ? (
              <>
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                {t("workspace.prChecksLoadingMore")}
              </>
            ) : hasMore && onLoadMore ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={onLoadMore}
              >
                {t("workspace.prChecksLoadMore")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}
