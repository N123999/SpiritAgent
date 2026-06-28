import { cn } from "@/lib/utils";

/**
 * Radix origin-aware overlay motion (see shadcn PR #6945 / Radix "Origin-aware animations").
 * `transform-origin` follows trigger placement; zoom + slide enter from that corner, not center.
 */
const SIDE_SLIDE_IN =
  "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=inline-end]:slide-in-from-left-2";

const OPEN_CLOSE =
  "duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

/** Select Content 仍用 data-state，与 Dialog/Dropdown 的 data-open 不同 */
const SELECT_OPEN_CLOSE =
  "duration-100 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95";

export type RadixAnchoredOverlayKind =
  | "popover"
  | "dropdown-menu"
  | "select"
  | "hover-card"
  | "context-menu";

/** Full class strings per kind so Tailwind can statically scan arbitrary `origin-(…)` utilities. */
const MOTION_BY_KIND: Record<RadixAnchoredOverlayKind, string> = {
  popover: cn(
    "origin-(--radix-popover-content-transform-origin)",
    SIDE_SLIDE_IN,
    OPEN_CLOSE,
  ),
  "dropdown-menu": cn(
    "origin-(--radix-dropdown-menu-content-transform-origin)",
    SIDE_SLIDE_IN,
    OPEN_CLOSE,
  ),
  select: cn(
    "origin-(--radix-select-content-transform-origin)",
    SIDE_SLIDE_IN,
    SELECT_OPEN_CLOSE,
  ),
  "hover-card": cn(
    "origin-(--radix-hover-card-content-transform-origin)",
    SIDE_SLIDE_IN,
    OPEN_CLOSE,
  ),
  "context-menu": cn(
    "origin-(--radix-context-menu-content-transform-origin)",
    SIDE_SLIDE_IN,
    OPEN_CLOSE,
  ),
};

export function radixAnchoredOverlayMotion(kind: RadixAnchoredOverlayKind): string {
  return MOTION_BY_KIND[kind];
}

/** 与 Dialog / ContextMenu 等 Radix 浮层 `duration-100` 退场动画一致。 */
export const RADIX_OVERLAY_CLOSE_MS = 100;

/** exit 动画结束后再执行；避免 onOpenChange(false) 同期清 state 导致退场末帧闪 UI。 */
export function runAfterRadixOverlayClose(action: () => void): void {
  window.setTimeout(action, RADIX_OVERLAY_CLOSE_MS);
}
