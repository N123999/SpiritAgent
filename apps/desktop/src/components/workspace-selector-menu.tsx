import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, FolderPlus, MessageSquareText } from "lucide-react";

import {
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  FilteredOverlayMenu,
  FilteredOverlayMenuTrigger,
} from "@/components/ui/filtered-overlay-menu";
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
import type { DesktopSnapshot } from "@/types";
import { cn } from "@/lib/utils";

export type WorkspaceSelectorMenuProps = {
  currentWorkspaceRoot: string;
  workspaceBinding: DesktopSnapshot["workspaceBinding"];
  availableWorkspaces: DesktopSnapshot["availableWorkspaces"];
  disabled?: boolean;
  onSelectWorkspace(workspaceRoot: string): void;
  onSelectNoWorkspace?(): void;
  onAddWorkspace?(): void;
  showNoWorkspaceOption?: boolean;
  triggerClassName?: string;
};

export function WorkspaceSelectorMenu({
  currentWorkspaceRoot,
  workspaceBinding,
  availableWorkspaces,
  disabled,
  onSelectWorkspace,
  onSelectNoWorkspace,
  onAddWorkspace,
  showNoWorkspaceOption = true,
  triggerClassName,
}: WorkspaceSelectorMenuProps) {
  const { t } = useTranslation();
  const [workspaceFilter, setWorkspaceFilter] = useState("");
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
    <FilteredOverlayMenu
      variant="workspace-panel"
      filterValue={workspaceFilter}
      onFilterChange={setWorkspaceFilter}
      filterPlaceholder={t("app.searchWorkspace")}
      onOpenChange={(open) => {
        if (!open) {
          setWorkspaceFilter("");
        }
      }}
      trigger={
        <FilteredOverlayMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={t("app.selectWorkspace")}
            className={cn(
              "inline-flex h-7 max-w-full min-w-0 items-center gap-1 rounded-md border-0 bg-transparent px-1 text-left text-xs font-medium text-muted-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
              instantHoverMotionClass,
              triggerClassName,
            )}
          >
            <span className="min-w-0 truncate" title={currentWorkspaceRoot}>
              {currentWorkspaceLabel}
            </span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground/80" aria-hidden />
          </button>
        </FilteredOverlayMenuTrigger>
      }
      footer={
        onAddWorkspace || onSelectNoWorkspace ? (
          <>
            {onAddWorkspace ? (
              <DropdownMenuItem onSelect={onAddWorkspace} className={cn("gap-1.5", DESKTOP_OVERLAY_LIST_ACTION_ITEM)}>
                <FolderPlus className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                <span>{t("app.addWorkspace")}</span>
              </DropdownMenuItem>
            ) : null}
            {showNoWorkspaceOption && onSelectNoWorkspace ? (
              <DropdownMenuItem
                onSelect={onSelectNoWorkspace}
                className={cn(
                  "gap-1.5",
                  DESKTOP_OVERLAY_LIST_ACTION_ITEM,
                  workspaceBinding === "none" && "bg-accent/40",
                )}
              >
                <MessageSquareText className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                <span>{t("app.noWorkspace")}</span>
              </DropdownMenuItem>
            ) : null}
          </>
        ) : undefined
      }
    >
      {filteredWorkspaces.length === 0 ? (
        <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t("app.noMatches")}</p>
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
  );
}
