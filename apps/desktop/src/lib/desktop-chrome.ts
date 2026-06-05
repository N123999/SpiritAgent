import { cn } from "@/lib/utils";

/**
 * Instant hover fill — exclude background-color from transitions (session-sidebar precedent).
 * Keeps existing hover:bg-* overlays; only removes bg fade in/out on hover.
 */
export const instantHoverMotionClass =
  "!transition-[opacity,transform,box-shadow] duration-150";

/** ghost 在 aria-expanded 时默认带 bg-muted，顶栏图标按钮需全透明底 */
export const DESKTOP_CHROME_TOGGLE_ICON_BTN = cn(
  "size-7 shrink-0 bg-transparent text-foreground/90 hover:bg-foreground/[0.06] hover:text-foreground dark:hover:bg-foreground/10 aria-expanded:bg-transparent dark:aria-expanded:bg-transparent aria-expanded:text-foreground aria-expanded:hover:bg-foreground/[0.06] dark:aria-expanded:hover:bg-foreground/10 [&_svg]:size-3.5",
  instantHoverMotionClass,
);

export const DESKTOP_CHROME_COMMIT_BTN = cn(
  "h-7 rounded-md px-2 text-xs font-medium text-foreground/90 hover:bg-foreground/[0.06] hover:text-foreground dark:hover:bg-foreground/10",
  instantHoverMotionClass,
);

/** Git 更改区 primary 按钮（ButtonGroup 分段，配合 `size="xs"`）；`border-r-0` 避免透明右边框叠在分割线上显得过粗 */
export const DESKTOP_GIT_ACTION_BTN = cn(
  "border-r-0 shadow-none",
  instantHoverMotionClass,
);

/** Git ButtonGroup 中间竖线（`ButtonGroupSeparator`）；`!bg-*` 覆盖 Separator 默认的 bg-border / bg-input */
export const DESKTOP_GIT_ACTION_SPLIT = cn(
  "!my-0 !mx-0 h-auto w-px min-w-px max-w-px shrink-0 self-stretch !border-0 !bg-border-0 !bg-[var(--git-action-split)] !p-0",
);

/** Git ButtonGroup 右侧下拉触发器 */
export const DESKTOP_GIT_ACTION_MENU_TRIGGER = cn(
  DESKTOP_GIT_ACTION_BTN,
  "w-6 min-w-6 max-w-6 rounded-l-none rounded-r-md px-0",
);

/** Filtered dropdown shell：关掉基类 overflow-y-auto，由内层 ScrollArea 独占滚动 */
export const DESKTOP_COMPACT_OVERLAY_CONTENT =
  "max-h-none overflow-hidden p-0 text-xs";

export const DESKTOP_COMPACT_OVERLAY_WIDTH =
  "w-max min-w-[max(11rem,var(--radix-dropdown-menu-trigger-width))] max-w-[min(20rem,calc(100vw-1.25rem))]";

export const DESKTOP_COMPACT_OVERLAY_SIMPLE_MENU = "min-w-[8rem] text-xs";

export const DESKTOP_COMPACT_OVERLAY_FILTER_HEADER =
  "shrink-0 border-b border-border/40 p-1.5";

export const DESKTOP_COMPACT_OVERLAY_FILTER_INPUT =
  "h-8 w-full min-w-0 text-xs";

/** 模型等列表菜单的 ScrollArea 高度上限 */
export const DESKTOP_COMPACT_OVERLAY_SCROLL_AREA =
  "[&>[data-radix-scroll-area-viewport]]:max-h-[min(18rem,var(--radix-dropdown-menu-content-available-height))] [&>[data-radix-scroll-area-viewport]]:overscroll-contain";

/** 工作区选择器等全高面板的 ScrollArea（父级 flex 列 + 固定高度） */
export const DESKTOP_COMPACT_OVERLAY_WORKSPACE_SCROLL_AREA =
  "min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]]:h-full [&>[data-radix-scroll-area-viewport]]:overscroll-contain";

export const DESKTOP_COMPACT_OVERLAY_LIST = "p-1 pr-2";

export const DESKTOP_COMPACT_OVERLAY_ITEM = "px-2 py-2";

export const DESKTOP_COMPACT_OVERLAY_ITEM_PRIMARY =
  "truncate text-sm font-medium text-foreground";

export const DESKTOP_COMPACT_OVERLAY_ITEM_SECONDARY =
  "truncate text-[11px] text-muted-foreground";

export const DESKTOP_COMPACT_OVERLAY_GROUP_LABEL =
  "px-2 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground";

export const DESKTOP_COMPACT_OVERLAY_SUBCONTENT = "min-w-[10rem] text-xs";

export const DESKTOP_COMPACT_WORKSPACE_PANEL =
  "flex h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-[min(24rem,calc(100vw-1.25rem))] flex-col overflow-hidden p-0 text-xs";

/** 阻止滚轮穿透到背后会话/列表 */
export function stopOverlayScrollPropagation(event: {
  stopPropagation(): void;
}): void {
  event.stopPropagation();
}
