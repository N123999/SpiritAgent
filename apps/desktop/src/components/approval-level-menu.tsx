import type { ApprovalLevel } from "@spirit-agent/host-internal";
import { ChevronDown, ShieldCheck } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const APPROVAL_LEVEL_OPTIONS: Array<{ value: ApprovalLevel; label: string }> = [
  { value: "default", label: "默认审批" },
  { value: "full-approval", label: "绕过审批" },
];

function approvalLevelLabel(level: ApprovalLevel): string {
  return APPROVAL_LEVEL_OPTIONS.find((option) => option.value === level)?.label ?? "默认审批";
}

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
  const isFullApproval = approvalLevel === "full-approval";
  const label = approvalLevelLabel(approvalLevel);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="审批级别"
          disabled={disabled}
          className={cn(
            "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border-0 bg-transparent px-1 text-left text-xs font-medium outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50",
            isFullApproval ? "text-yellow-500 hover:text-yellow-500" : "text-muted-foreground",
          )}
        >
          <ShieldCheck
            className={cn("size-3.5 shrink-0", isFullApproval ? "text-yellow-500" : "text-muted-foreground/80")}
            aria-hidden
          />
          <span className="min-w-0 truncate" title={label}>
            {label}
          </span>
          <ChevronDown
            className={cn(
              "size-3 shrink-0",
              isFullApproval ? "text-yellow-500/80" : "text-muted-foreground/80",
            )}
            aria-hidden
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="min-w-[8.5rem] text-xs">
        {APPROVAL_LEVEL_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onApprovalLevelChange(option.value)}
            className={cn(approvalLevel === option.value && "bg-accent/40")}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
