import { useState, useEffect, useRef, type ComponentRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Clock } from "lucide-react";

import { AutomationTimeScheduleOptions } from "@/components/automation-schedule-menu";
import { GitHubConnectTooltipContent } from "@/components/github-sign-in-prompt";
import { GitHubMarkIcon } from "@/components/github-mark-icon";
import { useGitHubAutomationRepositories } from "@/hooks/use-github-automation-repositories";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DESKTOP_OVERLAY_LIST_CONTENT,
  DESKTOP_OVERLAY_LIST_FILTER_HEADER,
  DESKTOP_OVERLAY_LIST_FILTER_INPUT_GHOST,
  DESKTOP_OVERLAY_LIST_LIST_PADDING,
  DESKTOP_OVERLAY_LIST_SCROLL_AREA,
  DESKTOP_OVERLAY_LIST_SHELL,
  DESKTOP_OVERLAY_LIST_SUB_TRIGGER,
  DESKTOP_OVERLAY_SHORT_LIST_PADDING,
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
import { buildAutomationTriggerFormatLabels } from "@/lib/automation-trigger-i18n";
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
  githubAuthChecking?: boolean;
  onOpenIntegrationsSettings?: () => void;
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
  githubAuthChecking,
  onOpenIntegrationsSettings,
  onTriggerChange,
  listGitHubRepositories,
  searchGitHubRepositories,
}: AutomationTriggerMenuProps) {
  const { t } = useTranslation();
  const [githubSubOpen, setGithubSubOpen] = useState(false);
  const label = formatDesktopAutomationTriggerLabel(
    trigger,
    buildAutomationTriggerFormatLabels(t),
  );

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
      <DropdownMenuContent align="start" className={cn(DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH, "z-[120] p-0")}>
        <div className={DESKTOP_OVERLAY_SHORT_LIST_PADDING}>
          <DropdownMenuSub
            open={githubConnected ? githubSubOpen : false}
            onOpenChange={(open) => {
              if (!githubConnected) {
                return;
              }
              setGithubSubOpen(open);
            }}
          >
            {!githubConnected ? (
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <span className="flex w-full min-w-0">
                    <DropdownMenuSubTrigger disabled={disabled || !githubConnected} className="gap-2">
                      <GitHubMarkIcon className="size-3.5 shrink-0 text-muted-foreground/80" />
                      {t("automations.trigger.github")}
                    </DropdownMenuSubTrigger>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {githubAuthChecking ? (
                    t("workspace.prGitHubAuthChecking")
                  ) : (
                    <GitHubConnectTooltipContent
                      onSignIn={() => {
                        onOpenIntegrationsSettings?.();
                      }}
                    />
                  )}
                </TooltipContent>
              </Tooltip>
            ) : (
              <>
                <DropdownMenuSubTrigger disabled={disabled} className="gap-2">
                  <GitHubMarkIcon className="size-3.5 shrink-0 text-muted-foreground/80" />
                  {t("automations.trigger.github")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  className={cn(DESKTOP_OVERLAY_LIST_CONTENT, DESKTOP_OVERLAY_LIST_SHELL, "z-[130] w-72")}
                >
                  <AutomationGitHubRepositoryList
                    open={githubSubOpen}
                    disabled={disabled}
                    listGitHubRepositories={listGitHubRepositories}
                    searchGitHubRepositories={searchGitHubRepositories}
                    onSelect={setGitHubTrigger}
                  />
                </DropdownMenuSubContent>
              </>
            )}
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={disabled} className="gap-2">
              <Clock className="size-3.5 shrink-0 text-muted-foreground/80" aria-hidden />
              {t("automations.trigger.time")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={cn(DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH, "z-[130] p-0")}>
              <div className={DESKTOP_OVERLAY_SHORT_LIST_PADDING}>
                <AutomationTimeScheduleOptions
                  schedule={timeSchedule}
                  disabled={disabled}
                  onScheduleChange={setTimeSchedule}
                />
              </div>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </div>
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
  const scrollAreaRef = useRef<ComponentRef<typeof ScrollArea>>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const { query, setQuery, items, loading, loadingMore, hasMore, loadMore, error } = useGitHubAutomationRepositories({
    open,
    listGitHubRepositories,
    searchGitHubRepositories,
  });

  useEffect(() => {
    if (!open || !hasMore || loadingMore) {
      return;
    }
    const root = scrollAreaRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    const sentinel = loadMoreSentinelRef.current;
    if (!root || !sentinel) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        loadMore();
      },
      { root, rootMargin: "160px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, items.length, loadMore, loadingMore, open]);

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
        ref={scrollAreaRef}
        type="always"
        className={DESKTOP_OVERLAY_LIST_SCROLL_AREA}
        onWheel={stopOverlayScrollPropagation}
        onTouchMove={stopOverlayScrollPropagation}
      >
        <div className={DESKTOP_OVERLAY_LIST_LIST_PADDING}>
          {loading ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t("common.loading")}</p>
          ) : error ? (
            <p className="px-2 py-3 text-xs text-destructive">{t("automations.trigger.repositoryLoadFailed")}</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t("automations.trigger.repositoryEmpty")}</p>
          ) : (
            <>
              {items.map((item) => (
                <DropdownMenuSub key={item.fullName}>
                  <DropdownMenuSubTrigger
                    disabled={disabled}
                    className={DESKTOP_OVERLAY_LIST_SUB_TRIGGER}
                  >
                    <span className="min-w-0 truncate">{item.fullName}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="z-[140] p-0">
                    <div className={DESKTOP_OVERLAY_SHORT_LIST_PADDING}>
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
                    </div>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))}
              {hasMore ? (
                <div ref={loadMoreSentinelRef} className="px-2 py-2 text-xs text-muted-foreground">
                  {loadingMore ? t("common.loading") : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </ScrollArea>
    </>
  );
}

export { defaultDesktopTimeTrigger };
