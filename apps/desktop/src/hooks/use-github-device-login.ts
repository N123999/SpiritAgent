import { useCallback, useMemo, useRef, useState } from "react";

import {
  GitHubDeviceLoginModel,
  type GitHubDeviceLoginRuntime,
} from "./github-device-login-model";

import type { GitHubAuthStatus } from "@/types";

export type { GitHubDeviceLoginRuntime };

function syncModelState(
  model: GitHubDeviceLoginModel,
  setState: (next: ReturnType<GitHubDeviceLoginModel["snapshot"]>) => void,
) {
  setState(model.snapshot());
}

function createRuntimeProxy(getRuntime: () => GitHubDeviceLoginRuntime): GitHubDeviceLoginRuntime {
  return {
    getGitHubAuthStatus: () => getRuntime().getGitHubAuthStatus(),
    beginGitHubDeviceLogin: () => getRuntime().beginGitHubDeviceLogin(),
    completeGitHubDeviceLogin: () => getRuntime().completeGitHubDeviceLogin(),
    cancelGitHubDeviceLogin: () => getRuntime().cancelGitHubDeviceLogin(),
    disconnectGitHub: () => getRuntime().disconnectGitHub(),
  };
}

export function useGitHubDeviceLogin(runtime: GitHubDeviceLoginRuntime) {
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  const model = useMemo(
    () => new GitHubDeviceLoginModel(createRuntimeProxy(() => runtimeRef.current)),
    [],
  );
  const [state, setState] = useState(() => model.snapshot());

  const refreshAuthStatus = useCallback(async () => {
    await model.refreshAuthStatus();
    syncModelState(model, setState);
  }, [model]);

  const startConnect = useCallback(async () => {
    const sync = () => syncModelState(model, setState);
    const next = await model.startConnect(sync);
    sync();
    return next;
  }, [model]);

  const cancelConnect = useCallback(async () => {
    await model.cancelConnect();
    syncModelState(model, setState);
  }, [model]);

  const disconnect = useCallback(async () => {
    const next = await model.disconnect();
    syncModelState(model, setState);
    return next;
  }, [model]);

  return {
    authStatus: state.authStatus,
    setAuthStatus: useCallback(
      (next: GitHubAuthStatus) => {
        model.authStatus = next;
        syncModelState(model, setState);
      },
      [model],
    ),
    loadingAuth: state.loadingAuth,
    deviceChallenge: state.deviceChallenge,
    error: state.error,
    setError: useCallback(
      (next: string | null) => {
        model.error = next;
        syncModelState(model, setState);
      },
      [model],
    ),
    refreshAuthStatus,
    startConnect,
    cancelConnect,
    disconnect,
  };
}
