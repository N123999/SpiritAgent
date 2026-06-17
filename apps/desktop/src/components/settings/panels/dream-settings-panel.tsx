import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { DreamGraphCard } from "@/components/dream-graph-card";
import { formatSettingsTime } from "@/components/settings/formatters";
import { SettingsRow } from "@/components/settings/settings-row";
import type { SettingsViewProps } from "@/components/settings/types";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import i18n from "@/lib/i18n";
import type { DesktopDreamOverviewItem, DesktopSnapshot } from "@/types";

function dreamCollectorStateLabel(state: DesktopSnapshot["dreams"]["collector"]["state"]): string {
  switch (state) {
    case "disabled":
      return i18n.t("settings.dreamDisabled");
    case "missing-model":
      return i18n.t("settings.dreamMissingModel");
    case "running":
      return i18n.t("settings.dreamCollecting");
    case "backoff":
      return i18n.t("settings.dreamBackoff");
    case "error":
      return i18n.t("settings.dreamError");
    default:
      return i18n.t("settings.dreamIdle");
  }
}

export function DreamSettingsPanel({
  theme,
  settings,
  snapshot,
  onSavePatch,
  onListDreamsOverview,
}: Pick<SettingsViewProps, "theme" | "settings" | "snapshot" | "onSavePatch" | "onListDreamsOverview">) {
  const { t } = useTranslation();
  const collector = snapshot?.dreams.collector;
  const disabled = !settings.dreamEnabled;
  const [dreamItems, setDreamItems] = useState<DesktopDreamOverviewItem[]>([]);
  const [dreamsLoading, setDreamsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadDreams = async () => {
      setDreamsLoading(true);
      try {
        const items = await onListDreamsOverview();
        if (!cancelled) {
          setDreamItems(items);
        }
      } catch {
        if (!cancelled) {
          setDreamItems([]);
        }
      } finally {
        if (!cancelled) {
          setDreamsLoading(false);
        }
      }
    };

    void loadDreams();
    return () => {
      cancelled = true;
    };
  }, [
    onListDreamsOverview,
    snapshot?.workspaceRoot,
    snapshot?.git.branch,
    snapshot?.dreams.collector.processedCount,
    snapshot?.dreams.collector.lastSuccessAtUnixMs,
  ]);

  return (
    <div className="space-y-6">
      <DreamGraphCard
        items={dreamItems}
        loading={dreamsLoading}
        theme={theme}
        workspaceRoot={snapshot?.workspaceRoot}
        gitBranch={snapshot?.git.branch}
        collectorState={collector?.state ?? "disabled"}
        dreamEnabled={settings.dreamEnabled}
        debugMode={settings.dreamDebugMode}
      />

      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80 px-4 sm:px-5">
        <SettingsRow
          label={t("settings.dreams")}
          description={t("settings.dreamDescription")}
          htmlFor="settings-dream-enabled"
        >
          <div className="flex items-center justify-end gap-3">
            <Badge variant="outline">Beta</Badge>
            <Checkbox
              id="settings-dream-enabled"
              checked={settings.dreamEnabled}
              onCheckedChange={(value) => void onSavePatch({ dreamEnabled: value === true })}
              className="size-5"
            />
          </div>
        </SettingsRow>

        <SettingsRow
          label={t("settings.debugMode")}
          description={t("settings.debugModeDescription")}
          htmlFor="settings-dream-debug"
        >
          <div className="flex justify-end">
            <Checkbox
              id="settings-dream-debug"
              checked={settings.dreamDebugMode}
              disabled={disabled}
              onCheckedChange={(value) => void onSavePatch({ dreamDebugMode: value === true })}
              className="size-5"
            />
          </div>
        </SettingsRow>

        <div className="py-4">
          <p className="text-sm font-medium text-foreground">{t("settings.collectorStatus")}</p>
          <div className="mt-2 grid gap-1 text-sm text-muted-foreground sm:text-right">
            <p>
              {t("settings.status")}
              <span className="font-medium text-foreground">
                {dreamCollectorStateLabel(collector?.state ?? "disabled")}
              </span>
            </p>
            <p>
              {t("settings.pendingProcessed", {
                pending: collector?.pendingCount ?? 0,
                processed: collector?.processedCount ?? 0,
              })}
            </p>
            <p>
              {t("settings.lastRun")}
              {formatSettingsTime(collector?.lastRunAtUnixMs)}
            </p>
            <p>
              {t("settings.lastSuccess")}
              {formatSettingsTime(collector?.lastSuccessAtUnixMs)}
            </p>
            {collector?.backoffUntilUnixMs ? (
              <p>
                {t("settings.backoffUntil")}
                {formatSettingsTime(collector.backoffUntilUnixMs)}
              </p>
            ) : null}
            {collector?.lastError ? (
              <p className="break-words text-destructive">{collector.lastError}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
