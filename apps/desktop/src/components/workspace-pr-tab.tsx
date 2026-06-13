import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitPullRequest } from "lucide-react";

import { Button } from "@/components/ui/button";
import { WorkspacePrDetailSkeleton } from "@/components/workspace-pr-detail-skeleton";
import { WorkspacePrDetailView } from "@/components/workspace-pr-detail-view";
import { GITHUB_PR_CHECKS_DEMO, GITHUB_PR_COMMITS_DEMO, GITHUB_PR_CONVERSATION_DEMO, GITHUB_PR_DETAIL_DEMO, GITHUB_PR_FILES_DEMO } from "@/lib/github-pr-ui-demo";
import type { GitHubPullRequestRevealRequest } from "@/lib/workspace-pr-navigation";
import { cn } from "@/lib/utils";
import type {
  DesktopGitSnapshot,
  GetGitHubPullRequestDetailRequest,
  GitHubAuthStatus,
  GitHubDeviceAuthChallenge,
  GitHubPullRequestDetail,
  GitHubPullRequestSummary,
  GitHubPullRequestConversationSnapshot,
  GitHubPullRequestFilesSnapshot,
  GitHubPullRequestCommitsSnapshot,
  GitHubPullRequestChecksSnapshot,
  GitHubPullRequestForBranchResult,
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

export type WorkspacePrTabProps = {
  gitSnapshot?: DesktopGitSnapshot;
  isActive: boolean;
  prTabEnabled: boolean;
  getGitHubAuthStatus: () => Promise<GitHubAuthStatus>;
  beginGitHubDeviceLogin: () => Promise<GitHubDeviceAuthChallenge>;
  completeGitHubDeviceLogin: () => Promise<GitHubAuthStatus>;
  cancelGitHubDeviceLogin: () => Promise<void>;
  disconnectGitHub: () => Promise<GitHubAuthStatus>;
  getGitHubPullRequestForCurrentBranch: () => Promise<GitHubPullRequestForBranchResult>;
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
  prRevealEnabled?: boolean;
  prRevealNonce?: number;
  prRevealRequest?: GitHubPullRequestRevealRequest | null;
  className?: string;
};

export function WorkspacePrTab({
  gitSnapshot,
  isActive,
  prTabEnabled,
  getGitHubAuthStatus,
  beginGitHubDeviceLogin,
  completeGitHubDeviceLogin,
  cancelGitHubDeviceLogin,
  disconnectGitHub,
  getGitHubPullRequestForCurrentBranch,
  getGitHubPullRequestDetail,
  getGitHubPullRequestConversation,
  getGitHubPullRequestFiles,
  getGitHubPullRequestCommits,
  getGitHubPullRequestChecks,
  prRevealEnabled = false,
  prRevealNonce = 0,
  prRevealRequest = null,
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
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [loadingBranch, setLoadingBranch] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [loadingChecks, setLoadingChecks] = useState(false);
  const [deviceChallenge, setDeviceChallenge] = useState<GitHubDeviceAuthChallenge | null>(null);
  const [detailDemoActive, setDetailDemoActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshGitHubPanelRef = useRef<() => Promise<void>>(async () => {});
  const prevBranchRef = useRef<string | undefined>(undefined);
  const pinnedPullRequestRequestRef = useRef<GetGitHubPullRequestDetailRequest | null>(null);
  const detailRef = useRef<GitHubPullRequestDetail | null>(null);
  detailRef.current = detail;

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
        background: detailRef.current != null,
      });
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
  ]);

  refreshGitHubPanelRef.current = refreshGitHubPanel;

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

    if (!authStatus.connected) {
      return;
    }

    const request = pinnedPullRequestRequestRef.current;
    const currentDetail = detailRef.current;
    const background =
      currentDetail != null &&
      currentDetail.number === request.number &&
      branchResult?.repository?.owner === request.owner &&
      branchResult?.repository?.repo === request.repo;

    void loadPullRequestBundle(request, { background });
  }, [
    authStatus.connected,
    branchResult?.repository?.owner,
    branchResult?.repository?.repo,
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
    void refreshBranchPullRequest();
  }, [
    authStatus.connected,
    gitSnapshot?.branch,
    gitSnapshot?.selectedBranch,
    isActive,
    prTabEnabled,
    refreshBranchPullRequest,
  ]);

  const handleConnect = async () => {
    setLoadingAuth(true);
    setError(null);
    setDeviceChallenge(null);
    try {
      const challenge = await beginGitHubDeviceLogin();
      setDeviceChallenge(challenge);
      const next = await completeGitHubDeviceLogin();
      setAuthStatus(next);
      setDetailDemoActive(false);
      setDeviceChallenge(null);
      if (isActive) {
        await refreshGitHubPanel();
      }
    } catch (connectError) {
      setError(describeError(connectError));
      setDeviceChallenge(null);
    } finally {
      setLoadingAuth(false);
    }
  };

  const handleCancelConnect = async () => {
    setError(null);
    try {
      await cancelGitHubDeviceLogin();
    } catch (cancelError) {
      setError(describeError(cancelError));
    } finally {
      setLoadingAuth(false);
      setDeviceChallenge(null);
    }
  };

  const handleDisconnect = async () => {
    setLoadingAuth(true);
    setError(null);
    try {
      const next = await disconnectGitHub();
      setAuthStatus(next);
      setBranchResult(null);
      setDetail(null);
      setConversation(null);
      setFilesSnapshot(null);
      setCommitsSnapshot(null);
      setChecksSnapshot(null);
      pinnedPullRequestRequestRef.current = null;
    } catch (disconnectError) {
      setError(describeError(disconnectError));
    } finally {
      setLoadingAuth(false);
    }
  };

  const openExternalUrl = (url: string) => {
    void window.spiritDesktop?.openExternalUrl(url);
  };

  const isInitialPrLoad = (loadingBranch || loadingDetail) && !detail;

  if (!prTabEnabled) {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col p-3 text-muted-foreground", className)}>
        <p>{t("workspace.prElectronOnly")}</p>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pt-3">
        {authStatus.connected ? (
          <>
            <span className="text-foreground">
              {t("workspace.prConnectedAs", { login: authStatus.login ?? "GitHub" })}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loadingAuth}
              onClick={() => {
                void handleDisconnect();
              }}
            >
              {t("workspace.prDisconnect")}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              disabled={loadingAuth}
              onClick={() => {
                void handleConnect();
              }}
            >
              {loadingAuth && deviceChallenge
                ? t("workspace.prWaitingForDeviceAuth")
                : loadingAuth
                  ? t("workspace.prConnecting")
                  : t("workspace.prConnect")}
            </Button>
            {loadingAuth ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void handleCancelConnect();
                }}
              >
                {t("common.cancel")}
              </Button>
            ) : null}
          </>
        )}
      </div>

      {!authStatus.connected && deviceChallenge ? (
        <section className="px-3 pt-3 text-sm">
          <p className="text-foreground">{t("workspace.prDeviceIntro")}</p>
          <p className="mt-2 font-mono text-lg font-semibold tracking-widest text-foreground">
            {deviceChallenge.userCode}
          </p>
          <p className="mt-2 text-muted-foreground">{t("workspace.prDeviceWaiting")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              openExternalUrl(deviceChallenge.verificationUri);
            }}
          >
            {t("workspace.prOpenDevicePage")}
          </Button>
        </section>
      ) : null}

      {!authStatus.connected && !deviceChallenge && detailDemoActive ? (
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
            className="min-h-0 flex-1"
          />
        </section>
      ) : null}

      {!authStatus.connected && !deviceChallenge && !detailDemoActive ? (
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
          {isInitialPrLoad ? (
            <WorkspacePrDetailSkeleton
              className="min-h-0 flex-1"
              loadingLabel={t("workspace.prLoading")}
            />
          ) : !gitSnapshot?.isRepository ? (
            <p className="px-3 pt-3 text-muted-foreground">{t("workspace.prNoRepo")}</p>
          ) : branchResult?.repository == null ? (
            <p className="px-3 pt-3 text-muted-foreground">{t("workspace.prNoGitHubOrigin")}</p>
          ) : branchResult.pullRequest == null ? (
            <p className="px-3 pt-3 text-muted-foreground">
              {t("workspace.prNoOpenPullRequest", {
                branch: branchResult.branch ?? gitSnapshot?.branch ?? "",
              })}
            </p>
          ) : detail ? (
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
              checksHasMore={checksSnapshot?.hasMore ?? false}
              onOpenExternal={openExternalUrl}
              className="min-h-0 flex-1"
            />
          ) : (
            <p className="px-3 pt-3 text-muted-foreground">{t("workspace.prDetailUnavailable")}</p>
          )}
        </>
      ) : null}

      {error ? <p className="px-3 pb-3 text-destructive">{error}</p> : null}
    </div>
  );
}
