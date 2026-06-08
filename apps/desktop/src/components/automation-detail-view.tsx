import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

import { AutomationKanban } from "@/components/automation-kanban";
import type { DesktopAutomationDetail, DesktopSnapshot, SessionListItem } from "@/types";
import { cn } from "@/lib/utils";

type AutomationDetailViewProps = {
  automationId: string;
  snapshot: DesktopSnapshot | null;
  sessions: SessionListItem[];
  onBack(): void;
  onOpenSession(sessionPath: string): void;
  getAutomation(automationId: string): Promise<DesktopAutomationDetail | undefined>;
};

export function AutomationDetailView({
  automationId,
  snapshot,
  sessions,
  onBack,
  onOpenSession,
  getAutomation,
}: AutomationDetailViewProps) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<DesktopAutomationDetail | undefined>();
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getAutomation(automationId);
      setDetail(next);
    } finally {
      setLoading(false);
    }
  }, [automationId, getAutomation]);

  useEffect(() => {
    void refresh();
  }, [refresh, snapshot?.automationsList]);

  const definition = detail?.definition;
  const listFallback = snapshot?.automationsList.find((item) => item.id === automationId);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-4xl min-h-0 flex-1 flex-col px-4 py-8">
        <div className="space-y-4">
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            <button
              type="button"
              onClick={onBack}
              className="font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("automations.detailBack")}
            </button>
            <ChevronRight className="size-3.5 text-muted-foreground/70" aria-hidden />
            <span className="font-semibold text-foreground">
              {definition?.title ?? listFallback?.title ?? automationId}
            </span>
          </nav>

          <div className={cn(loading && "opacity-70")}>
            <AutomationKanban
              runs={detail?.runs ?? []}
              sessions={sessions}
              onOpenSession={onOpenSession}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
