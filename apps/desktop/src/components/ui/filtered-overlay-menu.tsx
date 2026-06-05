import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DESKTOP_COMPACT_OVERLAY_CONTENT,
  DESKTOP_COMPACT_OVERLAY_FILTER_HEADER,
  DESKTOP_COMPACT_OVERLAY_FILTER_INPUT,
  DESKTOP_COMPACT_OVERLAY_LIST,
  DESKTOP_COMPACT_OVERLAY_SCROLL_AREA,
  DESKTOP_COMPACT_OVERLAY_WIDTH,
  DESKTOP_COMPACT_OVERLAY_WORKSPACE_SCROLL_AREA,
  DESKTOP_COMPACT_WORKSPACE_PANEL,
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
  /** `workspace`：flex 列 + 弹性 ScrollArea，供 footer 使用 */
  layout?: "list" | "workspace";
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
  return <div className={cn(DESKTOP_COMPACT_OVERLAY_LIST, className)}>{children}</div>;
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
  layout = "list",
  contentClassName,
  footer,
}: FilteredOverlayMenuProps) {
  const showFilter = onFilterChange != null;

  const contentClasses =
    layout === "workspace"
      ? cn(DESKTOP_COMPACT_WORKSPACE_PANEL, contentClassName)
      : cn(
          DESKTOP_COMPACT_OVERLAY_CONTENT,
          DESKTOP_COMPACT_OVERLAY_WIDTH,
          contentClassName,
        );

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DropdownMenuContent align={align} side={side} className={contentClasses}>
        {showFilter ? (
          <div className={DESKTOP_COMPACT_OVERLAY_FILTER_HEADER}>
            <Input
              value={filterValue}
              onChange={(event) => onFilterChange(event.target.value)}
              placeholder={filterPlaceholder}
              className={DESKTOP_COMPACT_OVERLAY_FILTER_INPUT}
              onKeyDown={(event) => event.stopPropagation()}
              autoComplete="off"
            />
          </div>
        ) : null}
        <ScrollArea
          type="always"
          className={
            layout === "workspace"
              ? DESKTOP_COMPACT_OVERLAY_WORKSPACE_SCROLL_AREA
              : DESKTOP_COMPACT_OVERLAY_SCROLL_AREA
          }
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
