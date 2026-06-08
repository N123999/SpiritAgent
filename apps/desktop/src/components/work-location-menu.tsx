import type { WorkLocationKind } from "@spirit-agent/host-internal";
import { ChevronDown, FolderGit2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const WORK_LOCATION_OPTIONS: WorkLocationKind[] = ["local", "worktree"];

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
          <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground/80" aria-hidden />
          <span className="min-w-0 truncate" title={label}>
            {label}
          </span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground/80" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        className="min-w-[9.5rem]"
      >
        {WORK_LOCATION_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option}
            onSelect={() => onWorkLocationChange(option)}
            className={cn(
              "flex flex-col items-start gap-0.5",
              workLocation === option && "bg-accent/40",
            )}
          >
            <span>{workLocationLabel(option)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
