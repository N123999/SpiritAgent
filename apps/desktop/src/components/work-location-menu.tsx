import type { WorkLocationKind } from "@spirit-agent/host-internal";
import type { LucideIcon } from "lucide-react";
import { ChevronDown, GitFork, Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DESKTOP_OVERLAY_SHORT_LIST_PADDING } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";

const WORK_LOCATION_OPTIONS: WorkLocationKind[] = ["local", "worktree"];

export const WORK_LOCATION_ICONS: Record<WorkLocationKind, LucideIcon> = {
  local: Monitor,
  worktree: GitFork,
};

type WorkLocationMenuProps = {
  workLocation: WorkLocationKind;
  disabled?: boolean;
  onWorkLocationChange(workLocation: WorkLocationKind): void;
};

export function WorkLocationMenu({
  workLocation,
  disabled = false,
  onWorkLocationChange,
}: WorkLocationMenuProps) {
  const { t } = useTranslation();
  const workLocationLabel = (kind: WorkLocationKind) =>
    kind === "worktree" ? t("composer.workLocationWorktree") : t("composer.workLocationLocal");
  const label = workLocationLabel(workLocation);
  const TriggerIcon = WORK_LOCATION_ICONS[workLocation];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('composer.workLocation')}
          disabled={disabled}
          className={cn(
            "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border-0 bg-transparent px-1 text-left text-xs font-medium outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
            "text-muted-foreground",
          )}
        >
          <TriggerIcon className="size-3.5 shrink-0 text-muted-foreground/80" aria-hidden />
          <span className="min-w-0 truncate" title={label}>
            {label}
          </span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground/80" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        className="min-w-[9.5rem] p-0"
      >
        <div className={DESKTOP_OVERLAY_SHORT_LIST_PADDING}>
          {WORK_LOCATION_OPTIONS.map((option) => {
            const Icon = WORK_LOCATION_ICONS[option];
            return (
              <DropdownMenuItem
                key={option}
                onSelect={() => onWorkLocationChange(option)}
                className={cn(
                  "flex items-center gap-2",
                  workLocation === option && "bg-accent/40",
                )}
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 truncate">{workLocationLabel(option)}</span>
              </DropdownMenuItem>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
