import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitPullRequest } from "lucide-react";

import { Button } from "@/components/ui/button";
import { WorkspacePrDetailView } from "@/components/workspace-pr-detail-view";
import { GITHUB_PR_DETAIL_DEMO } from "@/lib/github-pr-ui-demo";
import { cn } from "@/lib/utils";
import type {
  DesktopGitSnapshot,
  GetGitHubPullRequestDetailRequest,
  GitHubAuthStatus,
  GitHubDeviceAuthChallenge,
  GitHubPullRequestDetail,
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
  className,
}: WorkspacePrTabProps) {
  const { t } = useTranslation();
  const [authStatus, setAuthStatus] = useState<GitHubAuthStatus>({ connected: false });
  const [branchResult, setBranchResult] = useState<GitHubPullRequestForBranchResult | null>(null);
  const [detail, setDetail] = useState<GitHubPullRequestDetail | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [loadingBranch, setLoadingBranch] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deviceChallenge, setDeviceChallenge] = useState<GitHubDeviceAuthChallenge | null>(null);
  const [detailDemoActive, setDetailDemoActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshGitHubPanelRef = useRef<() => Promise<void>>(async () => {});
  const prevBranchRef = useRef<string | undefined>(undefined);

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

  const loadPullRequestDetail = useCallback(
    async (result: GitHubPullRequestForBranchResult) => {
      const pullRequest = result.pullRequest;
      const repository = result.repository;
      if (!pullRequest || !repository) {
        setDetail(null);
        return;
      }

      setLoadingDetail(true);
      setError(null);
      try {
        const next = await getGitHubPullRequestDetail({
          owner: repository.owner,
          repo: repository.repo,
          number: pullRequest.number,
        });
        setDetail(next);
      } catch (loadError) {
        setDetail(null);
        setError(describeError(loadError));
        await refreshAuthStatus();
      } finally {
        setLoadingDetail(false);
      }
    },
    [getGitHubPullRequestDetail, refreshAuthStatus],
  );

  const refreshBranchPullRequest = useCallback(async () => {
    if (!prTabEnabled || !authStatus.connected) {
      setBranchResult(null);
      setDetail(null);
      return;
    }

    setLoadingBranch(true);
    setError(null);
    try {
      const result = await getGitHubPullRequestForCurrentBranch();
      setBranchResult(result);
      if (result.pullRequest && result.repository) {
        await loadPullRequestDetail(result);
      } else {
        setDetail(null);
      }
    } catch (loadError) {
      setBranchResult(null);
      setDetail(null);
      setError(describeError(loadError));
      await refreshAuthStatus();
    } finally {
      setLoadingBranch(false);
    }
  }, [
    authStatus.connected,
    getGitHubPullRequestForCurrentBranch,
    loadPullRequestDetail,
    prTabEnabled,
    refreshAuthStatus,
  ]);

  const refreshGitHubPanel = useCallback(async () => {
    if (!prTabEnabled) {
      setAuthStatus({ connected: false });
      setBranchResult(null);
      setDetail(null);
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
      return;
    }

    setLoadingBranch(true);
    setError(null);
    try {
      const result = await getGitHubPullRequestForCurrentBranch();
      setBranchResult(result);
      if (result.pullRequest && result.repository) {
        await loadPullRequestDetail(result);
      } else {
        setDetail(null);
      }
    } catch (loadError) {
      setBranchResult(null);
      setDetail(null);
      setError(describeError(loadError));
      try {
        setAuthStatus(await getGitHubAuthStatus());
      } catch (authError) {
        setError(describeError(authError));
      }
    } finally {
      setLoadingBranch(false);
    }
  }, [
    getGitHubAuthStatus,
    getGitHubPullRequestForCurrentBranch,
    loadPullRequestDetail,
    prTabEnabled,
  ]);

  refreshGitHubPanelRef.current = refreshGitHubPanel;

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
    } catch (disconnectError) {
      setError(describeError(disconnectError));
    } finally {
      setLoadingAuth(false);
    }
  };

  const openExternalUrl = (url: string) => {
    void window.spiritDesktop?.openExternalUrl(url);
  };

  if (!prTabEnabled) {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col p-3 text-muted-foreground", className)}>
        <p>{t("workspace.prElectronOnly")}</p>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
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
        <section className="text-sm">
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
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
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
          <WorkspacePrDetailView detail={GITHUB_PR_DETAIL_DEMO} onOpenExternal={openExternalUrl} />
        </section>
      ) : null}

      {!authStatus.connected && !deviceChallenge && !detailDemoActive ? (
        <section className="rounded-md border border-dashed border-border/80 bg-muted/20 p-3">
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
          {!gitSnapshot?.isRepository ? (
            <p className="text-muted-foreground">{t("workspace.prNoRepo")}</p>
          ) : loadingBranch ? (
            <p className="text-muted-foreground">{t("workspace.prLoading")}</p>
          ) : branchResult?.repository == null ? (
            <p className="text-muted-foreground">{t("workspace.prNoGitHubOrigin")}</p>
          ) : branchResult.pullRequest == null ? (
            <p className="text-muted-foreground">
              {t("workspace.prNoOpenPullRequest", {
                branch: branchResult.branch ?? gitSnapshot?.branch ?? "",
              })}
            </p>
          ) : loadingDetail && !detail ? (
            <p className="text-muted-foreground">{t("workspace.prLoadingDetail")}</p>
          ) : detail ? (
            <WorkspacePrDetailView detail={detail} onOpenExternal={openExternalUrl} />
          ) : (
            <p className="text-muted-foreground">{t("workspace.prDetailUnavailable")}</p>
          )}
        </>
      ) : null}

      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  );
}
