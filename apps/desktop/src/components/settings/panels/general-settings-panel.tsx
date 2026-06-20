import { useTranslation } from "react-i18next";

import { SettingsRow } from "@/components/settings/settings-row";
import type { SettingsViewProps } from "@/components/settings/types";
import { Checkbox } from "@/components/ui/checkbox";

export function GeneralSettingsPanel({
  settings,
  onSavePatch,
}: Pick<SettingsViewProps, "settings" | "onSavePatch">) {
  const { t } = useTranslation();
  return (
    <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80 px-4 sm:px-5">
      <SettingsRow
        label={t("settings.systemNotifications")}
        description={t("settings.systemNotificationsDescription")}
        htmlFor="settings-system-notifications"
      >
        <div className="flex justify-end">
          <Checkbox
            id="settings-system-notifications"
            checked={settings.systemNotifications}
            onCheckedChange={(value) => void onSavePatch({ systemNotifications: value === true })}
            className="size-5"
          />
        </div>
      </SettingsRow>
    </div>
  );
}
