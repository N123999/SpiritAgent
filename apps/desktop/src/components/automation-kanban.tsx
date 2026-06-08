import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { DesktopAutomationRun, SessionListItem } from "@/types";
import { cn } from "@/lib/utils";

type AutomationKanbanProps = {
  runs: DesktopAutomationRun[];
  sessions: SessionListItem[];
  onOpenSession(sessionPath: string): void;
};

export function AutomationKanban({ runs, sessions, onOpenSession }: AutomationKanbanProps) {
  const { t } = useTranslation();
  const sessionTitleByPath = new Map(sessions.map((session) => [session.path, session.displayName] as const));

  const inProgress = runs.filter((run) => run.status === "running" || run.status === "blocked");
  const completed = runs.filter((run) => run.status === "completed" || run.status === "failed");

  return (
    <div className="grid min-h-[20rem] grid-cols-1 gap-4 md:grid-cols-2">
      <KanbanColumn
        title={t("automations.inProgress")}
        emptyLabel={t("automations.noRuns")}
        indicatorClassName="border-orange-500"
      >
        {inProgress.map((run) => (
          <AutomationRunCard
            key={run.id}
            run={run}
            title={sessionTitleByPath.get(run.sessionPath) ?? run.sessionPath}
            onOpen={() => onOpenSession(run.sessionPath)}
          />
        ))}
      </KanbanColumn>
      <KanbanColumn
        title={t("automations.completed")}
        emptyLabel={t("automations.noRuns")}
        indicatorClassName="border-green-500"
      >
        {completed.map((run) => (
          <AutomationRunCard
            key={run.id}
            run={run}
            title={sessionTitleByPath.get(run.sessionPath) ?? run.sessionPath}
            onOpen={() => onOpenSession(run.sessionPath)}
          />
        ))}
      </KanbanColumn>
    </div>
  );
}

function KanbanColumn({
  title,
  emptyLabel,
  indicatorClassName,
  children,
}: {
  title: string;
  emptyLabel: string;
  indicatorClassName: string;
  children: ReactNode;
}) {
  const hasItems = Boolean(children);

  return (
    <div className="flex min-h-[16rem] flex-col rounded-lg border border-border/40 bg-background/60">
      <div className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-foreground">
        <span
          className={cn("size-2.5 shrink-0 rounded-full border-2 bg-transparent", indicatorClassName)}
          aria-hidden
        />
        {title}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        {hasItems ? children : (
          <p className="py-8 text-center text-xs text-muted-foreground">{emptyLabel}</p>
        )}
      </div>
    </div>
  );
}

function AutomationRunCard({
  run,
  title,
  onOpen,
}: {
  run: DesktopAutomationRun;
  title: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "rounded-md border border-border/35 bg-background/90 px-3 py-3 text-left transition-colors",
        "hover:border-border/60 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {new Date(run.startedAtUnixMs).toLocaleString()}
      </div>
      {run.status === "failed" && run.error ? (
        <div className="mt-2 text-xs text-destructive">{run.error}</div>
      ) : null}
    </button>
  );
}
