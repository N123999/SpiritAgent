import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GitHubDeviceAuthChallenge } from "@/types";

export type GitHubDeviceLoginDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  challenge: GitHubDeviceAuthChallenge | null;
  error: string | null;
  onCancel: () => void;
  onOpenDevicePage?: (url: string) => void;
};

export function GitHubDeviceLoginDialog({
  open,
  onOpenChange,
  loading,
  challenge,
  error,
  onCancel,
  onOpenDevicePage,
}: GitHubDeviceLoginDialogProps) {
  const { t } = useTranslation();

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      void onCancel();
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>{t("settings.integrationsGitHubConnect")}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-[10rem] flex-col items-center justify-center py-2 text-center">
          {loading && !challenge ? (
            <LoaderCircle className="size-8 animate-spin text-muted-foreground" aria-hidden />
          ) : challenge ? (
            <div className="space-y-4">
              <p className="text-xs font-medium tracking-wide text-muted-foreground">
                {t("settings.integrationsDeviceIntro")}
              </p>
              <p className="text-3xl font-semibold tracking-widest text-foreground">
                {challenge.userCode}
              </p>
              <p className="text-xs text-muted-foreground">{t("settings.integrationsDeviceWaiting")}</p>
              {onOpenDevicePage ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenDevicePage(challenge.verificationUri)}
                >
                  {t("settings.integrationsOpenDevicePage")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="text-center text-sm text-destructive">{error}</p>
        ) : null}

        <div className="flex justify-end pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading && !challenge}
            onClick={() => {
              void onCancel();
              onOpenChange(false);
            }}
          >
            {t("common.cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
