import { cn } from "@/lib/utils";

/**
 * Instant hover fill — exclude background-color from transitions (session-sidebar precedent).
 * Keeps existing hover:bg-* overlays; only removes bg fade in/out on hover.
 */
export const instantHoverMotionClass =
  "!transition-[opacity,transform,box-shadow] duration-150";

/** 半透明 hover 铺底，背景色不参与 transition（不含字色变化） */
export const DESKTOP_INSTANT_HOVER_OVERLAY = cn(
  "bg-transparent hover:!bg-foreground/[0.06] focus-visible:!bg-foreground/[0.06]",
  "dark:hover:!bg-white/[0.06] dark:focus-visible:!bg-white/[0.06]",
  "aria-expanded:!bg-foreground/[0.06] dark:aria-expanded:!bg-white/[0.06]",
  instantHoverMotionClass,
  "active:!translate-y-0",
);

/** ghost 图标/紧凑按钮：侧栏同源半透明 hover + 字色变亮 */
export const DESKTOP_INSTANT_HOVER_GHOST_BTN = cn(
  DESKTOP_INSTANT_HOVER_OVERLAY,
  "hover:!text-foreground focus-visible:!text-foreground aria-expanded:!text-foreground",
);

/** 侧栏壳层 / 顶栏槽位宽度过渡，与 SessionSidebarShell 一致 */
export const DESKTOP_SHELL_LAYOUT_TRANSITION =
  "transition-[width,margin,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none motion-reduce:duration-0";

/** ghost 在 aria-expanded 时默认带 bg-muted，顶栏图标按钮需全透明底 */
export const DESKTOP_CHROME_TOGGLE_ICON_BTN = cn(
  "electron-no-drag size-7 shrink-0 bg-transparent text-foreground/90 hover:bg-foreground/[0.06] hover:text-foreground dark:hover:bg-foreground/10 aria-expanded:bg-transparent dark:aria-expanded:bg-transparent aria-expanded:text-foreground aria-expanded:hover:bg-foreground/[0.06] dark:aria-expanded:hover:bg-foreground/10 [&_svg]:size-3.5",
  instantHoverMotionClass,
);

/** 文件侧栏工具栏切换图标：字色对齐会话区 Thought（text-muted-foreground） */
export const DESKTOP_FILES_EXPLORER_TOOLBAR_ICON_BTN = cn(
  DESKTOP_CHROME_TOGGLE_ICON_BTN,
  "text-muted-foreground hover:text-muted-foreground focus-visible:text-muted-foreground aria-expanded:text-muted-foreground aria-pressed:text-muted-foreground",
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
 * 浮层菜单密度：统一使用 LIST 密度（text-xs / py-2），与模型 / 工作区选择器对齐。
 * SHORT 系列仅保留给仍需要 text-sm 密度的局部场景。
 */

/** 短列表：轻外壳（仅局部场景使用） */
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

/** Dropdown 基元：长列表壳 + popover 面（密度对齐模型 / 工作区选择器） */
export const DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE = cn(
  DESKTOP_OVERLAY_LIST_SHELL,
  "border border-border/80 bg-popover p-0 text-xs text-popover-foreground shadow-md backdrop-blur-sm",
);

export const DESKTOP_OVERLAY_LIST_WIDTH =
  "w-max min-w-[max(11rem,var(--radix-dropdown-menu-trigger-width))] max-w-[min(19rem,calc(100vw-1.25rem))]";

export const DESKTOP_OVERLAY_LIST_FILTER_HEADER =
  "shrink-0 border-b border-border/40 p-1.5";

/** 与 PendingApprovalCard 指引输入一致：外壳细边框，内层 Input 无 ring */
export const DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL =
  "overflow-hidden rounded-md border border-input bg-transparent focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20";

export const DESKTOP_OVERLAY_LIST_FILTER_INPUT =
  "h-7 min-h-7 w-full min-w-0 rounded-none border-0 bg-transparent px-2.5 py-1 text-xs shadow-none focus-visible:border-transparent focus-visible:ring-0";

/** ghost：透明底与 popover 一致；覆盖 Input 基类 dark:bg-input/30 */
export const DESKTOP_OVERLAY_LIST_FILTER_INPUT_GHOST = cn(
  DESKTOP_OVERLAY_LIST_FILTER_INPUT,
  "rounded-md dark:!bg-transparent",
);

/** 标准表单输入：与 PendingApprovalCard 指引输入一致（h-8） */
export const DESKTOP_FORM_INPUT_SHELL = DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL;

export const DESKTOP_FORM_INPUT_INNER =
  "h-8 w-full min-w-0 rounded-none border-0 bg-transparent px-2.5 py-1 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent";

export const DESKTOP_FORM_TEXTAREA_INNER =
  "min-h-9 w-full min-w-0 flex-1 resize-none rounded-none border-0 bg-transparent px-2.5 py-2 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent";

/** 置于 DESKTOP_FORM_INPUT_SHELL 内的 Select / 自定义触发器 */
export const DESKTOP_FORM_FIELD_TRIGGER_INNER =
  "h-8 min-h-8 w-full rounded-none border-0 bg-transparent px-2.5 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent";

/** Root 与 viewport 同步 max-h：仅约束 viewport 时 Root 会随内容撑高，滚动条轨道 h-full 失真 */
export const DESKTOP_OVERLAY_LIST_SCROLL_AREA =
  "max-h-[min(17rem,var(--radix-dropdown-menu-content-available-height))] [&>[data-radix-scroll-area-viewport]]:max-h-[min(17rem,var(--radix-dropdown-menu-content-available-height))] [&>[data-radix-scroll-area-viewport]]:overscroll-contain";

export const DESKTOP_OVERLAY_LIST_WORKSPACE_SCROLL_AREA =
  "min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]]:h-full [&>[data-radix-scroll-area-viewport]]:overscroll-contain";

export const DESKTOP_OVERLAY_LIST_LIST_PADDING = "p-1 pr-1.5";

export const DESKTOP_OVERLAY_LIST_LIST_GAP = "gap-0.5";

export const DESKTOP_OVERLAY_LIST_GROUP_LABEL =
  "px-2 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground";

/** 详情 Popover 内嵌标签（无额外 padding，配合 DESKTOP_OVERLAY_LIST_DETAIL_* 使用） */
export const DESKTOP_OVERLAY_LIST_DETAIL_LABEL =
  "text-[11px] font-medium tracking-wide text-muted-foreground";

export const DESKTOP_OVERLAY_LIST_ITEM = "px-2 py-1.5";

/** 长列表 DropdownMenuItem 基元；模型 / 工作区 / 审批等浮层列表项共用 */
export const DESKTOP_OVERLAY_LIST_DROPDOWN_ITEM =
  "relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50";

/** 长列表底部单行操作（添加工作区等），密度对齐 LIST 而非 Dropdown 默认 SHORT */
export const DESKTOP_OVERLAY_LIST_ACTION_ITEM =
  "px-2 py-1.5 text-xs text-popover-foreground";

export const DESKTOP_OVERLAY_LIST_ITEM_PRIMARY =
  "truncate text-xs font-medium text-popover-foreground";

export const DESKTOP_OVERLAY_LIST_ITEM_SECONDARY =
  "truncate text-[11px] text-muted-foreground";

export const DESKTOP_OVERLAY_LIST_SUB_TRIGGER =
  "items-center gap-1.5 px-2.5 py-1.5 pr-2 text-xs";

/** 长列表配套详情 Popover：密度与 DESKTOP_OVERLAY_LIST_* 对齐 */
export const DESKTOP_OVERLAY_LIST_DETAIL_SURFACE = cn(
  DESKTOP_OVERLAY_LIST_SHELL,
  "border border-border/80 bg-popover p-0 text-xs text-popover-foreground shadow-md backdrop-blur-sm",
);

export const DESKTOP_OVERLAY_LIST_DETAIL_WIDTH =
  "w-max min-w-72 max-w-[min(19rem,calc(100vw-1.25rem))]";

/** 工作区选择器全高面板 */
export const DESKTOP_OVERLAY_LIST_WORKSPACE_PANEL =
  "flex h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-[min(24rem,calc(100vw-1.25rem))] max-w-[min(19rem,calc(100vw-1.25rem))] flex-col overflow-hidden p-0 text-xs";

/** Composer 输入框半透明底（暗色叠加 input 淡层）；PR 粘性头等浮层同源 */
export const DESKTOP_COMPOSER_SURFACE_BACKDROP =
  "bg-background/55 backdrop-blur-xl dark:bg-input/30 supports-[backdrop-filter]:bg-background/40 dark:supports-[backdrop-filter]:bg-input/25";

/** Composer 胶囊小卡片（Changes 等）：与输入框同源底/边框，hover 仅提亮边框 */
export const DESKTOP_COMPOSER_CHIP_SURFACE = cn(
  "border border-border/50 dark:border-white/10",
  "hover:border-ring/60 dark:hover:border-white/12",
  DESKTOP_COMPOSER_SURFACE_BACKDROP,
);

/** 阻止滚轮穿透到背后会话/列表 */
export function stopOverlayScrollPropagation(event: {
  stopPropagation(): void;
}): void {
  event.stopPropagation();
}

/** 可拖拽下限：默认宽度与之对齐，首次打开更紧凑 */
export const SESSION_SIDEBAR_MIN_WIDTH_PX = 200;

/** 左侧会话侧栏默认宽度 */
export const SESSION_SIDEBAR_DEFAULT_WIDTH_PX = SESSION_SIDEBAR_MIN_WIDTH_PX;

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
