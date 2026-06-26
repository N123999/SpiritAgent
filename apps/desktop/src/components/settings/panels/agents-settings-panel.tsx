import { useState, type ReactNode } from "react";

import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { SettingsFormState } from "@/components/settings/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { DesktopLspProviderSnapshot, DesktopSnapshot } from "@/types";
import { isDesktopInstallableProvider } from "@/lib/lsp-provider-install";

/** Agents 面板专用行布局（grid）；与 appearance 等面板的 flex SettingsRow 不同。 */
export function AgentsSettingsRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
      <div className="min-w-0 space-y-1">
        <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function providerStatusBadge(
  provider: DesktopLspProviderSnapshot,
  t: (key: string) => string,
) {
  if (provider.status === "ready") {
    return <Badge variant="outline">{t("settings.lspStatusReady")}</Badge>;
  }
  if (provider.status === "disabled") {
    return <Badge variant="secondary">{t("settings.lspStatusDisabled")}</Badge>;
  }
  return <Badge variant="secondary">{t("settings.lspStatusNotInstalled")}</Badge>;
}

export function AgentsSettingsPanel({
  settings,
  snapshot,
  lspInstallBusy,
  onSavePatch,
  onInstallLspProvider,
}: {
  settings: SettingsFormState;
  snapshot: DesktopSnapshot | null;
  lspInstallBusy: boolean;
  onSavePatch: (patch: Partial<SettingsFormState>) => Promise<void>;
  onInstallLspProvider: (providerId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const lsp = snapshot?.lsp;
  const listDisabled = !settings.lspEnabled;
  const [installTarget, setInstallTarget] = useState<DesktopLspProviderSnapshot | null>(null);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("settings.agents")}</h1>

      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80 px-4 sm:px-5">
        <AgentsSettingsRow
          label={t("settings.lspEnabled")}
          description={t("settings.lspEnabledDescription")}
          htmlFor="settings-lsp-enabled"
        >
          <div className="flex justify-end">
            <Checkbox
              id="settings-lsp-enabled"
              checked={settings.lspEnabled}
              onCheckedChange={(value) => void onSavePatch({ lspEnabled: value === true })}
              className="size-5"
            />
          </div>
        </AgentsSettingsRow>

        <AgentsSettingsRow
          label={t("settings.codeCompletionEnabled")}
          description={t("settings.codeCompletionEnabledDescription")}
          htmlFor="settings-code-completion-enabled"
        >
          <div className="flex justify-end">
            <Checkbox
              id="settings-code-completion-enabled"
              checked={settings.codeCompletionEnabled}
              onCheckedChange={(value) => void onSavePatch({ codeCompletionEnabled: value === true })}
              className="size-5"
            />
          </div>
        </AgentsSettingsRow>

        {(lsp?.providers ?? []).map((provider) => (
          <div
            key={provider.id}
            className={cn(
              "flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between",
              listDisabled && "pointer-events-none opacity-50",
            )}
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-foreground">{provider.displayName}</p>
                {providerStatusBadge(provider, t)}
              </div>
              <p className="text-xs text-muted-foreground">{provider.languages.join(" · ")}</p>
              {provider.command ? (
                <p className="truncate font-mono text-[11px] text-muted-foreground/80" title={provider.command}>
                  {provider.command}
                </p>
              ) : null}
            </div>
            {provider.status === "not_found" && settings.lspEnabled && isDesktopInstallableProvider(provider) ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={lspInstallBusy}
                onClick={() => setInstallTarget(provider)}
              >
                {lspInstallBusy ? (
                  <>
                    <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                    {t("settings.lspInstalling")}
                  </>
                ) : (
                  t("settings.lspInstall")
                )}
              </Button>
            ) : null}
          </div>
        ))}
      </div>

      <Dialog
        open={installTarget !== null}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setInstallTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t("settings.lspInstallConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("settings.lspInstallConfirmDescription", {
                package: installTarget?.npmPackage ?? "typescript-language-server",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setInstallTarget(null)}
              disabled={lspInstallBusy}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={lspInstallBusy || !installTarget}
              onClick={() => {
                if (!installTarget) {
                  return;
                }
                void onInstallLspProvider(installTarget.id).finally(() => setInstallTarget(null));
              }}
            >
              {lspInstallBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t("settings.lspInstallConfirmAction")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
