import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, GitPullRequest } from "lucide-react";

import { Button } from "@/components/ui/button";
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

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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
  const [error, setError] = useState<string | null>(null);

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
      setDetail(null);
    } catch (loadError) {
      setBranchResult(null);
      setDetail(null);
      setError(describeError(loadError));
      await refreshAuthStatus();
    } finally {
      setLoadingBranch(false);
    }
  }, [authStatus.connected, getGitHubPullRequestForCurrentBranch, prTabEnabled]);

  useEffect(() => {
    if (!isActive || !prTabEnabled) {
      return;
    }
    void refreshAuthStatus();
  }, [isActive, prTabEnabled, refreshAuthStatus]);

  useEffect(() => {
    if (!isActive || !prTabEnabled || !authStatus.connected) {
      return;
    }
    void refreshBranchPullRequest();
  }, [
    authStatus.connected,
    gitSnapshot?.branch,
    gitSnapshot?.selectedBranch,
    gitSnapshot?.revision,
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
      setDeviceChallenge(null);
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

  const handleLoadDetail = async () => {
    const pullRequest = branchResult?.pullRequest;
    const repository = branchResult?.repository;
    if (!pullRequest || !repository) {
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
      setError(describeError(loadError));
      await refreshAuthStatus();
    } finally {
      setLoadingDetail(false);
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
        <section className="rounded-md border border-border/70 bg-background/40 p-3 text-sm">
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

      {!authStatus.connected && !deviceChallenge ? (
        <section className="rounded-md border border-dashed border-border/80 bg-muted/20 p-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("workspace.prSampleDataLabel")}
          </p>
          <div className="flex items-start gap-2 text-sm">
            <GitPullRequest className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium text-foreground">
                #{MOCK_PULL_REQUEST.number} {MOCK_PULL_REQUEST.title}
              </p>
              <p className="text-muted-foreground">
                {MOCK_PULL_REQUEST.state.toUpperCase()} · @{MOCK_PULL_REQUEST.authorLogin}
              </p>
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
          ) : (
            <section className="rounded-md border border-border/70 bg-background/40 p-3">
              <div className="flex items-start gap-2">
                <GitPullRequest className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">
                    #{branchResult.pullRequest.number} {branchResult.pullRequest.title}
                  </p>
                  <p className="text-muted-foreground">
                    {branchResult.pullRequest.state.toUpperCase()} · @{branchResult.pullRequest.authorLogin}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {branchResult.pullRequest.headRef} → {branchResult.pullRequest.baseRef}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={loadingDetail}
                      onClick={() => {
                        void handleLoadDetail();
                      }}
                    >
                      {loadingDetail ? t("workspace.prLoadingDetail") : t("workspace.prShowDetail")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        openExternalUrl(branchResult.pullRequest!.url);
                      }}
                    >
                      <ExternalLink className="size-3.5" aria-hidden />
                      {t("workspace.prOpenOnGitHub")}
                    </Button>
                  </div>
                  {detail ? (
                    <div className="mt-3 space-y-2 border-t border-border/60 pt-3 text-sm">
                      {detail.labels.length > 0 ? (
                        <p className="text-muted-foreground">
                          {t("workspace.prLabels", { labels: detail.labels.join(", ") })}
                        </p>
                      ) : null}
                      {detail.body ? (
                        <p className="whitespace-pre-wrap text-foreground/90">{detail.body}</p>
                      ) : (
                        <p className="text-muted-foreground">{t("workspace.prNoDescription")}</p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          )}
        </>
      ) : null}

      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  );
}
