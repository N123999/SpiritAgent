import { useCallback, useMemo, useState } from "react";

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

export function useGitHubDeviceLogin(runtime: GitHubDeviceLoginRuntime) {
  const model = useMemo(() => new GitHubDeviceLoginModel(runtime), [runtime]);
  const [state, setState] = useState(() => model.snapshot());

  const refreshAuthStatus = useCallback(async () => {
    await model.refreshAuthStatus();
    syncModelState(model, setState);
  }, [model]);

  const startConnect = useCallback(async () => {
    const next = await model.startConnect();
    syncModelState(model, setState);
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
