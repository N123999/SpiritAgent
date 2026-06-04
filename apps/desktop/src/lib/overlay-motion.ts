import { cn } from "@/lib/utils";

/**
 * Radix origin-aware overlay motion (see shadcn PR #6945 / Radix "Origin-aware animations").
 * `transform-origin` follows trigger placement; zoom + slide enter from that corner, not center.
 */
const SIDE_SLIDE_IN =
  "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=inline-end]:slide-in-from-left-2";

const OPEN_CLOSE =
  "duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

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
    OPEN_CLOSE,
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
