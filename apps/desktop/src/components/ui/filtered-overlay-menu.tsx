import { forwardRef, useRef, type KeyboardEvent, type ReactNode } from "react";

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
  DESKTOP_OVERLAY_LIST_FILTER_INPUT_GHOST,
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
  /** 默认 `ghost`（透明底与 popover 一致）；`default` 为带边框搜索框 */
  filterVariant?: "default" | "ghost";
  /** `workspace-panel`：flex 列 + 弹性 ScrollArea，供 footer 使用 */
  variant?: "filtered-list" | "workspace-panel";
  contentClassName?: string;
  footer?: ReactNode;
};

function collectFocusableMenuItems(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }
  return Array.from(
    container.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-disabled])'),
  );
}

function focusMenuItem(item: HTMLElement | undefined): void {
  if (!item) {
    return;
  }
  item.focus();
  item.scrollIntoView({ block: "nearest" });
}

export const FilteredOverlayMenuList = forwardRef<
  HTMLDivElement,
  {
    children: ReactNode;
    className?: string;
    onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  }
>(function FilteredOverlayMenuList({ children, className, onKeyDown }, ref) {
  return (
    <div
      ref={ref}
      className={cn(className ?? DESKTOP_OVERLAY_LIST_LIST_PADDING)}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
});

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
  filterVariant = "ghost",
  variant = "filtered-list",
  contentClassName,
  footer,
}: FilteredOverlayMenuProps) {
  const showFilter = onFilterChange != null;
  const filterInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const handleFilterKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      const items = collectFocusableMenuItems(listRef.current);
      focusMenuItem(items[0]);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.stopPropagation();
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const item = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[role="menuitem"]:not([data-disabled])')
      : null;
    if (!item) {
      return;
    }
    const items = collectFocusableMenuItems(listRef.current);
    const index = items.indexOf(item);
    if (index < 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      focusMenuItem(items[index + 1]);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (index <= 0) {
        filterInputRef.current?.focus();
      } else {
        focusMenuItem(items[index - 1]);
      }
    }
  };

  const filterInputKeyDownProps = showFilter
    ? { onKeyDown: handleFilterKeyDown }
    : {};

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

  const focusFilterInput = (event: Event) => {
    if (!showFilter) {
      return;
    }
    event.preventDefault();
    requestAnimationFrame(() => {
      filterInputRef.current?.focus();
    });
  };

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DropdownMenuContent
        align={align}
        side={side}
        className={contentClasses}
        onOpenAutoFocus={focusFilterInput}
        onEntryFocus={focusFilterInput}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
      >
        {showFilter ? (
          <div className={DESKTOP_OVERLAY_LIST_FILTER_HEADER}>
            {filterVariant === "ghost" ? (
              <Input
                ref={filterInputRef}
                value={filterValue}
                onChange={(event) => onFilterChange(event.target.value)}
                placeholder={filterPlaceholder}
                className={DESKTOP_OVERLAY_LIST_FILTER_INPUT_GHOST}
                {...filterInputKeyDownProps}
                autoComplete="off"
              />
            ) : (
              <div className={DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL}>
                <Input
                  ref={filterInputRef}
                  value={filterValue}
                  onChange={(event) => onFilterChange(event.target.value)}
                  placeholder={filterPlaceholder}
                  className={DESKTOP_OVERLAY_LIST_FILTER_INPUT}
                  {...filterInputKeyDownProps}
                  autoComplete="off"
                />
              </div>
            )}
          </div>
        ) : null}
        <ScrollArea
          type="always"
          className={scrollAreaClass}
          onWheel={stopOverlayScrollPropagation}
          onTouchMove={stopOverlayScrollPropagation}
        >
          <FilteredOverlayMenuList ref={listRef} onKeyDown={handleListKeyDown}>
            {children}
          </FilteredOverlayMenuList>
        </ScrollArea>
        {footer ? (
          <div className="shrink-0 border-t border-border/40 p-1">{footer}</div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { DropdownMenuTrigger as FilteredOverlayMenuTrigger };
