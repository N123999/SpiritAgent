import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { GitChangesSection } from "@/components/git-changes-section";
import { GitCommitGraph } from "@/components/git-commit-graph";
import {
  WorkspaceGitCommitDialog,
  WorkspaceGitMergeDialog,
} from "@/components/workspace-git-dialogs";
import type { WorkspaceEditorViewMode } from "@/lib/workspace-editor-navigation";
import { cn } from "@/lib/utils";
import type {
  CommitChangesRequest,
  DesktopGitSnapshot,
  GitHistorySnapshot,
  GitWorkingTreeSnapshot,
  ReadGitHistoryRequest,
} from "@/types";

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

const GIT_CHANGES_MIN_PX = 88;
const GIT_HISTORY_MIN_PX = 120;
const GIT_HISTORY_HEADER_PX = 32;
const GIT_SPLITTER_PX = 4;
const GIT_CHANGES_DEFAULT_RATIO = 0.45;

export type WorkspaceGitTabProps = {
  gitSnapshot?: DesktopGitSnapshot;
  isActive: boolean;
  refreshNonce?: number;
  commitBusy: boolean;
  runtimeError: string;
  readGitWorkingTree: () => Promise<GitWorkingTreeSnapshot>;
  readGitHistory: (request?: ReadGitHistoryRequest) => Promise<GitHistorySnapshot>;
  commitChanges: (request: CommitChangesRequest) => Promise<boolean>;
  pushGitBranch: () => Promise<boolean>;
  mergeWorktreeToMain: () => Promise<boolean>;
  onOpenChangedFile?: (
    relativePath: string,
    options?: { viewMode?: WorkspaceEditorViewMode },
  ) => void;
  className?: string;
};

export function WorkspaceGitTab({
  gitSnapshot,
  isActive,
  refreshNonce = 0,
  commitBusy,
  runtimeError,
  readGitWorkingTree,
  readGitHistory,
  commitChanges,
  pushGitBranch,
  mergeWorktreeToMain,
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
  const [localRefreshNonce, setLocalRefreshNonce] = useState(0);

  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeButtonFlashMerged, setMergeButtonFlashMerged] = useState(false);
  const mergeFlashTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [commitMessageDraft, setCommitMessageDraft] = useState("");
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [changesPaneHeightPx, setChangesPaneHeightPx] = useState<number | null>(null);
  const [isResizingSplit, setIsResizingSplit] = useState(false);
  const splitDragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const historyLoadMoreInFlightRef = useRef(false);

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
      setChangesPaneHeightPx((prev) => {
        if (prev !== null) {
          return clampChangesPaneHeight(prev);
        }
        return clampChangesPaneHeight(container.clientHeight * GIT_CHANGES_DEFAULT_RATIO);
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
      const startHeight =
        changesPaneHeightPx ??
        clampChangesPaneHeight(
          (splitContainerRef.current?.clientHeight ?? 0) * GIT_CHANGES_DEFAULT_RATIO,
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
      setChangesPaneHeightPx(clampChangesPaneHeight(drag.startHeight + delta));
    },
    [clampChangesPaneHeight],
  );

  const endSplitResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setIsResizingSplit(false);
    splitDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
  }, []);

  const canOpenCommitDialog = gitSnapshot?.isRepository === true;
  const isWorktreeSession = gitSnapshot?.isWorktreeSession === true;
  const canOpenMergeDialog =
    isWorktreeSession &&
    Boolean(gitSnapshot?.worktreeBranch) &&
    Boolean(gitSnapshot?.primaryRepoRoot);
  const commitActionDisabled =
    !canOpenCommitDialog ||
    gitSnapshot?.hasChanges !== true ||
    commitBusy;
  const needsPush = gitSnapshot?.needsPush === true;
  const hasChanges = gitSnapshot?.hasChanges === true;
  const pushDisabledTitle = !needsPush
    ? gitSnapshot?.pushRemote
      ? t("workspace.git.pushDisabledUpToDate")
      : t("workspace.git.pushDisabledNoRemote")
    : undefined;

  const loadWorkingTree = useCallback(async () => {
    setLoadingTree(true);
    setTreeError("");
    try {
      const next = await readGitWorkingTree();
      setWorkingTree(next);
    } catch (loadError) {
      setTreeError(describeError(loadError));
      setWorkingTree(null);
    } finally {
      setLoadingTree(false);
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
      return;
    }
    void loadHistory();
  }, [isActive, loadHistory, refreshNonce, localRefreshNonce, gitSnapshot?.branch]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    void loadWorkingTree();
  }, [
    isActive,
    loadWorkingTree,
    refreshNonce,
    localRefreshNonce,
    gitSnapshot?.hasChanges,
    gitSnapshot?.branch,
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

  const submitCommitDialog = () => {
    void commitChanges({
      ...(commitMessageDraft.trim() ? { message: commitMessageDraft.trim() } : {}),
    }).then((ok) => {
      if (!ok) {
        return;
      }
      setCommitDialogOpen(false);
      setCommitMessageDraft("");
      setLocalRefreshNonce((value) => value + 1);
    });
  };

  const submitMergeDialog = () => {
    void mergeWorktreeToMain().then((ok) => {
      if (!ok) {
        return;
      }
      setMergeDialogOpen(false);
      flashMergeButtonSucceeded();
      setLocalRefreshNonce((value) => value + 1);
    });
  };

  const handlePush = () => {
    void pushGitBranch().then((ok) => {
      if (!ok) {
        return;
      }
      setLocalRefreshNonce((value) => value + 1);
    });
  };

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
        canMerge={canOpenMergeDialog}
        gitBusy={commitBusy}
        mergeFlashMerged={mergeButtonFlashMerged}
        pushDisabledTitle={pushDisabledTitle}
        onCommit={() => setCommitDialogOpen(true)}
        onPush={handlePush}
        onMerge={() => setMergeDialogOpen(true)}
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

      <WorkspaceGitCommitDialog
        open={commitDialogOpen}
        onOpenChange={(open) => {
          setCommitDialogOpen(open);
          if (!open) {
            setCommitMessageDraft("");
          }
        }}
        gitSnapshot={gitSnapshot}
        commitMessageDraft={commitMessageDraft}
        onCommitMessageDraftChange={setCommitMessageDraft}
        commitBusy={commitBusy}
        commitActionDisabled={commitActionDisabled}
        runtimeError={commitDialogOpen ? runtimeError : ""}
        onSubmit={submitCommitDialog}
      />

      <WorkspaceGitMergeDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        gitSnapshot={gitSnapshot}
        commitBusy={commitBusy}
        mergeActionDisabled={!canOpenMergeDialog || commitBusy}
        runtimeError={mergeDialogOpen ? runtimeError : ""}
        onSubmit={submitMergeDialog}
      />
    </div>
  );
}
