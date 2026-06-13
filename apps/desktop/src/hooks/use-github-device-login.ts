import { useCallback, useState } from "react";

import type { GitHubAuthStatus, GitHubDeviceAuthChallenge } from "@/types";

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export type GitHubDeviceLoginRuntime = {
  getGitHubAuthStatus: () => Promise<GitHubAuthStatus>;
  beginGitHubDeviceLogin: () => Promise<GitHubDeviceAuthChallenge>;
  completeGitHubDeviceLogin: () => Promise<GitHubAuthStatus>;
  cancelGitHubDeviceLogin: () => Promise<void>;
  disconnectGitHub: () => Promise<GitHubAuthStatus>;
};

export function useGitHubDeviceLogin(runtime: GitHubDeviceLoginRuntime) {
  const [authStatus, setAuthStatus] = useState<GitHubAuthStatus>({ connected: false });
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [deviceChallenge, setDeviceChallenge] = useState<GitHubDeviceAuthChallenge | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshAuthStatus = useCallback(async () => {
    try {
      setAuthStatus(await runtime.getGitHubAuthStatus());
    } catch (statusError) {
      setError(describeError(statusError));
      setAuthStatus({ connected: false });
    }
  }, [runtime]);

  const startConnect = useCallback(async (): Promise<GitHubAuthStatus | null> => {
    setLoadingAuth(true);
    setError(null);
    setDeviceChallenge(null);
    try {
      const challenge = await runtime.beginGitHubDeviceLogin();
      setDeviceChallenge(challenge);
      const next = await runtime.completeGitHubDeviceLogin();
      setAuthStatus(next);
      setDeviceChallenge(null);
      return next;
    } catch (connectError) {
      setError(describeError(connectError));
      setDeviceChallenge(null);
      return null;
    } finally {
      setLoadingAuth(false);
    }
  }, [runtime]);

  const cancelConnect = useCallback(async () => {
    setError(null);
    try {
      await runtime.cancelGitHubDeviceLogin();
    } catch (cancelError) {
      setError(describeError(cancelError));
    } finally {
      setLoadingAuth(false);
      setDeviceChallenge(null);
    }
  }, [runtime]);

  const disconnect = useCallback(async (): Promise<GitHubAuthStatus | null> => {
    setLoadingAuth(true);
    setError(null);
    try {
      const next = await runtime.disconnectGitHub();
      setAuthStatus(next);
      return next;
    } catch (disconnectError) {
      setError(describeError(disconnectError));
      return null;
    } finally {
      setLoadingAuth(false);
    }
  }, [runtime]);

  return {
    authStatus,
    setAuthStatus,
    loadingAuth,
    deviceChallenge,
    error,
    setError,
    refreshAuthStatus,
    startConnect,
    cancelConnect,
    disconnect,
  };
}
