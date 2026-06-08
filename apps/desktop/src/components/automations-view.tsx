import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { DesktopAutomationListItem, DesktopSnapshot } from "@/types";
import { cn } from "@/lib/utils";

type AutomationsViewProps = {
  snapshot: DesktopSnapshot | null;
  apiReady: boolean;
  busyAction: string;
  onCreateAutomation: () => void;
  onOpenAutomation: (automationId: string) => void;
};

export function AutomationsView({
  snapshot,
  apiReady,
  busyAction,
  onCreateAutomation,
  onOpenAutomation,
}: AutomationsViewProps) {
  const { t } = useTranslation();
  const items = snapshot?.automationsList ?? [];
  const automationBusy = busyAction === "automation";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-2xl min-h-0 flex-1 flex-col px-4 py-8">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                {t("automations.title")}
              </h1>
              <p className="text-sm text-muted-foreground">{t("automations.subtitle")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                disabled
                title={t("automations.generateComingSoon")}
              >
                <Sparkles className="size-3.5 shrink-0" aria-hidden />
                {t("automations.generate")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                disabled={!apiReady || automationBusy}
                onClick={onCreateAutomation}
              >
                {t("automations.create")}
              </Button>
            </div>
          </div>

          <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80">
            {items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                {t("automations.empty")}
              </p>
            ) : (
              items.map((item) => (
                <AutomationListRow
                  key={item.id}
                  item={item}
                  onOpen={() => onOpenAutomation(item.id)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AutomationListRow({
  item,
  onOpen,
}: {
  item: DesktopAutomationListItem;
  onOpen: () => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full flex-col gap-1 px-4 py-4 text-left transition-colors",
        "hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{item.title}</span>
        {!item.enabled ? (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {t("automations.disabled")}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{item.scheduleLabel}</p>
    </button>
  );
}
