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
