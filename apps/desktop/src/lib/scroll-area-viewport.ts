import type { ComponentRef } from "react";

import type { ScrollArea } from "@/components/ui/scroll-area";

export function scrollAreaViewport(
  root: ComponentRef<typeof ScrollArea> | null,
): HTMLElement | null {
  return root?.querySelector("[data-radix-scroll-area-viewport]") ?? null;
}

export function scrollAreaToBottom(viewport: HTMLElement): void {
  viewport.scrollTop = viewport.scrollHeight;
}

export function scrollDistanceFromBottom(viewport: HTMLElement): number {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
}

export function isScrollNearBottom(viewport: HTMLElement, thresholdPx = 48): boolean {
  return scrollDistanceFromBottom(viewport) <= thresholdPx;
}
