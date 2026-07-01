import { useMemo, useState, type ClipboardEvent as ReactClipboardEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import { ChevronDown, FolderPlus, MessageSquareText } from "lucide-react";

import {
  FilteredOverlayMenu,
  FilteredOverlayMenuTrigger,
} from "@/components/ui/filtered-overlay-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DESKTOP_OVERLAY_LIST_ACTION_ITEM,
  DESKTOP_OVERLAY_LIST_ITEM,
  DESKTOP_OVERLAY_LIST_ITEM_PRIMARY,
  DESKTOP_OVERLAY_LIST_ITEM_SECONDARY,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import {
  resolveWorkspaceSelectorLabel,
  sameWorkspacePath,
} from "@/lib/workspace-display-label";
import { cn } from "@/lib/utils";
import type { DesktopSnapshot } from "@/types";

export type EmptyStateWorkspaceSelectorProps = {
  currentWorkspaceRoot: string;
  workspaceBinding: DesktopSnapshot["workspaceBinding"];
  availableWorkspaces: DesktopSnapshot["availableWorkspaces"];
  disabled?: boolean;
  onSelectWorkspace(workspaceRoot: string): void;
  onSelectNoWorkspace(): void;
  onAddWorkspace(): void;
};

export function EmptyStateWorkspaceSelector({
  currentWorkspaceRoot,
  workspaceBinding,
  availableWorkspaces,
  disabled,
  onSelectWorkspace,
  onSelectNoWorkspace,
  onAddWorkspace,
}: EmptyStateWorkspaceSelectorProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const suppressTooltip = menuOpen || disabled;
  const filteredWorkspaces = useMemo(() => {
    const query = workspaceFilter.trim().toLowerCase();
    if (!query) {
      return availableWorkspaces;
    }
    return availableWorkspaces.filter((workspace) =>
      workspace.label.toLowerCase().includes(query) || workspace.path.toLowerCase().includes(query),
    );
  }, [availableWorkspaces, workspaceFilter]);
  const currentWorkspaceLabel = useMemo(
    () =>
      resolveWorkspaceSelectorLabel(
        currentWorkspaceRoot,
        workspaceBinding,
        availableWorkspaces,
        t,
      ),
    [availableWorkspaces, currentWorkspaceRoot, t, workspaceBinding],
  );

  return (
    <div className="flex justify-start px-0.5">
      <FilteredOverlayMenu
        variant="workspace-panel"
        filterValue={workspaceFilter}
        onFilterChange={setWorkspaceFilter}
        filterPlaceholder={t('app.searchWorkspace')}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open) {
            setWorkspaceFilter("");
          }
        }}
        trigger={
          <Tooltip
            open={suppressTooltip ? false : undefined}
            delayDuration={300}
            disableHoverableContent
          >
            <TooltipTrigger asChild>
              <FilteredOverlayMenuTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={t('app.selectWorkspace')}
                  className={cn(
                    "inline-flex h-8 max-w-[min(24rem,100%)] min-w-0 items-center gap-1 rounded-md border-0 bg-transparent pr-0.5 pl-1 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                    instantHoverMotionClass,
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {currentWorkspaceLabel}
                  </span>
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground/80" aria-hidden />
                </button>
              </FilteredOverlayMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {t('app.selectWorkspace')}
            </TooltipContent>
          </Tooltip>
        }
        footer={
          <>
            <DropdownMenuItem onSelect={onAddWorkspace} className={cn("gap-1.5", DESKTOP_OVERLAY_LIST_ACTION_ITEM)}>
              <FolderPlus className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span>{t('app.addWorkspace')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onSelectNoWorkspace}
              className={cn(
                "gap-1.5",
                DESKTOP_OVERLAY_LIST_ACTION_ITEM,
                workspaceBinding === "none" && "bg-accent/40",
              )}
            >
              <MessageSquareText className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span>{t('app.noWorkspace')}</span>
            </DropdownMenuItem>
          </>
        }
      >
        {filteredWorkspaces.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t('app.noMatches')}</p>
        ) : (
          filteredWorkspaces.map((workspace) => {
            const selected =
              workspaceBinding === "project"
              && sameWorkspacePath(workspace.path, currentWorkspaceRoot);
            return (
              <DropdownMenuItem
                key={workspace.path}
                onSelect={() => onSelectWorkspace(workspace.path)}
                className={cn("items-start", DESKTOP_OVERLAY_LIST_ITEM, selected && "bg-accent/40")}
              >
                <div className="min-w-0 flex-1">
                  <div className={DESKTOP_OVERLAY_LIST_ITEM_PRIMARY} title={workspace.label}>
                    {workspace.label}
                  </div>
                  <div className={DESKTOP_OVERLAY_LIST_ITEM_SECONDARY} title={workspace.path}>
                    {workspace.path}
                  </div>
                </div>
              </DropdownMenuItem>
            );
          })
        )}
      </FilteredOverlayMenu>
    </div>
  );
}
