import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";

import { AutomationTimeScheduleOptions } from "@/components/automation-schedule-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH } from "@/lib/desktop-chrome";
import {
  defaultDesktopTimeTrigger,
  formatDesktopAutomationTriggerLabel,
  type DesktopAutomationGitHubEvent,
  type DesktopAutomationSchedule,
  type DesktopAutomationTrigger,
} from "@/lib/automation-trigger";
import type {
  DesktopGitHubAutomationRepositoryItem,
  GitHubAutomationRepositoriesSnapshot,
  SearchGitHubAutomationRepositoriesSnapshot,
} from "@/types";
import { cn } from "@/lib/utils";

type AutomationTriggerMenuProps = {
  trigger: DesktopAutomationTrigger;
  disabled?: boolean;
  githubConnected: boolean;
  onTriggerChange(trigger: DesktopAutomationTrigger): void;
  listGitHubRepositories(page?: number): Promise<GitHubAutomationRepositoriesSnapshot>;
  searchGitHubRepositories(
    query: string,
    page?: number,
  ): Promise<SearchGitHubAutomationRepositoriesSnapshot>;
};

function githubRepoSelected(trigger: DesktopAutomationTrigger): trigger is Extract<
  DesktopAutomationTrigger,
  { kind: "github" }
> {
  return trigger.kind === "github" && Boolean(trigger.owner.trim() && trigger.repo.trim());
}

export function AutomationTriggerMenu({
  trigger,
  disabled,
  githubConnected,
  onTriggerChange,
  listGitHubRepositories,
  searchGitHubRepositories,
}: AutomationTriggerMenuProps) {
  const { t } = useTranslation();
  const label = formatDesktopAutomationTriggerLabel(trigger, {
    hourly: t("automations.schedule.hourly"),
    dailyPrefix: t("automations.schedule.daily"),
    weeklyPrefix: t("automations.schedule.weekly"),
    weekdays: [
      t("automations.schedule.weekday0"),
      t("automations.schedule.weekday1"),
      t("automations.schedule.weekday2"),
      t("automations.schedule.weekday3"),
      t("automations.schedule.weekday4"),
      t("automations.schedule.weekday5"),
      t("automations.schedule.weekday6"),
    ],
    formatWeekly: (weekday, time) => t("automations.schedule.weeklyAt", { weekday, time }),
    githubPrefix: t("automations.trigger.github"),
    githubPullRequestCreated: t("automations.trigger.pullRequestCreated"),
    githubIssueCreated: t("automations.trigger.issueCreated"),
  });

  const timeSchedule: DesktopAutomationSchedule =
    trigger.kind === "time" ? trigger.schedule : { kind: "daily", hour: 20, minute: 0 };

  const setTimeSchedule = (schedule: DesktopAutomationSchedule) => {
    onTriggerChange({ kind: "time", schedule });
  };

  const setGitHubRepo = (repo: DesktopGitHubAutomationRepositoryItem) => {
    const currentEvent =
      trigger.kind === "github" ? trigger.event : ("pull_request_created" satisfies DesktopAutomationGitHubEvent);
    onTriggerChange({
      kind: "github",
      owner: repo.owner,
      repo: repo.repo,
      event: currentEvent,
    });
  };

  const setGitHubEvent = (event: DesktopAutomationGitHubEvent) => {
    if (trigger.kind !== "github") {
      return;
    }
    onTriggerChange({ ...trigger, event });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex h-7 max-w-full items-center gap-1 rounded-md border-0 bg-transparent px-1 text-xs font-medium text-muted-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
          )}
        >
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground/80" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn(DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH, "z-[120]")}>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={disabled}>{t("automations.trigger.github")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="z-[130] p-0">
            {!githubConnected ? (
              <div className="max-w-56 px-3 py-2 text-xs text-muted-foreground">
                {t("automations.trigger.connectGitHubHint")}
              </div>
            ) : (
              <>
                <AutomationGitHubRepositorySub
                  disabled={disabled}
                  selected={
                    trigger.kind === "github"
                      ? { owner: trigger.owner, repo: trigger.repo }
                      : undefined
                  }
                  listGitHubRepositories={listGitHubRepositories}
                  searchGitHubRepositories={searchGitHubRepositories}
                  onSelect={setGitHubRepo}
                />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger
                    disabled={disabled || !githubRepoSelected(trigger)}
                  >
                    {t("automations.trigger.event")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="z-[140]">
                    <DropdownMenuItem
                      disabled={disabled || !githubRepoSelected(trigger)}
                      onSelect={() => setGitHubEvent("pull_request_created")}
                    >
                      {t("automations.trigger.pullRequestCreated")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={disabled || !githubRepoSelected(trigger)}
                      onSelect={() => setGitHubEvent("issue_created")}
                    >
                      {t("automations.trigger.issueCreated")}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={disabled}>{t("automations.trigger.time")}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={cn(DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH, "z-[130]")}>
            <AutomationTimeScheduleOptions
              schedule={timeSchedule}
              disabled={disabled}
              onScheduleChange={setTimeSchedule}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AutomationGitHubRepositorySub({
  disabled,
  selected,
  listGitHubRepositories,
  searchGitHubRepositories,
  onSelect,
}: {
  disabled?: boolean;
  selected?: { owner: string; repo: string };
  listGitHubRepositories(page?: number): Promise<GitHubAutomationRepositoriesSnapshot>;
  searchGitHubRepositories(
    query: string,
    page?: number,
  ): Promise<SearchGitHubAutomationRepositoriesSnapshot>;
  onSelect(repo: DesktopGitHubAutomationRepositoryItem): void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DesktopGitHubAutomationRepositoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const selectedLabel = useMemo(() => {
    if (!selected?.owner || !selected.repo) {
      return t("automations.trigger.repository");
    }
    return `${selected.owner}/${selected.repo}`;
  }, [selected, t]);

  const loadRepositories = useCallback(async (searchQuery: string) => {
    setLoading(true);
    try {
      const snapshot = searchQuery.trim()
        ? await searchGitHubRepositories(searchQuery.trim())
        : await listGitHubRepositories();
      setItems(snapshot.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [listGitHubRepositories, searchGitHubRepositories]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handle = window.setTimeout(() => {
      void loadRepositories(query);
    }, query.trim() ? 300 : 0);
    return () => window.clearTimeout(handle);
  }, [loadRepositories, open, query]);

  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger disabled={disabled}>{selectedLabel}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="z-[140] w-72 p-0">
        <div className="border-b border-border/40 p-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("automations.trigger.repositorySearchPlaceholder")}
            className="h-8 border-0 bg-transparent px-2 shadow-none focus-visible:ring-0"
          />
        </div>
        <ScrollArea className="max-h-60">
          <div className="p-1">
            {loading ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">{t("common.loading")}</p>
            ) : items.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">{t("automations.trigger.repositoryEmpty")}</p>
            ) : (
              items.map((item) => (
                <DropdownMenuItem
                  key={item.fullName}
                  className="text-xs"
                  onSelect={() => onSelect(item)}
                >
                  <span className="truncate">{item.fullName}</span>
                </DropdownMenuItem>
              ))
            )}
          </div>
        </ScrollArea>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export { defaultDesktopTimeTrigger };
