import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DetailPageTabs } from "@/components/detail-page-tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PrConversationTimeline } from "@/components/workspace-pr-conversation-timeline";
import { WorkspacePrChecksView } from "@/components/workspace-pr-checks-view";
import { WorkspacePrChangesView } from "@/components/workspace-pr-changes-view";
import { WorkspacePrMarkdown } from "@/components/workspace-pr-markdown";
import { WorkspacePrCommitsView } from "@/components/workspace-pr-commits-view";
import { resolvePrActionMode, WorkspacePrActions } from "@/components/workspace-pr-actions";
import {
  GITHUB_PR_DRAFT_BADGE_CLASS,
  GITHUB_PR_MERGED_BADGE_CLASS,
  GITHUB_PR_OPEN_BADGE_CLASS,
} from "@/lib/github-pr-merged-badge-styles";
import { toolCardSecondaryTextClass } from "@/lib/file-tool-lsp-diagnostics-display";
import {
  PR_OVERVIEW_MIN_PX,
  PR_OVERVIEW_SPLITTER_PX,
  PR_TABS_SECTION_MIN_PX,
  readPrOverviewPaneRatio,
  writePrOverviewPaneRatio,
} from "@/lib/layout-prefs";
import { PR_OVERVIEW_SHELL_DIVIDER_ATTR } from "@/lib/workspace-tools-panel-edge";
import { useWorkspaceToolsShellHorizontalDivider } from "@/lib/use-workspace-tools-shell-horizontal-divider";
import { cn } from "@/lib/utils";
import type {
  GitHubPullRequestCheck,
  GitHubPullRequestChangedFile,
  GitHubPullRequestCommit,
  GitHubPullRequestConversationItem,
  GitHubPullRequestDetail,
  GitHubPullRequestMergeMethod,
} from "@/types";

export type WorkspacePrDetailViewProps = {
  detail: GitHubPullRequestDetail;
  conversationItems?: GitHubPullRequestConversationItem[];
  loadingConversation?: boolean;
  conversationHasMore?: boolean;
  changedFiles?: GitHubPullRequestChangedFile[];
  loadingChanges?: boolean;
  changesHasMore?: boolean;
  commits?: GitHubPullRequestCommit[];
  loadingCommits?: boolean;
  commitsHasMore?: boolean;
  checks?: GitHubPullRequestCheck[];
  loadingChecks?: boolean;
  checksHasMore?: boolean;
  actionBusy?: boolean;
  onOpenExternal: (url: string) => void;
  onMerge?: (method: GitHubPullRequestMergeMethod) => void;
  onMarkReady?: () => void;
  className?: string;
};

type WorkspacePrDetailTab = "conversations" | "commits" | "checks" | "changes";

const PR_DETAIL_TABS: readonly WorkspacePrDetailTab[] = [
  "conversations",
  "commits",
  "checks",
  "changes",
];

const PR_DETAIL_TAB_LABEL_KEYS = {
  conversations: "workspace.prTabConversations",
  commits: "workspace.prTabCommits",
  checks: "workspace.prTabChecks",
  changes: "workspace.prTabChanges",
} as const satisfies Record<WorkspacePrDetailTab, string>;

function PullRequestStatusBadge({ detail }: { detail: GitHubPullRequestDetail }) {
  const { t } = useTranslation();

  if (detail.merged) {
    return null;
  }

  if (detail.draft) {
    return (
      <Badge className={GITHUB_PR_DRAFT_BADGE_CLASS}>
        <GitPullRequestDraft className="size-3 shrink-0" aria-hidden />
        {t("workspace.prDraft")}
      </Badge>
    );
  }

  if (detail.state === "open") {
    return (
      <Badge className={GITHUB_PR_OPEN_BADGE_CLASS}>
        <GitPullRequest className="size-3 shrink-0" aria-hidden />
        {t("workspace.prOpen")}
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="gap-1">
      <GitPullRequestClosed className="size-3 shrink-0" aria-hidden />
      {t("workspace.prClosed")}
    </Badge>
  );
}

export function WorkspacePrDetailView({
  detail,
  conversationItems = [],
  loadingConversation = false,
  conversationHasMore = false,
  changedFiles = [],
  loadingChanges = false,
  changesHasMore = false,
  commits = [],
  loadingCommits = false,
  commitsHasMore = false,
  checks = [],
  loadingChecks = false,
  checksHasMore = false,
  actionBusy = false,
  onOpenExternal,
  onMerge,
  onMarkReady,
  className,
}: WorkspacePrDetailViewProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<WorkspacePrDetailTab>("conversations");
  const actionMode = resolvePrActionMode(detail);
  const mergeHasConflicts = detail.mergeableState === "dirty";
  const mergeDisabled = mergeHasConflicts;
  const mergeDisabledTitle = mergeHasConflicts ? t("workspace.prMergeConflicts") : undefined;
  const mergePrimaryLabel = mergeHasConflicts ? t("workspace.prMergeConflicts") : undefined;

  const splitContainerRef = useRef<HTMLElement>(null);
  const overviewPaneRef = useRef<HTMLDivElement>(null);
  const overviewTabsSplitterRef = useRef<HTMLDivElement>(null);
  const latestOverviewPaneHeightPxRef = useRef<number | null>(null);
  const [overviewPaneHeightPx, setOverviewPaneHeightPx] = useState<number | null>(null);
  latestOverviewPaneHeightPxRef.current = overviewPaneHeightPx;
  const [isResizingOverviewSplit, setIsResizingOverviewSplit] = useState(false);
  const overviewSplitDragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const hasInitializedOverviewSplitRef = useRef(false);

  const prShellDividerWatchRefs = useMemo(
    () => [overviewPaneRef, overviewTabsSplitterRef],
    [],
  );

  const clampOverviewPaneHeight = useCallback((height: number): number => {
    const container = splitContainerRef.current;
    if (!container) {
      return Math.max(PR_OVERVIEW_MIN_PX, height);
    }
    const max =
      container.clientHeight - PR_TABS_SECTION_MIN_PX - PR_OVERVIEW_SPLITTER_PX;
    return Math.min(max, Math.max(PR_OVERVIEW_MIN_PX, height));
  }, []);

  useLayoutEffect(() => {
    const container = splitContainerRef.current;
    if (!container) {
      return;
    }
    const syncDefaultHeight = (): void => {
      const containerHeight = container.clientHeight;
      const panelHidden = container.closest("[hidden]") !== null;
      if (containerHeight <= 0 || panelHidden) {
        return;
      }
      setOverviewPaneHeightPx((prev) => {
        const storedRatio = readPrOverviewPaneRatio(containerHeight);
        const next = !hasInitializedOverviewSplitRef.current
          ? clampOverviewPaneHeight(containerHeight * storedRatio)
          : prev !== null
            ? clampOverviewPaneHeight(prev)
            : clampOverviewPaneHeight(containerHeight * storedRatio);
        if (!hasInitializedOverviewSplitRef.current) {
          hasInitializedOverviewSplitRef.current = true;
        }
        return next;
      });
    };
    syncDefaultHeight();
    const observer = new ResizeObserver(syncDefaultHeight);
    observer.observe(container);
    return () => observer.disconnect();
  }, [clampOverviewPaneHeight]);

  useWorkspaceToolsShellHorizontalDivider(
    overviewTabsSplitterRef,
    {
      enabled: true,
      edge: "top",
      dividerAttr: PR_OVERVIEW_SHELL_DIVIDER_ATTR,
      watchRefs: [overviewPaneRef],
    },
    [overviewPaneHeightPx],
  );

  const onOverviewSplitResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsResizingOverviewSplit(true);
      const containerHeight = splitContainerRef.current?.clientHeight ?? 0;
      const startHeight =
        overviewPaneHeightPx ??
        clampOverviewPaneHeight(
          containerHeight * readPrOverviewPaneRatio(containerHeight || undefined),
        );
      overviewSplitDragRef.current = { startY: event.clientY, startHeight };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [clampOverviewPaneHeight, overviewPaneHeightPx],
  );

  const onOverviewSplitResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = overviewSplitDragRef.current;
      if (!drag) {
        return;
      }
      const delta = event.clientY - drag.startY;
      const next = clampOverviewPaneHeight(drag.startHeight + delta);
      latestOverviewPaneHeightPxRef.current = next;
      setOverviewPaneHeightPx(next);
    },
    [clampOverviewPaneHeight],
  );

  const endOverviewSplitResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setIsResizingOverviewSplit(false);
    if (overviewSplitDragRef.current) {
      const container = splitContainerRef.current;
      const height = latestOverviewPaneHeightPxRef.current;
      if (container && container.clientHeight > 0 && height !== null) {
        writePrOverviewPaneRatio(height / container.clientHeight, container.clientHeight);
      }
    }
    overviewSplitDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
  }, []);

  return (
    <article
      ref={splitContainerRef}
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden",
        isResizingOverviewSplit && "select-none",
        className,
      )}
    >
      <ScrollArea
        ref={overviewPaneRef}
        className="shrink-0 overflow-hidden"
        type="auto"
        style={
          overviewPaneHeightPx !== null
            ? { height: overviewPaneHeightPx }
            : { maxHeight: "38%" }
        }
      >
        <header className="space-y-2 px-3 pt-3 pb-3">
          <div className="relative min-w-0">
            <div
              className={cn(
                "min-w-0",
                actionMode && onMerge && onMarkReady ? "pr-[calc(theme(spacing.28)+0.25rem)]" : null,
              )}
            >
              <h2 className="m-0">
                <a
                  href={detail.url}
                  className="min-w-0 text-sm font-medium text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  aria-label={t("workspace.prOpenOnGitHub")}
                  onClick={(event) => {
                    event.preventDefault();
                    onOpenExternal(detail.url);
                  }}
                >
                  {detail.title}{" "}
                  <span className="text-[13px] font-normal text-muted-foreground">#{detail.number}</span>
                </a>
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {detail.merged ? (
                  <Badge className={GITHUB_PR_MERGED_BADGE_CLASS}>
                    <GitPullRequest className="size-3 shrink-0" aria-hidden />
                    {t("workspace.prMerged")}
                  </Badge>
                ) : (
                  <PullRequestStatusBadge detail={detail} />
                )}
                <span className="inline-flex flex-wrap items-center gap-x-1">
                  <span>@{detail.authorLogin}</span>
                  <span>{detail.headRef}</span>
                  <ArrowRight
                    className={cn("size-2.5 shrink-0", toolCardSecondaryTextClass)}
                    aria-hidden
                  />
                  <span>{detail.baseRef}</span>
                </span>
              </div>
            </div>
            {actionMode && onMerge && onMarkReady ? (
              <div className="absolute right-0 top-1/2 -translate-y-1/2">
                <WorkspacePrActions
                  mode={actionMode}
                  busy={actionBusy}
                  mergeDisabled={actionMode === "merge" ? mergeDisabled : false}
                  mergeDisabledTitle={mergeDisabledTitle}
                  mergePrimaryLabel={mergePrimaryLabel}
                  onMerge={onMerge}
                  onMarkReady={onMarkReady}
                />
              </div>
            ) : null}
          </div>
          {detail.body ? (
            <WorkspacePrMarkdown content={detail.body} className="mt-2" />
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">{t("workspace.prNoDescription")}</p>
          )}
        </header>
      </ScrollArea>

      <div
        ref={overviewTabsSplitterRef}
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("workspace.prResizeOverviewTabs")}
        className={cn(
          "group relative z-10 h-1 shrink-0 cursor-row-resize touch-none select-none",
          "before:absolute before:inset-x-0 before:-top-1 before:h-3 before:content-['']",
        )}
        onPointerDown={onOverviewSplitResizePointerDown}
        onPointerMove={onOverviewSplitResizePointerMove}
        onPointerUp={endOverviewSplitResize}
        onPointerCancel={endOverviewSplitResize}
      />

      <DetailPageTabs
        size="compact"
        tabs={PR_DETAIL_TABS.map((id) => ({
          id,
          label: t(PR_DETAIL_TAB_LABEL_KEYS[id]),
        }))}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel={t("workspace.prDetailTabsAria")}
        edgeToPanelDivider
        shellDividerWatchRefs={prShellDividerWatchRefs}
        shellDividerLayoutDeps={[overviewPaneHeightPx]}
        className="min-h-0 flex-1"
        contentClassName="min-h-0 flex-1 overflow-hidden"
      >
        {activeTab === "conversations" ? (
          <ScrollArea className="h-full min-h-0" type="auto">
            <div className="space-y-2 px-3 pt-3">
              <PrConversationTimeline items={conversationItems} loading={loadingConversation} />
              {conversationHasMore ? (
                <p className="text-xs text-muted-foreground/75 dark:text-muted-foreground/65">
                  {t("workspace.prConversationHasMore")}
                </p>
              ) : null}
            </div>
          </ScrollArea>
        ) : null}
        {activeTab === "commits" ? (
          <WorkspacePrCommitsView
            commits={commits}
            loading={loadingCommits}
            hasMore={commitsHasMore}
            onOpenExternal={onOpenExternal}
            className="h-full min-h-0"
          />
        ) : null}
        {activeTab === "checks" ? (
          <WorkspacePrChecksView
            checks={checks}
            loading={loadingChecks}
            hasMore={checksHasMore}
            onOpenExternal={onOpenExternal}
            className="h-full min-h-0"
          />
        ) : null}
        {activeTab === "changes" ? (
          <WorkspacePrChangesView
            files={changedFiles}
            loading={loadingChanges}
            hasMore={changesHasMore}
            onOpenExternal={onOpenExternal}
            className="h-full min-h-0"
          />
        ) : null}
      </DetailPageTabs>
    </article>
  );
}
