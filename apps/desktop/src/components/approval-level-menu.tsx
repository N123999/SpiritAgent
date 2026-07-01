import { useState } from "react";
import type { ApprovalLevel } from "@spirit-agent/host-internal";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DESKTOP_OVERLAY_SHORT_LIST_PADDING, DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";

type ApprovalLevelMenuProps = {
  approvalLevel: ApprovalLevel;
  disabled?: boolean;
  onApprovalLevelChange(level: ApprovalLevel): void;
};

export function ApprovalLevelMenu({
  approvalLevel,
  disabled = false,
  onApprovalLevelChange,
}: ApprovalLevelMenuProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const options = [
    { value: "default" as ApprovalLevel, label: t('composer.approvalDefault') },
    { value: "full-approval" as ApprovalLevel, label: t('composer.approvalBypass') },
  ];
  const label = options.find((option) => option.value === approvalLevel)?.label ?? t('composer.approvalDefault');
  const isFullApproval = approvalLevel === "full-approval";
  const suppressTooltip = menuOpen || disabled;

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
              aria-label={t('composer.selectApprovalLevel')}
              disabled={disabled}
              className={cn(
                "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border-0 bg-transparent px-1 text-left text-xs font-medium outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50",
                isFullApproval
                  ? "text-yellow-600 hover:text-yellow-600 dark:text-yellow-500 dark:hover:text-yellow-500"
                  : "text-muted-foreground",
              )}
            >
              <ShieldCheck
                className={cn(
                  "size-3.5 shrink-0",
                  isFullApproval ? "text-yellow-600 dark:text-yellow-500" : "text-muted-foreground/80",
                )}
                aria-hidden
              />
              <span className="min-w-0 truncate">
                {label}
              </span>
              <ChevronDown
                className={cn(
                  "size-3 shrink-0",
                  isFullApproval ? "text-yellow-600/85 dark:text-yellow-500/80" : "text-muted-foreground/80",
                )}
                aria-hidden
              />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {t('composer.selectApprovalLevel')}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        side="top"
        className={cn(DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH, "p-0")}
      >
        <div className={DESKTOP_OVERLAY_SHORT_LIST_PADDING}>
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onApprovalLevelChange(option.value)}
              className={cn(approvalLevel === option.value && "bg-accent/40")}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
