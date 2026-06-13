import { useTranslation } from "react-i18next";

export function IntegrationsSettingsPanel() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">
        {t("settings.integrations")}
      </h1>
      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80" />
    </div>
  );
}
