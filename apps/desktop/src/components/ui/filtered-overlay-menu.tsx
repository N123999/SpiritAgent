import { useEffect, useRef, type ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DESKTOP_OVERLAY_LIST_CONTENT,
  DESKTOP_OVERLAY_LIST_FILTER_HEADER,
  DESKTOP_OVERLAY_LIST_FILTER_INPUT,
  DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL,
  DESKTOP_OVERLAY_LIST_LIST_PADDING,
  DESKTOP_OVERLAY_LIST_SCROLL_AREA,
  DESKTOP_OVERLAY_LIST_SHELL,
  DESKTOP_OVERLAY_LIST_WIDTH,
  DESKTOP_OVERLAY_LIST_WORKSPACE_PANEL,
  DESKTOP_OVERLAY_LIST_WORKSPACE_SCROLL_AREA,
  stopOverlayScrollPropagation,
} from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";

type FilteredOverlayMenuProps = {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  filterValue?: string;
  onFilterChange?(value: string): void;
  filterPlaceholder?: string;
  /** `workspace-panel`：flex 列 + 弹性 ScrollArea，供 footer 使用 */
  variant?: "filtered-list" | "workspace-panel";
  contentClassName?: string;
  footer?: ReactNode;
};

export function FilteredOverlayMenuList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(className ?? DESKTOP_OVERLAY_LIST_LIST_PADDING)}>{children}</div>
  );
}

export function FilteredOverlayMenu({
  trigger,
  children,
  open,
  onOpenChange,
  align = "start",
  side = "top",
  filterValue = "",
  onFilterChange,
  filterPlaceholder,
  variant = "filtered-list",
  contentClassName,
  footer,
}: FilteredOverlayMenuProps) {
  const showFilter = onFilterChange != null;
  const filterInputRef = useRef<HTMLInputElement>(null);

  const contentClasses =
    variant === "workspace-panel"
      ? cn(DESKTOP_OVERLAY_LIST_WORKSPACE_PANEL, contentClassName)
      : cn(
          DESKTOP_OVERLAY_LIST_CONTENT,
          DESKTOP_OVERLAY_LIST_SHELL,
          DESKTOP_OVERLAY_LIST_WIDTH,
          contentClassName,
        );

  const scrollAreaClass =
    variant === "workspace-panel"
      ? DESKTOP_OVERLAY_LIST_WORKSPACE_SCROLL_AREA
      : DESKTOP_OVERLAY_LIST_SCROLL_AREA;

  useEffect(() => {
    if (!open || !showFilter) {
      return;
    }
    filterInputRef.current?.focus();
  }, [open, showFilter]);

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DropdownMenuContent
        align={align}
        side={side}
        className={contentClasses}
      >
        {showFilter ? (
          <div className={DESKTOP_OVERLAY_LIST_FILTER_HEADER}>
            <div className={DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL}>
              <Input
                ref={filterInputRef}
                value={filterValue}
                onChange={(event) => onFilterChange(event.target.value)}
                placeholder={filterPlaceholder}
                className={DESKTOP_OVERLAY_LIST_FILTER_INPUT}
                onKeyDown={(event) => event.stopPropagation()}
                autoComplete="off"
              />
            </div>
          </div>
        ) : null}
        <ScrollArea
          type="always"
          className={scrollAreaClass}
          onWheel={stopOverlayScrollPropagation}
          onTouchMove={stopOverlayScrollPropagation}
        >
          <FilteredOverlayMenuList>{children}</FilteredOverlayMenuList>
        </ScrollArea>
        {footer ? (
          <div className="shrink-0 border-t border-border/40 p-1">{footer}</div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { DropdownMenuTrigger as FilteredOverlayMenuTrigger };
