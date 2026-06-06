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

/**
 * 浮层菜单密度：长列表（模型/工作区 FilteredOverlayMenu）vs 短列表（Dropdown/ActionPopover）。
 * 代码常量用 LIST / SHORT；勿与「项数多少」混为一谈。
 */

/** 短列表：轻外壳，与 ActionPopover 一致 */
export const DESKTOP_OVERLAY_SHORT_SHELL = "rounded-lg shadow-md ring-0";

export const DESKTOP_OVERLAY_SHORT_CONTENT = cn(
  DESKTOP_OVERLAY_SHORT_SHELL,
  "p-1 text-sm",
);

/** Dropdown 基元：短列表壳 + popover 面 */
export const DESKTOP_OVERLAY_SHORT_DROPDOWN_SURFACE = cn(
  DESKTOP_OVERLAY_SHORT_SHELL,
  "border border-border/80 bg-popover p-1 text-sm text-popover-foreground shadow-md",
);

export const DESKTOP_OVERLAY_SHORT_SUBCONTENT = cn(
  DESKTOP_OVERLAY_SHORT_DROPDOWN_SURFACE,
  "min-w-[8.5rem]",
);

export const DESKTOP_OVERLAY_SHORT_ITEM = "px-2 py-1.5 text-sm";

export const DESKTOP_OVERLAY_SHORT_LIST_PADDING = "p-1";

export const DESKTOP_OVERLAY_SHORT_LIST_GAP = "gap-0.5";

/** 仅补最小宽度等业务局部 class */
export const DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH = "min-w-[8.5rem]";

/** 长列表：关掉基类 overflow-y-auto，由内层 ScrollArea 独占滚动 */
export const DESKTOP_OVERLAY_LIST_CONTENT = "max-h-none overflow-hidden p-0 text-xs";

export const DESKTOP_OVERLAY_LIST_SHELL = "min-w-0 rounded-lg shadow-md ring-0";

export const DESKTOP_OVERLAY_LIST_WIDTH =
  "w-max min-w-[max(11rem,var(--radix-dropdown-menu-trigger-width))] max-w-[min(19rem,calc(100vw-1.25rem))]";

export const DESKTOP_OVERLAY_LIST_FILTER_HEADER =
  "shrink-0 border-b border-border/40 p-1.5";

export const DESKTOP_OVERLAY_LIST_FILTER_INPUT = "h-7 w-full min-w-0 text-xs";

/** Root 与 viewport 同步 max-h：仅约束 viewport 时 Root 会随内容撑高，滚动条轨道 h-full 失真 */
export const DESKTOP_OVERLAY_LIST_SCROLL_AREA =
  "max-h-[min(17rem,var(--radix-dropdown-menu-content-available-height))] [&>[data-radix-scroll-area-viewport]]:max-h-[min(17rem,var(--radix-dropdown-menu-content-available-height))] [&>[data-radix-scroll-area-viewport]]:overscroll-contain";

export const DESKTOP_OVERLAY_LIST_WORKSPACE_SCROLL_AREA =
  "min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]]:h-full [&>[data-radix-scroll-area-viewport]]:overscroll-contain";

export const DESKTOP_OVERLAY_LIST_LIST_PADDING = "p-1 pr-1.5";

export const DESKTOP_OVERLAY_LIST_GROUP_LABEL =
  "px-2 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground";

export const DESKTOP_OVERLAY_LIST_ITEM = "px-2 py-2";

/** 长列表底部单行操作（添加工作区等），密度对齐 LIST 而非 Dropdown 默认 SHORT */
export const DESKTOP_OVERLAY_LIST_ACTION_ITEM = "px-2 py-1.5 text-xs";

export const DESKTOP_OVERLAY_LIST_ITEM_PRIMARY =
  "truncate text-xs font-medium text-foreground";

export const DESKTOP_OVERLAY_LIST_ITEM_SECONDARY =
  "truncate text-[11px] text-muted-foreground";

export const DESKTOP_OVERLAY_LIST_SUB_TRIGGER =
  "items-center gap-1.5 px-2.5 py-2 pr-2 text-xs";

/** 工作区选择器全高面板 */
export const DESKTOP_OVERLAY_LIST_WORKSPACE_PANEL =
  "flex h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-[min(24rem,calc(100vw-1.25rem))] flex-col overflow-hidden p-0 text-xs";

/** 阻止滚轮穿透到背后会话/列表 */
export function stopOverlayScrollPropagation(event: {
  stopPropagation(): void;
}): void {
  event.stopPropagation();
}

/** 左侧会话侧栏默认宽度（原 16rem） */
export const SESSION_SIDEBAR_DEFAULT_WIDTH_PX = 256;

/** 可拖拽下限：略窄于默认，勿压太多 */
export const SESSION_SIDEBAR_MIN_WIDTH_PX = 232;

/** 可拖拽上限：相对默认仅略放宽（右侧工具区勿用视口大比例） */
export const SESSION_SIDEBAR_MAX_WIDTH_PX = 288;

const SESSION_SIDEBAR_VIEWPORT_MAX_RATIO = 0.4;

export function computeSessionSidebarMaxWidthPx(): number {
  if (typeof window === "undefined") {
    return SESSION_SIDEBAR_MAX_WIDTH_PX;
  }
  return Math.min(
    SESSION_SIDEBAR_MAX_WIDTH_PX,
    Math.round(window.innerWidth * SESSION_SIDEBAR_VIEWPORT_MAX_RATIO),
  );
}

export function sessionSidebarShellWidth(open: boolean, widthPx: number): string {
  return open ? `calc(0.25rem + ${widthPx}px)` : "0px";
}
