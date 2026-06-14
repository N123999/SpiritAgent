import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Clock } from "lucide-react";

import { AutomationTimeScheduleOptions } from "@/components/automation-schedule-menu";
import { GitHubMarkIcon } from "@/components/github-mark-icon";
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
import {
  DESKTOP_OVERLAY_LIST_CONTENT,
  DESKTOP_OVERLAY_LIST_FILTER_HEADER,
  DESKTOP_OVERLAY_LIST_FILTER_INPUT_GHOST,
  DESKTOP_OVERLAY_LIST_LIST_PADDING,
  DESKTOP_OVERLAY_LIST_SCROLL_AREA,
  DESKTOP_OVERLAY_LIST_SHELL,
  DESKTOP_OVERLAY_LIST_SUB_TRIGGER,
  DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH,
  stopOverlayScrollPropagation,
} from "@/lib/desktop-chrome";
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

export function AutomationTriggerMenu({
  trigger,
  disabled,
  githubConnected,
  onTriggerChange,
  listGitHubRepositories,
  searchGitHubRepositories,
}: AutomationTriggerMenuProps) {
  const { t } = useTranslation();
  const [githubSubOpen, setGithubSubOpen] = useState(false);
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

  const setGitHubTrigger = (
    repo: DesktopGitHubAutomationRepositoryItem,
    event: DesktopAutomationGitHubEvent,
  ) => {
    onTriggerChange({
      kind: "github",
      owner: repo.owner,
      repo: repo.repo,
      event,
    });
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
        <DropdownMenuSub open={githubSubOpen} onOpenChange={setGithubSubOpen}>
          <DropdownMenuSubTrigger disabled={disabled} className="gap-2">
            <GitHubMarkIcon className="size-3.5 shrink-0 text-muted-foreground/80" />
            {t("automations.trigger.github")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            className={cn(DESKTOP_OVERLAY_LIST_CONTENT, DESKTOP_OVERLAY_LIST_SHELL, "z-[130] w-72")}
          >
            {!githubConnected ? (
              <div className="max-w-56 px-3 py-2 text-xs text-muted-foreground">
                {t("automations.trigger.connectGitHubHint")}
              </div>
            ) : (
              <AutomationGitHubRepositoryList
                open={githubSubOpen}
                disabled={disabled}
                listGitHubRepositories={listGitHubRepositories}
                searchGitHubRepositories={searchGitHubRepositories}
                onSelect={setGitHubTrigger}
              />
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={disabled} className="gap-2">
            <Clock className="size-3.5 shrink-0 text-muted-foreground/80" aria-hidden />
            {t("automations.trigger.time")}
          </DropdownMenuSubTrigger>
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

function AutomationGitHubRepositoryList({
  open,
  disabled,
  listGitHubRepositories,
  searchGitHubRepositories,
  onSelect,
}: {
  open: boolean;
  disabled?: boolean;
  listGitHubRepositories(page?: number): Promise<GitHubAutomationRepositoriesSnapshot>;
  searchGitHubRepositories(
    query: string,
    page?: number,
  ): Promise<SearchGitHubAutomationRepositoriesSnapshot>;
  onSelect(
    repo: DesktopGitHubAutomationRepositoryItem,
    event: DesktopAutomationGitHubEvent,
  ): void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DesktopGitHubAutomationRepositoryItem[]>([]);
  const [loading, setLoading] = useState(false);

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
    <>
      <div className={DESKTOP_OVERLAY_LIST_FILTER_HEADER}>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("automations.trigger.repositorySearchPlaceholder")}
          className={DESKTOP_OVERLAY_LIST_FILTER_INPUT_GHOST}
          onKeyDown={(event) => event.stopPropagation()}
          autoComplete="off"
        />
      </div>
      <ScrollArea
        type="always"
        className={DESKTOP_OVERLAY_LIST_SCROLL_AREA}
        onWheel={stopOverlayScrollPropagation}
        onTouchMove={stopOverlayScrollPropagation}
      >
        <div className={DESKTOP_OVERLAY_LIST_LIST_PADDING}>
          {loading ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t("common.loading")}</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t("automations.trigger.repositoryEmpty")}</p>
          ) : (
            items.map((item) => (
              <DropdownMenuSub key={item.fullName}>
                <DropdownMenuSubTrigger
                  disabled={disabled}
                  className={DESKTOP_OVERLAY_LIST_SUB_TRIGGER}
                >
                  <span className="min-w-0 truncate">{item.fullName}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="z-[140]">
                  <DropdownMenuItem
                    disabled={disabled}
                    className="text-xs"
                    onSelect={() => onSelect(item, "pull_request_created")}
                  >
                    {t("automations.trigger.pullRequestCreated")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={disabled}
                    className="text-xs"
                    onSelect={() => onSelect(item, "issue_created")}
                  >
                    {t("automations.trigger.issueCreated")}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))
          )}
        </div>
      </ScrollArea>
    </>
  );
}

export { defaultDesktopTimeTrigger };
