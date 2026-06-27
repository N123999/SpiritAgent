import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

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
import {
  RADIX_OVERLAY_CLOSE_MS,
  runAfterRadixOverlayClose,
} from "@/lib/overlay-motion";
import { cn } from "@/lib/utils";

type ComposerSuggestionDropdownProps = {
  active: boolean;
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
  active,
  anchor,
  composerRootRef,
  ariaLabel,
  onDismiss,
  children,
  contentClassName,
}: ComposerSuggestionDropdownProps) {
  const [mounted, setMounted] = useState(false);
  const [radixOpen, setRadixOpen] = useState(false);
  const stickyAnchorRef = useRef<DOMRect | null>(null);
  const frozenChildrenRef = useRef<ReactNode>(null);

  if (active && anchor) {
    stickyAnchorRef.current = anchor;
  }
  if (active && children) {
    frozenChildrenRef.current = children;
  }

  useLayoutEffect(() => {
    if (active) {
      setMounted(true);
      setRadixOpen(true);
      return;
    }
    if (!mounted) {
      return;
    }
    setRadixOpen(false);
  }, [active, mounted]);

  useEffect(() => {
    if (active || !mounted) {
      return;
    }
    const timeout = window.setTimeout(() => setMounted(false), RADIX_OVERLAY_CLOSE_MS);
    return () => window.clearTimeout(timeout);
  }, [active, mounted]);

  const displayAnchor = anchor ?? stickyAnchorRef.current;
  const displayChildren = mounted ? frozenChildrenRef.current : null;

  if (!mounted || !displayAnchor) {
    return null;
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setRadixOpen(false);
      runAfterRadixOverlayClose(onDismiss);
    }
  };

  const preventComposerOutsideDismiss = (event: { target: EventTarget | null; preventDefault(): void }) => {
    if (isTargetWithinComposer(event.target, composerRootRef.current)) {
      event.preventDefault();
    }
  };

  return (
    <DropdownMenu open={radixOpen} onOpenChange={handleOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          tabIndex={-1}
          style={{
            position: "fixed",
            left: displayAnchor.left,
            top: displayAnchor.top,
            width: Math.max(displayAnchor.width, 1),
            height: Math.max(displayAnchor.height, 1),
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
            {displayChildren}
          </div>
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
