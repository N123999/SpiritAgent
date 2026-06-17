import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/lib/i18n";
import { llmHttpVersionSelectOptions } from "@/components/settings/constants";
import { SettingsRow } from "@/components/settings/settings-row";
import type { SettingsViewProps } from "@/components/settings/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DesktopFormInput } from "@/components/ui/desktop-form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DesktopSnapshot } from "@/types";

function webHostStatusLabel(state: DesktopSnapshot["webHost"]["status"]["state"]): string {
  switch (state) {
    case "running":
      return i18n.t("settings.webHostRunning");
    case "starting":
      return i18n.t("settings.webHostStarting");
    case "error":
      return i18n.t("settings.webHostError");
    case "stopped":
      return i18n.t("settings.webHostStopped");
    default:
      return i18n.t("settings.webHostClosed");
  }
}

export function NetworksSettingsPanel({
  settings,
  snapshot,
  onSavePatch,
  onResetWebHostPairing,
}: Pick<
  SettingsViewProps,
  "settings" | "snapshot" | "onSavePatch" | "onResetWebHostPairing"
>) {
  const { t } = useTranslation();
  const webHost = snapshot?.webHost;
  const webHostUrl =
    webHost?.status.url ?? `http://${settings.webHostHost}:${settings.webHostPort}`;
  const webHostStatus = webHostStatusLabel(webHost?.status.state ?? "disabled");

  const [webHostHostDraft, setWebHostHostDraft] = useState(settings.webHostHost);
  const [webHostPortDraft, setWebHostPortDraft] = useState(String(settings.webHostPort));

  useEffect(() => {
    setWebHostHostDraft(settings.webHostHost);
  }, [settings.webHostHost]);

  useEffect(() => {
    setWebHostPortDraft(String(settings.webHostPort));
  }, [settings.webHostPort]);

  return (
    <div className="space-y-6">
      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80 px-4 sm:px-5">
        <SettingsRow
          label={t("settings.llmHttpVersion")}
          description={t("settings.llmHttpVersionDescription")}
          htmlFor="settings-llm-http-version-select"
        >
          <Select
            value={settings.llmHttpVersion}
            onValueChange={(value) => void onSavePatch({ llmHttpVersion: value as "http1.1" | "http2" })}
          >
            <SelectTrigger id="settings-llm-http-version-select" className="w-full sm:min-w-[12rem]">
              <SelectValue placeholder={t("settings.llmHttpVersion")} />
            </SelectTrigger>
            <SelectContent>
              {llmHttpVersionSelectOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </div>

      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("settings.remoteAccessSection")}</p>
        <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80 px-4 sm:px-5">
          <SettingsRow
            label={t("settings.webRemoteAccess")}
            description={t("settings.webRemoteAccessDescription")}
            htmlFor="settings-web-host-enabled"
          >
            <div className="flex items-center justify-end gap-3">
              <span className="truncate text-sm text-muted-foreground">
                {settings.webHostEnabled ? webHostStatus : t("settings.webHostClosed")}
              </span>
              <Checkbox
                id="settings-web-host-enabled"
                checked={settings.webHostEnabled}
                onCheckedChange={(value) =>
                  void onSavePatch({ webHostEnabled: value === true })
                }
                className="size-5"
              />
            </div>
          </SettingsRow>

          <SettingsRow
            label={t("settings.listenAddress")}
            description={t("settings.listenAddressDescription")}
            htmlFor="settings-web-host-host"
          >
            <DesktopFormInput
              id="settings-web-host-host"
              className="sm:text-right"
              value={webHostHostDraft}
              onChange={(event) => setWebHostHostDraft(event.target.value)}
              onBlur={() => {
                const next = webHostHostDraft.trim();
                if (next && next !== settings.webHostHost) {
                  void onSavePatch({ webHostHost: next });
                }
              }}
              disabled={!settings.webHostEnabled}
              placeholder="127.0.0.1"
            />
          </SettingsRow>

          <SettingsRow label={t("settings.listenPort")} htmlFor="settings-web-host-port">
            <DesktopFormInput
              id="settings-web-host-port"
              className="sm:text-right"
              type="number"
              min={1}
              max={65535}
              value={webHostPortDraft}
              onChange={(event) => setWebHostPortDraft(event.target.value)}
              onBlur={() => {
                const port = Number.parseInt(webHostPortDraft, 10);
                if (Number.isInteger(port) && port >= 1 && port <= 65535 && port !== settings.webHostPort) {
                  void onSavePatch({ webHostPort: port });
                }
              }}
              disabled={!settings.webHostEnabled}
              placeholder="7788"
            />
          </SettingsRow>

          <div className="py-4">
            <p className="text-sm font-medium text-foreground">{t("settings.remoteStatus")}</p>
            <div className="mt-2 grid gap-1 text-sm text-muted-foreground sm:text-right">
              <p className="truncate">
                <span className="text-foreground">
                  {settings.webHostEnabled ? webHostStatus : t("settings.webHostClosed")}
                </span>
                {settings.webHostEnabled ? ` · ${webHostUrl}` : null}
              </p>
              {webHost?.status.error ? (
                <p className="break-words text-destructive">{webHost.status.error}</p>
              ) : null}
              <p>
                {t("settings.pairing")}
                {webHost?.config.paired ? t("settings.pairingDone") : t("settings.pairingPending")}
              </p>
              {webHost?.status.pairingCode ? (
                <p className="font-mono text-foreground">{webHost.status.pairingCode}</p>
              ) : null}
              {settings.webHostEnabled && webHost?.config.paired && onResetWebHostPairing ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => void onResetWebHostPairing()}
                  >
                    {t("settings.resetPairing")}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
