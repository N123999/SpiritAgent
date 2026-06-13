import { useCallback, useEffect, useState } from "react";

import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { GitHubDeviceLoginDialog } from "@/components/github-device-login-dialog";
import { GitHubMarkIcon } from "@/components/github-mark-icon";
import { Button } from "@/components/ui/button";
import {
  useGitHubDeviceLogin,
  type GitHubDeviceLoginRuntime,
} from "@/hooks/use-github-device-login";

export type IntegrationsSettingsPanelProps = {
  isElectronShell: boolean;
  runtime: GitHubDeviceLoginRuntime;
};

export function IntegrationsSettingsPanel({
  isElectronShell,
  runtime,
}: IntegrationsSettingsPanelProps) {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const {
    authStatus,
    loadingAuth,
    deviceChallenge,
    error,
    refreshAuthStatus,
    startConnect,
    cancelConnect,
    disconnect,
  } = useGitHubDeviceLogin(runtime);

  useEffect(() => {
    if (!isElectronShell || dialogOpen || loadingAuth) {
      return;
    }
    void refreshAuthStatus();
  }, [isElectronShell, refreshAuthStatus, dialogOpen, loadingAuth]);

  const openExternalUrl = useCallback((url: string) => {
    void window.spiritDesktop?.openExternalUrl(url);
  }, []);

  const handleConnectClick = useCallback(() => {
    setDialogOpen(true);
    void (async () => {
      const next = await startConnect();
      if (next?.connected) {
        setDialogOpen(false);
      }
    })();
  }, [startConnect]);

  const handleDialogCancel = useCallback(async () => {
    await cancelConnect();
    setDialogOpen(false);
  }, [cancelConnect]);

  const handleDisconnect = useCallback(() => {
    void disconnect();
  }, [disconnect]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">
        {t("settings.integrations")}
      </h1>

      {!isElectronShell ? (
        <p className="text-sm text-muted-foreground">{t("settings.integrationsDesktopOnly")}</p>
      ) : null}

      {error && isElectronShell && !dialogOpen ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80">
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <GitHubMarkIcon className="size-4 shrink-0 text-foreground" />
              <span className="text-sm font-medium text-foreground">
                {t("settings.integrationsGitHub")}
              </span>
            </div>
            {authStatus.connected ? (
              <p className="text-xs text-muted-foreground">
                {t("settings.integrationsGitHubConnectedAs", {
                  login: authStatus.login ?? "GitHub",
                })}
              </p>
            ) : null}
          </div>
          {isElectronShell ? (
            authStatus.connected ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="shrink-0 self-start sm:self-center"
                disabled={loadingAuth}
                onClick={handleDisconnect}
              >
                {loadingAuth ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                {t("settings.integrationsGitHubDisconnect")}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                className="shrink-0 self-start sm:self-center"
                disabled={loadingAuth}
                onClick={handleConnectClick}
              >
                {t("settings.integrationsGitHubConnect")}
              </Button>
            )
          ) : null}
        </div>
      </div>

      <GitHubDeviceLoginDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        loading={loadingAuth}
        challenge={deviceChallenge}
        error={error}
        onCancel={handleDialogCancel}
        onOpenDevicePage={openExternalUrl}
      />
    </div>
  );
}
