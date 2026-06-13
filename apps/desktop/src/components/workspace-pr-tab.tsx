import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitPullRequest, ChevronLeft } from "lucide-react";
import { appendPullRequestChecksPages } from "@spirit-agent/host-internal/github-pull-request-checks-pages";

import { Button } from "@/components/ui/button";
import { WorkspacePrDetailSkeleton } from "@/components/workspace-pr-detail-skeleton";
import { WorkspacePrDetailView } from "@/components/workspace-pr-detail-view";
import { WorkspacePrListView } from "@/components/workspace-pr-list-view";
import { GITHUB_PR_CHECKS_DEMO, GITHUB_PR_COMMITS_DEMO, GITHUB_PR_CONVERSATION_DEMO, GITHUB_PR_DETAIL_DEMO, GITHUB_PR_FILES_DEMO } from "@/lib/github-pr-ui-demo";
import type { GitHubPullRequestRevealRequest } from "@/lib/workspace-pr-navigation";
import { cn } from "@/lib/utils";
import type {
  DesktopGitSnapshot,
  GetGitHubPullRequestDetailRequest,
  GitHubAuthStatus,
  GitHubPullRequestDetail,
  GitHubPullRequestMergeMethod,
  GitHubPullRequestSummary,
  GitHubPullRequestConversationSnapshot,
  GitHubPullRequestFilesSnapshot,
  GitHubPullRequestCommitsSnapshot,
  GitHubPullRequestChecksSnapshot,
  GitHubPullRequestForBranchResult,
  ListGitHubPullRequestsRequest,
  GitHubPullRequestListSnapshot,
  GetGitHubPullRequestTabCountsRequest,
  GitHubPullRequestTabCounts,
  GitHubPullRequestListItem,
} from "@/types";

const MOCK_PULL_REQUEST = {
  number: 42,
  title: "Fix login bug",
  state: "open" as const,
  authorLogin: "octocat",
};

/** Unified refresh cadence while the PR tab stays active. */
const GITHUB_PR_REFRESH_INTERVAL_MS = 30_000;

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function resolveGitBranch(gitSnapshot?: DesktopGitSnapshot): string {
  return gitSnapshot?.selectedBranch?.trim() || gitSnapshot?.branch?.trim() || "";
}

function pullRequestSummaryFromDetail(detail: GitHubPullRequestDetail): GitHubPullRequestSummary {
  return {
    number: detail.number,
    title: detail.title,
    state: detail.state,
    url: detail.url,
    authorLogin: detail.authorLogin,
    headRef: detail.headRef,
    headSha: detail.headSha,
    baseRef: detail.baseRef,
    draft: detail.draft,
  };
}

function isSamePullRequestRequest(
  detail: GitHubPullRequestDetail | null,
  repository: GitHubPullRequestForBranchResult["repository"] | null | undefined,
  request: GetGitHubPullRequestDetailRequest,
): boolean {
  if (!detail || !repository) {
    return false;
  }
  return (
    detail.number === request.number &&
    repository.owner === request.owner &&
    repository.repo === request.repo
  );
}

function resolveActivePullRequestRequest(
  branchResult: GitHubPullRequestForBranchResult | null,
  pinnedRequest: GetGitHubPullRequestDetailRequest | null,
  detail: GitHubPullRequestDetail | null,
): GetGitHubPullRequestDetailRequest | null {
  if (pinnedRequest) {
    return pinnedRequest;
  }
  const repository = branchResult?.repository ?? null;
  if (!repository || !detail) {
    return null;
  }
  return {
    owner: repository.owner,
    repo: repository.repo,
    number: detail.number,
  };
}

export type WorkspacePrTabProps = {
  gitSnapshot?: DesktopGitSnapshot;
  isActive: boolean;
  prTabEnabled: boolean;
  getGitHubAuthStatus: () => Promise<GitHubAuthStatus>;
  getGitHubPullRequestForCurrentBranch: () => Promise<GitHubPullRequestForBranchResult>;
  listGitHubPullRequests: (
    request: ListGitHubPullRequestsRequest,
  ) => Promise<GitHubPullRequestListSnapshot>;
  getGitHubPullRequestTabCounts: (
    request: GetGitHubPullRequestTabCountsRequest,
  ) => Promise<GitHubPullRequestTabCounts>;
  getGitHubPullRequestDetail: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<GitHubPullRequestDetail>;
  getGitHubPullRequestConversation: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<GitHubPullRequestConversationSnapshot>;
  getGitHubPullRequestFiles: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<GitHubPullRequestFilesSnapshot>;
  getGitHubPullRequestCommits: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<GitHubPullRequestCommitsSnapshot>;
  getGitHubPullRequestChecks: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<GitHubPullRequestChecksSnapshot>;
  mergeGitHubPullRequest: (
    request: import("@/types").MergeGitHubPullRequestRequest,
  ) => Promise<import("@/types").GitHubPullRequestMergeResult>;
  markGitHubPullRequestReady: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<GitHubPullRequestDetail>;
  prRevealEnabled?: boolean;
  prRevealNonce?: number;
  prRevealRequest?: GitHubPullRequestRevealRequest | null;
  onPrDiffAddToSession?: (attachment: import("@/lib/pr-diff-attachment").PrDiffAttachment) => void;
  className?: string;
};

export function WorkspacePrTab({
  gitSnapshot,
  isActive,
  prTabEnabled,
  getGitHubAuthStatus,
  getGitHubPullRequestForCurrentBranch,
  listGitHubPullRequests,
  getGitHubPullRequestTabCounts,
  getGitHubPullRequestDetail,
  getGitHubPullRequestConversation,
  getGitHubPullRequestFiles,
  getGitHubPullRequestCommits,
  getGitHubPullRequestChecks,
  mergeGitHubPullRequest,
  markGitHubPullRequestReady,
  prRevealEnabled = false,
  prRevealNonce = 0,
  prRevealRequest = null,
  onPrDiffAddToSession,
  className,
}: WorkspacePrTabProps) {
  const { t } = useTranslation();
  const [authStatus, setAuthStatus] = useState<GitHubAuthStatus>({ connected: false });
  const [branchResult, setBranchResult] = useState<GitHubPullRequestForBranchResult | null>(null);
  const [detail, setDetail] = useState<GitHubPullRequestDetail | null>(null);
  const [conversation, setConversation] = useState<GitHubPullRequestConversationSnapshot | null>(
    null,
  );
  const [filesSnapshot, setFilesSnapshot] = useState<GitHubPullRequestFilesSnapshot | null>(null);
  const [commitsSnapshot, setCommitsSnapshot] = useState<GitHubPullRequestCommitsSnapshot | null>(
    null,
  );
  const [checksSnapshot, setChecksSnapshot] = useState<GitHubPullRequestChecksSnapshot | null>(
    null,
  );
  const [loadingBranch, setLoadingBranch] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [loadingChecks, setLoadingChecks] = useState(false);
  const [loadingMoreChecks, setLoadingMoreChecks] = useState(false);
  const [detailDemoActive, setDetailDemoActive] = useState(false);
  const [prActionBusy, setPrActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repositoryLoadError, setRepositoryLoadError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "detail">("list");

  const checksLoadMoreInFlightRef = useRef(false);
  const refreshGitHubPanelRef = useRef<() => Promise<void>>(async () => {});
  const prevBranchRef = useRef<string | undefined>(undefined);
  const pinnedPullRequestRequestRef = useRef<GetGitHubPullRequestDetailRequest | null>(null);
  const detailRef = useRef<GitHubPullRequestDetail | null>(null);
  const branchResultRef = useRef<GitHubPullRequestForBranchResult | null>(null);
  detailRef.current = detail;
  branchResultRef.current = branchResult;

  const refreshAuthStatus = useCallback(async () => {
    if (!prTabEnabled) {
      setAuthStatus({ connected: false });
      return;
    }
    try {
      setAuthStatus(await getGitHubAuthStatus());
    } catch (loadError) {
      setError(describeError(loadError));
    }
  }, [getGitHubAuthStatus, prTabEnabled]);

  const loadPullRequestBundle = useCallback(
    async (
      request: GetGitHubPullRequestDetailRequest,
      options?: { background?: boolean },
    ) => {
      const background = options?.background ?? false;
      if (!background) {
        setDetail(null);
        setConversation(null);
        setFilesSnapshot(null);
        setCommitsSnapshot(null);
        setChecksSnapshot(null);
        setLoadingDetail(true);
        setLoadingConversation(true);
        setLoadingChanges(true);
        setLoadingCommits(true);
        setLoadingChecks(true);
      }
      setError(null);
      try {
        const [nextDetail, nextConversation, nextFiles, nextCommits, nextChecks] = await Promise.all([
          getGitHubPullRequestDetail(request),
          getGitHubPullRequestConversation(request),
          getGitHubPullRequestFiles(request),
          getGitHubPullRequestCommits(request),
          getGitHubPullRequestChecks(request),
        ]);
        setDetail(nextDetail);
        setBranchResult({
          repository: { owner: request.owner, repo: request.repo },
          branch: nextDetail.headRef,
          pullRequest: pullRequestSummaryFromDetail(nextDetail),
        });
        setConversation(nextConversation);
        setFilesSnapshot(nextFiles);
        setCommitsSnapshot(nextCommits);
        setChecksSnapshot(nextChecks);
      } catch (loadError) {
        if (!background) {
          setDetail(null);
          setConversation(null);
          setFilesSnapshot(null);
          setCommitsSnapshot(null);
          setChecksSnapshot(null);
        }
        setError(describeError(loadError));
        await refreshAuthStatus();
      } finally {
        if (!background) {
          setLoadingDetail(false);
          setLoadingConversation(false);
          setLoadingChanges(false);
          setLoadingCommits(false);
          setLoadingChecks(false);
        }
      }
    },
    [
      getGitHubPullRequestChecks,
      getGitHubPullRequestCommits,
      getGitHubPullRequestConversation,
      getGitHubPullRequestDetail,
      getGitHubPullRequestFiles,
      refreshAuthStatus,
    ],
  );

  const loadPullRequestData = useCallback(
    async (result: GitHubPullRequestForBranchResult, options?: { background?: boolean }) => {
      const pullRequest = result.pullRequest;
      const repository = result.repository;
      if (!pullRequest || !repository) {
        setDetail(null);
        setConversation(null);
        setFilesSnapshot(null);
        setCommitsSnapshot(null);
        setChecksSnapshot(null);
        return;
      }

      await loadPullRequestBundle(
        {
          owner: repository.owner,
          repo: repository.repo,
          number: pullRequest.number,
        },
        options,
      );
    },
    [loadPullRequestBundle],
  );

  const fetchRepositoryInfo = useCallback(async () => {
    const background = branchResultRef.current != null;
    if (!background) {
      setLoadingBranch(true);
    }
    setError(null);
    setRepositoryLoadError(null);
    try {
      const result = await getGitHubPullRequestForCurrentBranch();
      setBranchResult(result);
    } catch (loadError) {
      setBranchResult(null);
      const message = describeError(loadError);
      setRepositoryLoadError(message);
      setError(message);
      await refreshAuthStatus();
    } finally {
      if (!background) {
        setLoadingBranch(false);
      }
    }
  }, [getGitHubPullRequestForCurrentBranch, refreshAuthStatus]);

  const refreshRepositoryInfo = useCallback(async () => {
    if (!prTabEnabled || !authStatus.connected) {
      setBranchResult(null);
      return;
    }

    await fetchRepositoryInfo();
  }, [authStatus.connected, fetchRepositoryInfo, prTabEnabled]);

  const refreshBranchPullRequest = useCallback(async () => {
    if (!prTabEnabled || !authStatus.connected) {
      setBranchResult(null);
      setDetail(null);
      setConversation(null);
      setFilesSnapshot(null);
      setCommitsSnapshot(null);
      setChecksSnapshot(null);
      return;
    }

    const background = detailRef.current != null;
    if (!background) {
      setLoadingBranch(true);
    }
    setError(null);
    try {
      const result = await getGitHubPullRequestForCurrentBranch();
      setBranchResult(result);
      if (result.pullRequest && result.repository) {
        await loadPullRequestData(result, { background });
      } else {
        setDetail(null);
        setConversation(null);
        setFilesSnapshot(null);
        setCommitsSnapshot(null);
        setChecksSnapshot(null);
      }
    } catch (loadError) {
      if (!background) {
        setBranchResult(null);
        setDetail(null);
        setConversation(null);
        setFilesSnapshot(null);
        setCommitsSnapshot(null);
        setChecksSnapshot(null);
      }
      setError(describeError(loadError));
      await refreshAuthStatus();
    } finally {
      if (!background) {
        setLoadingBranch(false);
      }
    }
  }, [
    authStatus.connected,
    getGitHubPullRequestForCurrentBranch,
    loadPullRequestData,
    prTabEnabled,
    refreshAuthStatus,
  ]);

  const refreshGitHubPanel = useCallback(async () => {
    if (!prTabEnabled) {
      setAuthStatus({ connected: false });
      setBranchResult(null);
      setDetail(null);
      setConversation(null);
      setFilesSnapshot(null);
      setCommitsSnapshot(null);
      setChecksSnapshot(null);
      return;
    }

    let status: GitHubAuthStatus;
    try {
      status = await getGitHubAuthStatus();
      setAuthStatus(status);
    } catch (loadError) {
      setError(describeError(loadError));
      return;
    }

    if (!status.connected) {
      setBranchResult(null);
      setDetail(null);
      setConversation(null);
      setFilesSnapshot(null);
      setCommitsSnapshot(null);
      setChecksSnapshot(null);
      return;
    }

    const pinnedRequest = pinnedPullRequestRequestRef.current;
    if (pinnedRequest) {
      setError(null);
      await loadPullRequestBundle(pinnedRequest, {
        background: isSamePullRequestRequest(
          detailRef.current,
          branchResultRef.current?.repository,
          pinnedRequest,
        ),
      });
      return;
    }

    if (viewMode === "list") {
      setError(null);
      await fetchRepositoryInfo();
      setDetail(null);
      setConversation(null);
      setFilesSnapshot(null);
      setCommitsSnapshot(null);
      setChecksSnapshot(null);
      return;
    }

    const background = detailRef.current != null;
    if (!background) {
      setLoadingBranch(true);
    }
    setError(null);
    try {
      const result = await getGitHubPullRequestForCurrentBranch();
      setBranchResult(result);
      if (result.pullRequest && result.repository) {
        await loadPullRequestData(result, { background });
      } else {
        setDetail(null);
        setConversation(null);
        setFilesSnapshot(null);
        setCommitsSnapshot(null);
        setChecksSnapshot(null);
      }
    } catch (loadError) {
      if (!background) {
        setBranchResult(null);
        setDetail(null);
        setConversation(null);
        setFilesSnapshot(null);
        setCommitsSnapshot(null);
        setChecksSnapshot(null);
      }
      setError(describeError(loadError));
      try {
        setAuthStatus(await getGitHubAuthStatus());
      } catch (authError) {
        setError(describeError(authError));
      }
    } finally {
      if (!background) {
        setLoadingBranch(false);
      }
    }
  }, [
    getGitHubAuthStatus,
    getGitHubPullRequestForCurrentBranch,
    loadPullRequestBundle,
    loadPullRequestData,
    prTabEnabled,
    fetchRepositoryInfo,
    viewMode,
  ]);

  refreshGitHubPanelRef.current = refreshGitHubPanel;

  const handleMergePullRequest = useCallback(
    async (mergeMethod: GitHubPullRequestMergeMethod) => {
      const request = resolveActivePullRequestRequest(
        branchResultRef.current,
        pinnedPullRequestRequestRef.current,
        detailRef.current,
      );
      if (!request) {
        return;
      }

      setPrActionBusy(true);
      setError(null);
      try {
        await mergeGitHubPullRequest({ ...request, mergeMethod });
        await loadPullRequestBundle(request, { background: true });
      } catch (mergeError) {
        setError(describeError(mergeError));
        await refreshAuthStatus();
      } finally {
        setPrActionBusy(false);
      }
    },
    [loadPullRequestBundle, mergeGitHubPullRequest, refreshAuthStatus],
  );

  const loadMoreChecks = useCallback(async () => {
    if (checksLoadMoreInFlightRef.current || loadingMoreChecks || loadingChecks) {
      return;
    }

    const request = resolveActivePullRequestRequest(
      branchResultRef.current,
      pinnedPullRequestRequestRef.current,
      detailRef.current,
    );
    const cursor = checksSnapshot?.nextCursor;
    if (!request || !checksSnapshot?.hasMore || !cursor) {
      return;
    }

    checksLoadMoreInFlightRef.current = true;
    setLoadingMoreChecks(true);
    setError(null);
    try {
      const nextPage = await getGitHubPullRequestChecks({
        ...request,
        checksAfter: cursor,
      });
      setChecksSnapshot({
        ...nextPage,
        checks: appendPullRequestChecksPages(checksSnapshot.checks, nextPage.checks),
      });
    } catch (loadError) {
      setError(describeError(loadError));
    } finally {
      checksLoadMoreInFlightRef.current = false;
      setLoadingMoreChecks(false);
    }
  }, [
    checksSnapshot,
    getGitHubPullRequestChecks,
    loadingChecks,
    loadingMoreChecks,
  ]);

  const handleSelectPullRequest = useCallback(
    async (item: GitHubPullRequestListItem) => {
      const repository = branchResultRef.current?.repository;
      if (!repository) {
        return;
      }

      const request: GetGitHubPullRequestDetailRequest = {
        owner: repository.owner,
        repo: repository.repo,
        number: item.number,
      };
      pinnedPullRequestRequestRef.current = request;
      setViewMode("detail");
      await loadPullRequestBundle(request);
    },
    [loadPullRequestBundle],
  );

  const handleBackToList = useCallback(() => {
    pinnedPullRequestRequestRef.current = null;
    setViewMode("list");
    setDetail(null);
    setConversation(null);
    setFilesSnapshot(null);
    setCommitsSnapshot(null);
    setChecksSnapshot(null);
  }, []);

  const handleMarkPullRequestReady = useCallback(async () => {
    const request = resolveActivePullRequestRequest(
      branchResultRef.current,
      pinnedPullRequestRequestRef.current,
      detailRef.current,
    );
    if (!request) {
      return;
    }

    setPrActionBusy(true);
    setError(null);
    try {
      await markGitHubPullRequestReady({
        ...request,
        nodeId: detailRef.current?.nodeId,
      });
      await loadPullRequestBundle(request, { background: true });
    } catch (readyError) {
      setError(describeError(readyError));
      await refreshAuthStatus();
    } finally {
      setPrActionBusy(false);
    }
  }, [loadPullRequestBundle, markGitHubPullRequestReady, refreshAuthStatus]);

  useLayoutEffect(() => {
    if (!prRevealEnabled || !prRevealRequest || prRevealNonce <= 0) {
      return;
    }

    pinnedPullRequestRequestRef.current = {
      owner: prRevealRequest.owner,
      repo: prRevealRequest.repo,
      number: prRevealRequest.number,
    };
    setDetailDemoActive(false);
    setViewMode("detail");

    if (!authStatus.connected) {
      return;
    }

    const request = pinnedPullRequestRequestRef.current;
    const background = isSamePullRequestRequest(
      detailRef.current,
      branchResultRef.current?.repository,
      request,
    );

    void loadPullRequestBundle(request, { background });
  }, [
    authStatus.connected,
    loadPullRequestBundle,
    prRevealEnabled,
    prRevealNonce,
    prRevealRequest,
  ]);

  useEffect(() => {
    if (!isActive || !prTabEnabled) {
      return;
    }

    const tick = () => {
      void refreshGitHubPanelRef.current();
    };

    tick();

    const intervalId = window.setInterval(tick, GITHUB_PR_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isActive, prTabEnabled]);

  useEffect(() => {
    if (!isActive || !prTabEnabled) {
      prevBranchRef.current = undefined;
      return;
    }

    if (!authStatus.connected) {
      prevBranchRef.current = undefined;
      return;
    }

    const branch = resolveGitBranch(gitSnapshot);
    if (prevBranchRef.current === undefined) {
      prevBranchRef.current = branch;
      return;
    }

    if (prevBranchRef.current === branch) {
      return;
    }

    prevBranchRef.current = branch;
    pinnedPullRequestRequestRef.current = null;
    setViewMode("list");
    void refreshRepositoryInfo();
  }, [
    authStatus.connected,
    gitSnapshot?.branch,
    gitSnapshot?.selectedBranch,
    isActive,
    prTabEnabled,
    refreshRepositoryInfo,
  ]);

  const openExternalUrl = (url: string) => {
    void window.spiritDesktop?.openExternalUrl(url);
  };

  const isInitialPrLoad =
    viewMode === "detail" && (loadingBranch || loadingDetail) && !detail;
  const isInitialListLoad = viewMode === "list" && loadingBranch && branchResult == null;

  if (!prTabEnabled) {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col p-3 text-muted-foreground", className)}>
        <p>{t("workspace.prElectronOnly")}</p>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
      {!authStatus.connected && detailDemoActive ? (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 pt-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              {t("workspace.prDetailDemoLabel")}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDetailDemoActive(false);
              }}
            >
              {t("workspace.prClearDetailDemo")}
            </Button>
          </div>
          <WorkspacePrDetailView
            detail={GITHUB_PR_DETAIL_DEMO}
            conversationItems={GITHUB_PR_CONVERSATION_DEMO}
            changedFiles={GITHUB_PR_FILES_DEMO.files}
            changesHasMore={GITHUB_PR_FILES_DEMO.hasMore}
            commits={GITHUB_PR_COMMITS_DEMO.commits}
            commitsHasMore={GITHUB_PR_COMMITS_DEMO.hasMore}
            checks={GITHUB_PR_CHECKS_DEMO.checks}
            checksHasMore={GITHUB_PR_CHECKS_DEMO.hasMore}
            onOpenExternal={openExternalUrl}
            onPrDiffAddToSession={onPrDiffAddToSession}
            className="min-h-0 flex-1"
          />
        </section>
      ) : null}

      {!authStatus.connected && !detailDemoActive ? (
        <section className="mx-3 mt-3 rounded-md border border-dashed border-border/80 bg-muted/20 p-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("workspace.prSampleDataLabel")}
          </p>
          <div className="flex items-start gap-2 text-sm">
            <GitPullRequest className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {MOCK_PULL_REQUEST.title}{" "}
                <span className="text-[13px] font-normal text-muted-foreground">
                  #{MOCK_PULL_REQUEST.number}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {t("workspace.prOpen")} @{MOCK_PULL_REQUEST.authorLogin}
              </p>
              <p className="mt-2 text-muted-foreground">{t("workspace.prConnectToLoadDetail")}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setDetailDemoActive(true);
                }}
              >
                {t("workspace.prShowDetailDemo")}
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {authStatus.connected ? (
        <>
          {isInitialPrLoad || isInitialListLoad ? (
            <WorkspacePrDetailSkeleton
              className="min-h-0 flex-1"
              loadingLabel={t("workspace.prLoading")}
            />
          ) : !gitSnapshot?.isRepository ? (
            <p className="px-3 pt-3 text-muted-foreground">{t("workspace.prNoRepo")}</p>
          ) : repositoryLoadError && branchResult == null ? (
            <p className="px-3 pt-3 text-destructive">{repositoryLoadError}</p>
          ) : branchResult?.repository == null ? (
            <p className="px-3 pt-3 text-muted-foreground">{t("workspace.prNoGitHubOrigin")}</p>
          ) : viewMode === "list" ? (
            <WorkspacePrListView
              repository={branchResult.repository}
              listGitHubPullRequests={listGitHubPullRequests}
              getGitHubPullRequestTabCounts={getGitHubPullRequestTabCounts}
              onSelectPullRequest={(item) => {
                void handleSelectPullRequest(item);
              }}
              className="min-h-0 flex-1"
            />
          ) : detail ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center px-3 pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={handleBackToList}
                >
                  <ChevronLeft className="size-3.5" aria-hidden />
                  {t("workspace.prListBack")}
                </Button>
              </div>
              <WorkspacePrDetailView
                detail={detail}
                conversationItems={conversation?.items ?? []}
                loadingConversation={loadingConversation}
                conversationHasMore={conversation?.hasMore ?? false}
                changedFiles={filesSnapshot?.files ?? []}
                loadingChanges={loadingChanges}
                changesHasMore={filesSnapshot?.hasMore ?? false}
                commits={commitsSnapshot?.commits ?? []}
                loadingCommits={loadingCommits}
                commitsHasMore={commitsSnapshot?.hasMore ?? false}
                checks={checksSnapshot?.checks ?? []}
                loadingChecks={loadingChecks}
                loadingMoreChecks={loadingMoreChecks}
                checksHasMore={checksSnapshot?.hasMore ?? false}
                onLoadMoreChecks={loadMoreChecks}
                actionBusy={prActionBusy}
                onOpenExternal={openExternalUrl}
                onMerge={handleMergePullRequest}
                onMarkReady={handleMarkPullRequestReady}
                onPrDiffAddToSession={onPrDiffAddToSession}
                className="min-h-0 flex-1"
              />
            </div>
          ) : (
            <p className="px-3 pt-3 text-muted-foreground">{t("workspace.prDetailUnavailable")}</p>
          )}
        </>
      ) : null}

      {error ? <p className="px-3 pb-3 text-destructive">{error}</p> : null}
    </div>
  );
}
