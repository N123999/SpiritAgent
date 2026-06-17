import { useTranslation } from "react-i18next";

import type { SettingsViewProps } from "@/components/settings/types";
import { Button } from "@/components/ui/button";

export function DeveloperSettingsPanel({
  onStartCompactionUiDemo,
}: Pick<SettingsViewProps, "onStartCompactionUiDemo">) {
  const { t } = useTranslation();
  return (
    <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80 px-4 sm:px-5">
      <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">{t("settings.compactionDemoTitle")}</p>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("settings.compactionDemoDescription")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 self-start sm:self-center"
          disabled={!onStartCompactionUiDemo}
          onClick={() => onStartCompactionUiDemo?.()}
        >
          {t("settings.demoInConversation")}
        </Button>
      </div>
    </div>
  );
}
