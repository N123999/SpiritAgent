import type { ReactNode, RefObject } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DESKTOP_OVERLAY_LIST_CONTENT,
  DESKTOP_OVERLAY_LIST_LIST_GAP,
  DESKTOP_OVERLAY_LIST_LIST_PADDING,
  DESKTOP_OVERLAY_LIST_SCROLL_AREA,
  DESKTOP_OVERLAY_LIST_WIDTH,
  stopOverlayScrollPropagation,
} from "@/lib/desktop-chrome";
import { runAfterRadixOverlayClose } from "@/lib/overlay-motion";
import { cn } from "@/lib/utils";

type ComposerSuggestionDropdownProps = {
  open: boolean;
  anchor: DOMRect | null;
  composerRootRef: RefObject<HTMLElement | null>;
  ariaLabel: string;
  onDismiss(): void;
  children: ReactNode;
  contentClassName?: string;
};

function isTargetWithinComposer(
  target: EventTarget | null,
  composerRoot: HTMLElement | null,
): boolean {
  return Boolean(target instanceof Node && composerRoot?.contains(target));
}

export function ComposerSuggestionDropdown({
  open,
  anchor,
  composerRootRef,
  ariaLabel,
  onDismiss,
  children,
  contentClassName,
}: ComposerSuggestionDropdownProps) {
  if (!anchor) {
    return null;
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      runAfterRadixOverlayClose(onDismiss);
    }
  };

  const preventComposerOutsideDismiss = (event: { target: EventTarget | null; preventDefault(): void }) => {
    if (isTargetWithinComposer(event.target, composerRootRef.current)) {
      event.preventDefault();
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          tabIndex={-1}
          style={{
            position: "fixed",
            left: anchor.left,
            top: anchor.top,
            width: Math.max(anchor.width, 1),
            height: Math.max(anchor.height, 1),
            pointerEvents: "none",
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        aria-label={ariaLabel}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerDownOutside={preventComposerOutsideDismiss}
        onInteractOutside={preventComposerOutsideDismiss}
        className={cn(
          DESKTOP_OVERLAY_LIST_CONTENT,
          DESKTOP_OVERLAY_LIST_WIDTH,
          contentClassName,
        )}
      >
        <ScrollArea
          type="always"
          className={DESKTOP_OVERLAY_LIST_SCROLL_AREA}
          onWheel={stopOverlayScrollPropagation}
          onTouchMove={stopOverlayScrollPropagation}
        >
          <div
            className={cn(
              "flex flex-col",
              DESKTOP_OVERLAY_LIST_LIST_PADDING,
              DESKTOP_OVERLAY_LIST_LIST_GAP,
            )}
          >
            {children}
          </div>
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
