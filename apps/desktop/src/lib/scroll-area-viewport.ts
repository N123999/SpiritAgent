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
