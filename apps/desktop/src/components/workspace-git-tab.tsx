import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { GitChangesSection } from "@/components/git-changes-section";
import { GitCommitGraph } from "@/components/git-commit-graph";
import type { WorkspaceEditorViewMode } from "@/lib/workspace-editor-navigation";
import {
  GIT_CHANGES_MIN_PX,
  GIT_HISTORY_HEADER_PX,
  GIT_HISTORY_MIN_PX,
  GIT_SPLITTER_PX,
  readGitChangesPaneRatio,
  writeGitChangesPaneRatio,
} from "@/lib/layout-prefs";
import { cn } from "@/lib/utils";
import type {
  DesktopGitSnapshot,
  GitHistorySnapshot,
  GitWorkingTreeSnapshot,
  ReadGitHistoryRequest,
  SubmitGitChipRequest,
} from "@/types";

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export type WorkspaceGitTabProps = {
  gitSnapshot?: DesktopGitSnapshot;
  isActive: boolean;
  gitChipBusy: boolean;
  readGitWorkingTree: () => Promise<GitWorkingTreeSnapshot>;
  readGitHistory: (request?: ReadGitHistoryRequest) => Promise<GitHistorySnapshot>;
  submitGitChip: (request: SubmitGitChipRequest) => Promise<boolean>;
  onOpenChangedFile?: (
    relativePath: string,
    options?: { viewMode?: WorkspaceEditorViewMode },
  ) => void;
  className?: string;
};

export function WorkspaceGitTab({
  gitSnapshot,
  isActive,
  gitChipBusy,
  readGitWorkingTree,
  readGitHistory,
  submitGitChip,
  onOpenChangedFile,
  className,
}: WorkspaceGitTabProps) {
  const { t } = useTranslation();
  const [workingTree, setWorkingTree] = useState<GitWorkingTreeSnapshot | null>(null);
  const [history, setHistory] = useState<GitHistorySnapshot | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [treeError, setTreeError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const prevTabActiveRef = useRef(false);
  const prevBranchRef = useRef<string | undefined>(undefined);
  const prevHasChangesRef = useRef<boolean | undefined>(undefined);

  const [mergeButtonFlashMerged, setMergeButtonFlashMerged] = useState(false);
  const mergeFlashTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const latestChangesPaneHeightPxRef = useRef<number | null>(null);
  const [changesPaneHeightPx, setChangesPaneHeightPx] = useState<number | null>(null);
  latestChangesPaneHeightPxRef.current = changesPaneHeightPx;
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const splitDragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const hasInitializedSplitFromStorageRef = useRef(false);
  const historyLoadMoreInFlightRef = useRef(false);
  const hasLoadedWorkingTreeRef = useRef(false);

  const clampChangesPaneHeight = useCallback((height: number): number => {
    const container = splitContainerRef.current;
    if (!container) {
      return Math.max(GIT_CHANGES_MIN_PX, height);
    }
    const max =
      container.clientHeight - GIT_HISTORY_MIN_PX - GIT_HISTORY_HEADER_PX - GIT_SPLITTER_PX;
    return Math.min(max, Math.max(GIT_CHANGES_MIN_PX, height));
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
      setChangesPaneHeightPx((prev) => {
        const storedRatio = readGitChangesPaneRatio(containerHeight);
        const next = !hasInitializedSplitFromStorageRef.current
          ? clampChangesPaneHeight(containerHeight * storedRatio)
          : prev !== null
            ? clampChangesPaneHeight(prev)
            : clampChangesPaneHeight(containerHeight * storedRatio);
        if (!hasInitializedSplitFromStorageRef.current) {
          hasInitializedSplitFromStorageRef.current = true;
        }
        return next;
      });
    };
    syncDefaultHeight();
    const observer = new ResizeObserver(syncDefaultHeight);
    observer.observe(container);
    return () => observer.disconnect();
  }, [clampChangesPaneHeight]);

  const onSplitResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsResizingSplit(true);
      const containerHeight = splitContainerRef.current?.clientHeight ?? 0;
      const startHeight =
        changesPaneHeightPx ??
        clampChangesPaneHeight(
          containerHeight * readGitChangesPaneRatio(containerHeight || undefined),
        );
      splitDragRef.current = { startY: event.clientY, startHeight };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [changesPaneHeightPx, clampChangesPaneHeight],
  );

  const onSplitResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = splitDragRef.current;
      if (!drag) {
        return;
      }
      const delta = event.clientY - drag.startY;
      const next = clampChangesPaneHeight(drag.startHeight + delta);
      latestChangesPaneHeightPxRef.current = next;
      setChangesPaneHeightPx(next);
    },
    [clampChangesPaneHeight],
  );

  const endSplitResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setIsResizingSplit(false);
    if (splitDragRef.current) {
      const container = splitContainerRef.current;
      const height = latestChangesPaneHeightPxRef.current;
      if (container && container.clientHeight > 0 && height !== null) {
        writeGitChangesPaneRatio(height / container.clientHeight, container.clientHeight);
      }
    }
    splitDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
  }, []);

  const needsPush = gitSnapshot?.needsPush === true;
  const hasChanges = gitSnapshot?.hasChanges === true;
  const pushDisabledTitle = !needsPush
    ? gitSnapshot?.pushRemote
      ? t("workspace.git.pushDisabledUpToDate")
      : t("workspace.git.pushDisabledNoRemote")
    : undefined;

  const loadWorkingTree = useCallback(async () => {
    const showLoadingIndicator = !hasLoadedWorkingTreeRef.current;
    if (showLoadingIndicator) {
      setLoadingTree(true);
    }
    setTreeError("");
    try {
      const next = await readGitWorkingTree();
      setWorkingTree(next);
      hasLoadedWorkingTreeRef.current = true;
    } catch (loadError) {
      setTreeError(describeError(loadError));
      setWorkingTree(null);
      hasLoadedWorkingTreeRef.current = false;
    } finally {
      if (showLoadingIndicator) {
        setLoadingTree(false);
      }
    }
  }, [readGitWorkingTree]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryError("");
    try {
      const next = await readGitHistory();
      setHistory(next);
    } catch (loadError) {
      setHistoryError(describeError(loadError));
      setHistory(null);
    } finally {
      setLoadingHistory(false);
    }
  }, [readGitHistory]);

  const loadMoreHistory = useCallback(async () => {
    if (historyLoadMoreInFlightRef.current || loadingMoreHistory || loadingHistory) {
      return;
    }
    if (!history?.hasMore || history.logCommits.length === 0) {
      return;
    }
    historyLoadMoreInFlightRef.current = true;
    setLoadingMoreHistory(true);
    setHistoryError("");
    try {
      const next = await readGitHistory({
        skip: history.logCommits.length,
        existingLogCommits: history.logCommits,
      });
      setHistory(next);
    } catch (loadError) {
      setHistoryError(describeError(loadError));
    } finally {
      historyLoadMoreInFlightRef.current = false;
      setLoadingMoreHistory(false);
    }
  }, [history, loadingHistory, loadingMoreHistory, readGitHistory]);

  useEffect(() => {
    if (!isActive) {
      prevTabActiveRef.current = false;
      return;
    }
    void loadWorkingTree();
  }, [isActive, loadWorkingTree, gitSnapshot?.revision]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const becameActive = !prevTabActiveRef.current;
    prevTabActiveRef.current = true;

    const branch = gitSnapshot?.branch;
    const branchChanged =
      prevBranchRef.current !== undefined && prevBranchRef.current !== branch;
    prevBranchRef.current = branch;

    const hadChanges = prevHasChangesRef.current;
    const clearedChanges = hadChanges === true && gitSnapshot?.hasChanges === false;
    prevHasChangesRef.current = gitSnapshot?.hasChanges;

    if (becameActive || branchChanged || clearedChanges) {
      void loadHistory();
    }
  }, [
    isActive,
    loadHistory,
    gitSnapshot?.revision,
    gitSnapshot?.branch,
    gitSnapshot?.hasChanges,
  ]);

  useEffect(() => {
    return () => {
      if (mergeFlashTimerRef.current !== undefined) {
        clearTimeout(mergeFlashTimerRef.current);
      }
    };
  }, []);

  const flashMergeButtonSucceeded = useCallback(() => {
    if (mergeFlashTimerRef.current !== undefined) {
      clearTimeout(mergeFlashTimerRef.current);
    }
    setMergeButtonFlashMerged(true);
    mergeFlashTimerRef.current = setTimeout(() => {
      mergeFlashTimerRef.current = undefined;
      setMergeButtonFlashMerged(false);
    }, 1000);
  }, []);

  const handleGitChip = useCallback(
    async (request: SubmitGitChipRequest) => {
      const ok = await submitGitChip(request);
      if (ok && request.action === "merge") {
        flashMergeButtonSucceeded();
      }
      return ok;
    },
    [flashMergeButtonSucceeded, submitGitChip],
  );

  const canMerge =
    gitSnapshot?.isWorktreeSession === true &&
    Boolean(gitSnapshot?.worktreeBranch) &&
    Boolean(gitSnapshot?.primaryRepoRoot);

  return (
    <div
      ref={splitContainerRef}
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden",
        isResizingSplit && "select-none",
        className,
      )}
    >
      <GitChangesSection
        className="shrink-0 overflow-hidden"
        style={
          changesPaneHeightPx !== null ? { height: changesPaneHeightPx } : { maxHeight: "45%" }
        }
        gitSnapshot={gitSnapshot}
        workingTree={workingTree}
        loading={loadingTree}
        error={treeError}
        hasChanges={hasChanges}
        needsPush={needsPush}
        canMerge={canMerge}
        gitBusy={gitChipBusy}
        mergeFlashMerged={mergeButtonFlashMerged}
        pushDisabledTitle={pushDisabledTitle}
        onGitChip={handleGitChip}
        onOpenChangedFile={onOpenChangedFile}
      />
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("workspace.git.resizeChangesHistory")}
        className={cn(
          "group relative z-10 h-1 shrink-0 cursor-row-resize touch-none select-none",
          "before:absolute before:inset-x-0 before:-top-1 before:h-3 before:content-['']",
        )}
        onPointerDown={onSplitResizePointerDown}
        onPointerMove={onSplitResizePointerMove}
        onPointerUp={endSplitResize}
        onPointerCancel={endSplitResize}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-border/40 transition-colors group-hover:bg-border/55"
          aria-hidden
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border/40 px-2 py-1.5">
          <h3 className="text-xs font-medium text-foreground">{t("workspace.git.history")}</h3>
        </div>
        <GitCommitGraph
          className="flex-1"
          history={history}
          loading={loadingHistory && history === null}
          loadingMore={loadingMoreHistory}
          hasMore={history?.hasMore === true}
          onLoadMore={loadMoreHistory}
          error={historyError}
        />
      </div>
    </div>
  );
}
