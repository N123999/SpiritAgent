import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, GitBranch } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DESKTOP_OVERLAY_SHORT_LIST_PADDING } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";

type BranchSelectMenuProps = {
  branches: readonly string[];
  selectedBranch?: string;
  currentBranch?: string;
  disabled?: boolean;
  onBranchChange(branch: string): void;
};

export function BranchSelectMenu({
  branches,
  selectedBranch,
  currentBranch,
  disabled = false,
  onBranchChange,
}: BranchSelectMenuProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isRepository = branches.length > 0 || Boolean(currentBranch);
  const activeBranch = selectedBranch ?? currentBranch;
  const label = isRepository ? (activeBranch ?? t('error.noBranch')) : t('app.notGitRepoLabel');
  const triggerDisabled = disabled || !isRepository;
  const suppressTooltip = menuOpen || triggerDisabled;

  return (
    <DropdownMenu onOpenChange={setMenuOpen}>
      <Tooltip
        open={suppressTooltip ? false : undefined}
        delayDuration={300}
        disableHoverableContent
      >
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('composer.selectBranch')}
              disabled={triggerDisabled}
              className={cn(
                "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border-0 bg-transparent px-1 text-left text-xs font-medium outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                "text-muted-foreground",
              )}
            >
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground/80" aria-hidden />
              <span className="min-w-0 truncate">
                {label}
              </span>
              <ChevronDown className="size-3 shrink-0 text-muted-foreground/80" aria-hidden />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {t('composer.selectBranch')}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side="top" className="min-w-[8.5rem] p-0">
        <ScrollArea
          type="always"
          className="[&>[data-radix-scroll-area-viewport]]:max-h-[min(18rem,var(--radix-dropdown-menu-content-available-height))] [&>[data-radix-scroll-area-viewport]]:overscroll-contain"
          onWheel={(event) => {
            event.stopPropagation();
          }}
          onTouchMove={(event) => {
            event.stopPropagation();
          }}
        >
          <div className={cn(DESKTOP_OVERLAY_SHORT_LIST_PADDING, "pr-2")}>
            {branches.map((branch) => (
              <DropdownMenuItem
                key={branch}
                onSelect={() => onBranchChange(branch)}
                className={cn(activeBranch === branch && "bg-accent/40")}
              >
                <span className="min-w-0 truncate" title={branch}>
                  {branch}
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
