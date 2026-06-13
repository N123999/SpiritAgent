import { useCallback, useEffect, useState } from "react";

import type { GitHubAuthStatus } from "@/types";

const GITHUB_AUTH_POLL_MS = 30_000;

export function useGitHubAuthConnected(
  getGitHubAuthStatus: () => Promise<GitHubAuthStatus>,
  enabled: boolean,
): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(enabled ? null : false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setConnected(false);
      return;
    }
    try {
      const status = await getGitHubAuthStatus();
      setConnected(status.connected);
    } catch {
      setConnected(false);
    }
  }, [enabled, getGitHubAuthStatus]);

  useEffect(() => {
    void refresh();
    if (!enabled) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void refresh();
    }, GITHUB_AUTH_POLL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, refresh]);

  return connected;
}
