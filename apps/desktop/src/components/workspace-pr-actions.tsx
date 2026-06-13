import { useTranslation } from "react-i18next";
import { ChevronDown, GitMerge, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DESKTOP_GIT_ACTION_BTN,
  DESKTOP_GIT_ACTION_MENU_TRIGGER,
  DESKTOP_GIT_ACTION_SPLIT,
  DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
  DESKTOP_OVERLAY_LIST_ITEM,
  DESKTOP_OVERLAY_LIST_LIST_GAP,
  DESKTOP_OVERLAY_LIST_LIST_PADDING,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";
import type { GitHubPullRequestDetail, GitHubPullRequestMergeMethod } from "@/types";

export function resolvePrActionMode(
  detail: GitHubPullRequestDetail,
): "merge" | "ready" | null {
  if (detail.state !== "open" || detail.merged || !detail.viewerCanMerge) {
    return null;
  }
  if (detail.draft) {
    return "ready";
  }
  return "merge";
}

export type WorkspacePrActionsProps = {
  mode: "merge" | "ready";
  busy?: boolean;
  mergeDisabled?: boolean;
  mergeDisabledTitle?: string;
  onMerge: (method: GitHubPullRequestMergeMethod) => void;
  onMarkReady: () => void;
};

export function WorkspacePrActions({
  mode,
  busy = false,
  mergeDisabled = false,
  mergeDisabledTitle,
  onMerge,
  onMarkReady,
}: WorkspacePrActionsProps) {
  const { t } = useTranslation();

  const busyIcon = busy ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : null;

  if (mode === "ready") {
    return (
      <Button
        type="button"
        variant="default"
        size="xs"
        className={cn(DESKTOP_GIT_ACTION_BTN, instantHoverMotionClass)}
        disabled={busy}
        onClick={onMarkReady}
      >
        {busyIcon}
        <span>{t("workspace.prMarkReadyForReview")}</span>
      </Button>
    );
  }

  return (
    <ButtonGroup>
      <Button
        type="button"
        variant="default"
        size="xs"
        className={cn(DESKTOP_GIT_ACTION_BTN, instantHoverMotionClass)}
        disabled={busy || mergeDisabled}
        title={mergeDisabled ? mergeDisabledTitle : undefined}
        onClick={() => onMerge("merge")}
      >
        {busyIcon}
        <GitMerge className="size-3 shrink-0 opacity-80" aria-hidden />
        <span>{t("app.merge")}</span>
      </Button>
      <ButtonGroupSeparator className={DESKTOP_GIT_ACTION_SPLIT} />
      <DropdownMenu modal>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="default"
            size="xs"
            aria-label={t("workspace.prMergeMoreActions")}
            title={t("workspace.prMergeMoreActions")}
            disabled={busy || mergeDisabled}
            className={cn(DESKTOP_GIT_ACTION_MENU_TRIGGER, instantHoverMotionClass)}
          >
            <ChevronDown className="size-3" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="bottom"
          sideOffset={6}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
          className={cn(
            "flex w-max min-w-[11rem] max-w-[min(15rem,calc(100vw-1.25rem))] flex-col",
            DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
            DESKTOP_OVERLAY_LIST_LIST_PADDING,
            DESKTOP_OVERLAY_LIST_LIST_GAP,
          )}
        >
          <DropdownMenuItem
            className={cn(
              "flex w-full cursor-pointer select-none items-center gap-2 rounded-sm text-left outline-none",
              DESKTOP_OVERLAY_LIST_ITEM,
              "text-popover-foreground",
            )}
            onSelect={() => onMerge("squash")}
          >
            <GitMerge className="size-3 shrink-0 opacity-80" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t("workspace.prMergeSquash")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className={cn(
              "flex w-full cursor-pointer select-none items-center gap-2 rounded-sm text-left outline-none",
              DESKTOP_OVERLAY_LIST_ITEM,
              "text-popover-foreground",
            )}
            onSelect={() => onMerge("rebase")}
          >
            <GitMerge className="size-3 shrink-0 opacity-80" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t("workspace.prMergeRebase")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}
