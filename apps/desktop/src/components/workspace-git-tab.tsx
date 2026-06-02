import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { GitChangesSection } from "@/components/git-changes-section";
import { GitCommitGraph } from "@/components/git-commit-graph";
import {
  WorkspaceGitCommitDialog,
  WorkspaceGitMergeDialog,
} from "@/components/workspace-git-dialogs";
import { cn } from "@/lib/utils";
import type {
  CommitChangesRequest,
  DesktopCommitMode,
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

export type WorkspaceGitTabProps = {
  gitSnapshot?: DesktopGitSnapshot;
  isActive: boolean;
  refreshNonce?: number;
  commitBusy: boolean;
  runtimeError: string;
  readGitWorkingTree: () => Promise<GitWorkingTreeSnapshot>;
  readGitHistory: (request?: ReadGitHistoryRequest) => Promise<GitHistorySnapshot>;
  commitChanges: (request: CommitChangesRequest) => Promise<boolean>;
  mergeWorktreeToMain: () => Promise<boolean>;
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
  mergeWorktreeToMain,
  className,
}: WorkspaceGitTabProps) {
  const { t } = useTranslation();
  const [workingTree, setWorkingTree] = useState<GitWorkingTreeSnapshot | null>(null);
  const [history, setHistory] = useState<GitHistorySnapshot | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [treeError, setTreeError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [localRefreshNonce, setLocalRefreshNonce] = useState(0);

  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeButtonFlashMerged, setMergeButtonFlashMerged] = useState(false);
  const mergeFlashTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [commitMessageDraft, setCommitMessageDraft] = useState("");
  const [commitMode, setCommitMode] = useState<DesktopCommitMode>("commit");

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
  const mergeActionDisabled = !canOpenMergeDialog || commitBusy;

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

  const reloadAll = useCallback(() => {
    void loadWorkingTree();
    void loadHistory();
  }, [loadWorkingTree, loadHistory]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    reloadAll();
  }, [isActive, reloadAll, refreshNonce, localRefreshNonce, gitSnapshot?.hasChanges, gitSnapshot?.branch]);

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
      mode: commitMode,
      ...(commitMessageDraft.trim() ? { message: commitMessageDraft.trim() } : {}),
    }).then((ok) => {
      if (!ok) {
        return;
      }
      setCommitDialogOpen(false);
      setCommitMode("commit");
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

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
      <GitChangesSection
        className="max-h-[45%] shrink-0 border-b border-border/40"
        gitSnapshot={gitSnapshot}
        workingTree={workingTree}
        loading={loadingTree}
        error={treeError}
        showCommitButton={canOpenCommitDialog}
        commitDisabled={commitActionDisabled}
        commitBusy={commitBusy}
        onOpenCommitDialog={() => setCommitDialogOpen(true)}
        showMergeButton={canOpenMergeDialog}
        mergeDisabled={mergeActionDisabled}
        mergeBusy={commitBusy}
        mergeButtonFlashMerged={mergeButtonFlashMerged}
        onOpenMergeDialog={() => setMergeDialogOpen(true)}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border/40 px-2 py-1.5">
          <h3 className="text-xs font-medium text-foreground">{t("workspace.git.history")}</h3>
        </div>
        <GitCommitGraph
          className="flex-1"
          history={history}
          loading={loadingHistory}
          error={historyError}
        />
      </div>

      <WorkspaceGitCommitDialog
        open={commitDialogOpen}
        onOpenChange={(open) => {
          setCommitDialogOpen(open);
          if (!open) {
            setCommitMode("commit");
            setCommitMessageDraft("");
          }
        }}
        gitSnapshot={gitSnapshot}
        commitMessageDraft={commitMessageDraft}
        onCommitMessageDraftChange={setCommitMessageDraft}
        commitMode={commitMode}
        onCommitModeChange={setCommitMode}
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
        mergeActionDisabled={mergeActionDisabled}
        runtimeError={mergeDialogOpen ? runtimeError : ""}
        onSubmit={submitMergeDialog}
      />
    </div>
  );
}
