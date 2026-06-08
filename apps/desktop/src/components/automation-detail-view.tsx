import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

import { AutomationKanban } from "@/components/automation-kanban";
import { AutomationSettingsPanel } from "@/components/automation-settings-panel";
import type {
  DesktopAutomationDetail,
  DesktopSnapshot,
  DesktopUpdateAutomationRequest,
  SessionListItem,
} from "@/types";
import { cn } from "@/lib/utils";

type AutomationDetailViewProps = {
  automationId: string;
  snapshot: DesktopSnapshot | null;
  sessions: SessionListItem[];
  onBack(): void;
  onOpenSession(sessionPath: string): void;
  getAutomation(automationId: string): Promise<DesktopAutomationDetail | undefined>;
  updateAutomation(
    automationId: string,
    patch: DesktopUpdateAutomationRequest,
  ): void | Promise<void>;
  onAddWorkspace?(): void | Promise<void>;
  settingsDisabled?: boolean;
};

type AutomationDetailTab = "kanban" | "settings";

const AUTOMATION_DETAIL_TABS: ReadonlyArray<{
  id: AutomationDetailTab;
  labelKey: "automations.tabKanban" | "automations.tabSettings";
}> = [
  { id: "kanban", labelKey: "automations.tabKanban" },
  { id: "settings", labelKey: "automations.tabSettings" },
];

function AutomationDetailTabs({
  activeTab,
  onTabChange,
  children,
}: {
  activeTab: AutomationDetailTab;
  onTabChange(tab: AutomationDetailTab): void;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 pt-0.5" role="tablist" aria-label={t("automations.detailTabsAria")}>
        {AUTOMATION_DETAIL_TABS.map(({ id, labelKey }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={cn(
              "rounded-md px-3 py-2 text-sm",
              activeTab === id
                ? "font-medium text-foreground underline decoration-foreground/80 underline-offset-[10px]"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
            onClick={() => onTabChange(id)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

export function AutomationDetailView({
  automationId,
  snapshot,
  sessions,
  onBack,
  onOpenSession,
  getAutomation,
  updateAutomation,
  onAddWorkspace,
  settingsDisabled,
}: AutomationDetailViewProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<AutomationDetailTab>("kanban");
  const [detail, setDetail] = useState<DesktopAutomationDetail | undefined>();
  const [loading, setLoading] = useState(true);
  const showInitialLoadingRef = useRef(true);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
    }
    try {
      const next = await getAutomation(automationId);
      setDetail(next);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [automationId, getAutomation]);

  useEffect(() => {
    setActiveTab("kanban");
    showInitialLoadingRef.current = true;
  }, [automationId]);

  useEffect(() => {
    void refresh({ silent: !showInitialLoadingRef.current }).finally(() => {
      showInitialLoadingRef.current = false;
    });
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

          <AutomationDetailTabs activeTab={activeTab} onTabChange={setActiveTab}>
            {activeTab === "kanban" ? (
              <div className={cn(loading && "opacity-70")}>
                <AutomationKanban
                  runs={detail?.runs ?? []}
                  sessions={sessions}
                  onOpenSession={onOpenSession}
                />
              </div>
            ) : null}
            {activeTab === "settings" ? (
              <AutomationSettingsPanel
                automationId={automationId}
                definition={definition}
                snapshot={snapshot}
                disabled={settingsDisabled}
                onAddWorkspace={onAddWorkspace}
                onSave={async (patch) => {
                  await updateAutomation(automationId, patch);
                  await refresh({ silent: true });
                }}
              />
            ) : null}
          </AutomationDetailTabs>
        </div>
      </div>
    </div>
  );
}
