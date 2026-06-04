import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const DEFAULT_OPEN_DELAY_MS = 400;
const DEFAULT_CLOSE_DELAY_MS = 120;
/** Keep the anchor row mounted long enough for Radix's close animation to finish. */
const DEFAULT_ANCHOR_LINGER_MS = 220;

const HOVER_DETAIL_ANCHOR_ATTR = "data-hover-detail-anchor";

export type HoverDetailTooltipTriggerProps = {
  onPointerEnter: () => void;
  isHighlighted: boolean;
  isAnchor: boolean;
};

type HoverDetailTooltipContextValue<TItem> = {
  getTriggerProps: (item: TItem) => HoverDetailTooltipTriggerProps;
  anchorItemId: string | null;
  triggerZoneRef: React.RefObject<HTMLDivElement | null>;
  onTriggerZonePointerLeave: (event: ReactPointerEvent<HTMLDivElement>) => void;
  contentRef: React.RefObject<HTMLDivElement | null>;
  contentInteractionProps: {
    onOpenAutoFocus: (event: Event) => void;
    onCloseAutoFocus: (event: Event) => void;
    onFocusOutside: (event: Event) => void;
    onPointerEnter: () => void;
    onPointerLeave: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerDownOutside: (event: { target: EventTarget | null; preventDefault(): void }) => void;
    onInteractOutside: (event: { target: EventTarget | null; preventDefault(): void }) => void;
  };
  activeItem: TItem | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HoverDetailTooltipContext = createContext<HoverDetailTooltipContextValue<any> | null>(
  null,
);

export function useHoverDetailTooltipContext<TItem>(): HoverDetailTooltipContextValue<TItem> {
  const value = useContext(HoverDetailTooltipContext);
  if (!value) {
    throw new Error("HoverDetailTooltip subcomponents must be used within HoverDetailTooltip");
  }
  return value as HoverDetailTooltipContextValue<TItem>;
}

export type UseHoverDetailTooltipStateOptions<TItem> = {
  getItemId: (item: TItem) => string;
  openDelayMs?: number;
  closeDelayMs?: number;
  anchorLingerMs?: number;
};

export function useHoverDetailTooltipState<TItem>({
  getItemId,
  openDelayMs = DEFAULT_OPEN_DELAY_MS,
  closeDelayMs = DEFAULT_CLOSE_DELAY_MS,
  anchorLingerMs = DEFAULT_ANCHOR_LINGER_MS,
}: UseHoverDetailTooltipStateOptions<TItem>) {
  const [activeItem, setActiveItem] = useState<TItem | null>(null);
  const [pointerItemId, setPointerItemId] = useState<string | null>(null);
  // Keeps the anchor row mounted through Radix's close animation so the
  // PopoverContent never loses its anchor and snaps to (0,0).
  const [lingerAnchorId, setLingerAnchorId] = useState<string | null>(null);
  const hoverOpenTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lingerClearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeItemRef = useRef<TItem | null>(null);
  const pointerItemRef = useRef<TItem | null>(null);
  const triggerZoneRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  activeItemRef.current = activeItem;

  const clearHoverOpenTimer = useCallback(() => {
    if (hoverOpenTimerRef.current !== undefined) {
      clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = undefined;
    }
  }, []);

  const clearHoverCloseTimer = useCallback(() => {
    if (hoverCloseTimerRef.current !== undefined) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = undefined;
    }
  }, []);

  const commitClose = useCallback(
    (closingId: string) => {
      clearHoverOpenTimer();
      pointerItemRef.current = null;
      setPointerItemId(null);
      setLingerAnchorId(closingId);
      setActiveItem(null);
      if (lingerClearTimerRef.current !== undefined) {
        clearTimeout(lingerClearTimerRef.current);
      }
      lingerClearTimerRef.current = setTimeout(() => {
        lingerClearTimerRef.current = undefined;
        setLingerAnchorId(null);
      }, anchorLingerMs);
    },
    [anchorLingerMs, clearHoverOpenTimer],
  );

  const scheduleHoverClose = useCallback(() => {
    clearHoverOpenTimer();
    clearHoverCloseTimer();
    const closingId = activeItemRef.current ? getItemId(activeItemRef.current) : null;
    if (!closingId) {
      pointerItemRef.current = null;
      setPointerItemId(null);
      return;
    }
    hoverCloseTimerRef.current = setTimeout(() => {
      hoverCloseTimerRef.current = undefined;
      commitClose(closingId);
    }, closeDelayMs);
  }, [clearHoverCloseTimer, clearHoverOpenTimer, closeDelayMs, commitClose, getItemId]);

  const handleItemPointerEnter = useCallback(
    (item: TItem) => {
      clearHoverCloseTimer();
      if (lingerClearTimerRef.current !== undefined) {
        clearTimeout(lingerClearTimerRef.current);
        lingerClearTimerRef.current = undefined;
      }
      setLingerAnchorId(null);
      pointerItemRef.current = item;
      setPointerItemId(getItemId(item));

      if (activeItemRef.current !== null) {
        clearHoverOpenTimer();
        setActiveItem(item);
        return;
      }

      clearHoverOpenTimer();
      hoverOpenTimerRef.current = setTimeout(() => {
        hoverOpenTimerRef.current = undefined;
        if (
          !pointerItemRef.current ||
          getItemId(pointerItemRef.current) !== getItemId(item)
        ) {
          return;
        }
        setActiveItem(item);
      }, openDelayMs);
    },
    [clearHoverCloseTimer, clearHoverOpenTimer, getItemId, openDelayMs],
  );

  // Pointer left the whole trigger zone. Close unless we are heading into the panel.
  const handleTriggerZonePointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const related = event.relatedTarget;
      if (related instanceof Node && contentRef.current?.contains(related)) {
        return;
      }
      pointerItemRef.current = null;
      setPointerItemId(null);
      scheduleHoverClose();
    },
    [scheduleHoverClose],
  );

  // Pointer left the panel. Close unless we are heading back into the trigger zone.
  const handleContentPointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const related = event.relatedTarget;
      if (related instanceof Node && triggerZoneRef.current?.contains(related)) {
        return;
      }
      scheduleHoverClose();
    },
    [scheduleHoverClose],
  );

  useEffect(() => {
    return () => {
      if (hoverOpenTimerRef.current !== undefined) {
        clearTimeout(hoverOpenTimerRef.current);
      }
      if (hoverCloseTimerRef.current !== undefined) {
        clearTimeout(hoverCloseTimerRef.current);
      }
      if (lingerClearTimerRef.current !== undefined) {
        clearTimeout(lingerClearTimerRef.current);
      }
    };
  }, []);

  const popoverOpen = activeItem !== null;
  const activeItemId = activeItem ? getItemId(activeItem) : null;
  const anchorItemId = activeItemId ?? lingerAnchorId;

  const getTriggerProps = useCallback(
    (item: TItem): HoverDetailTooltipTriggerProps => {
      const itemId = getItemId(item);
      return {
        onPointerEnter: () => handleItemPointerEnter(item),
        isHighlighted: pointerItemId === itemId || activeItemId === itemId,
        isAnchor: anchorItemId === itemId,
      };
    },
    [
      activeItemId,
      anchorItemId,
      getItemId,
      handleItemPointerEnter,
      pointerItemId,
    ],
  );

  const contentInteractionProps = useMemo(
    () => ({
      onOpenAutoFocus: (event: Event) => event.preventDefault(),
      onCloseAutoFocus: (event: Event) => event.preventDefault(),
      onFocusOutside: (event: Event) => event.preventDefault(),
      onPointerEnter: clearHoverCloseTimer,
      onPointerLeave: handleContentPointerLeave,
      onPointerDownOutside: (event: {
        target: EventTarget | null;
        preventDefault(): void;
      }) => {
        const target = event.target;
        if (target instanceof Node && triggerZoneRef.current?.contains(target)) {
          event.preventDefault();
          return;
        }
        scheduleHoverClose();
      },
      onInteractOutside: (event: {
        target: EventTarget | null;
        preventDefault(): void;
      }) => {
        const target = event.target;
        if (target instanceof Node && triggerZoneRef.current?.contains(target)) {
          event.preventDefault();
          return;
        }
        scheduleHoverClose();
      },
    }),
    [clearHoverCloseTimer, handleContentPointerLeave, scheduleHoverClose],
  );

  return {
    popoverOpen,
    activeItem,
    anchorItemId,
    getTriggerProps,
    triggerZoneRef,
    onTriggerZonePointerLeave: handleTriggerZonePointerLeave,
    contentRef,
    contentInteractionProps,
  };
}

export type HoverDetailTooltipProps<TItem> = UseHoverDetailTooltipStateOptions<TItem> & {
  children: ReactNode;
};

function HoverDetailTooltipRoot<TItem>({
  getItemId,
  openDelayMs,
  closeDelayMs,
  anchorLingerMs,
  children,
}: HoverDetailTooltipProps<TItem>) {
  const state = useHoverDetailTooltipState({
    getItemId,
    openDelayMs,
    closeDelayMs,
    anchorLingerMs,
  });

  const contextValue = useMemo(
    (): HoverDetailTooltipContextValue<TItem> => ({
      getTriggerProps: state.getTriggerProps,
      anchorItemId: state.anchorItemId,
      triggerZoneRef: state.triggerZoneRef,
      onTriggerZonePointerLeave: state.onTriggerZonePointerLeave,
      contentRef: state.contentRef,
      contentInteractionProps: state.contentInteractionProps,
      activeItem: state.activeItem,
    }),
    [
      state.activeItem,
      state.anchorItemId,
      state.contentInteractionProps,
      state.contentRef,
      state.getTriggerProps,
      state.onTriggerZonePointerLeave,
      state.triggerZoneRef,
    ],
  );

  return (
    <HoverDetailTooltipContext.Provider value={contextValue}>
      <Popover open={state.popoverOpen} modal={false}>
        {children}
      </Popover>
    </HoverDetailTooltipContext.Provider>
  );
}

type HoverDetailTooltipTriggerZoneProps = ComponentProps<"div">;

function HoverDetailTooltipTriggerZone({
  ref,
  className,
  onPointerLeave,
  ...props
}: HoverDetailTooltipTriggerZoneProps) {
  const { triggerZoneRef, onTriggerZonePointerLeave } = useHoverDetailTooltipContext();

  return (
    <div
      ref={(node) => {
        triggerZoneRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      }}
      className={className}
      onPointerLeave={(event) => {
        onTriggerZonePointerLeave(event);
        onPointerLeave?.(event);
      }}
      {...props}
    />
  );
}

type HoverDetailTooltipAnchorProps = {
  itemId: string;
  children: ReactElement;
};

function HoverDetailTooltipAnchor({ itemId, children }: HoverDetailTooltipAnchorProps) {
  const { anchorItemId } = useHoverDetailTooltipContext();
  const rowMarker = (
    <div className="block w-full" {...{ [HOVER_DETAIL_ANCHOR_ATTR]: itemId }}>
      {children}
    </div>
  );
  // 仅当前行挂 PopoverAnchor：行间切换时 Radix 会换参考节点并重新定位（与 Git 历史一致）。
  if (anchorItemId === itemId) {
    return <PopoverAnchor asChild>{rowMarker}</PopoverAnchor>;
  }
  return rowMarker;
}

type HoverDetailTooltipContentProps = Omit<
  ComponentProps<typeof PopoverContent>,
  "children" | "ref"
> & {
  children: (activeItem: unknown) => ReactNode;
};

function HoverDetailTooltipContent({
  className,
  children,
  ...props
}: HoverDetailTooltipContentProps) {
  const { activeItem, contentRef, contentInteractionProps } = useHoverDetailTooltipContext();

  return (
    <PopoverContent
      ref={contentRef}
      className={cn(className)}
      onOpenAutoFocus={contentInteractionProps.onOpenAutoFocus}
      onCloseAutoFocus={contentInteractionProps.onCloseAutoFocus}
      onFocusOutside={contentInteractionProps.onFocusOutside}
      onPointerEnter={contentInteractionProps.onPointerEnter}
      onPointerLeave={contentInteractionProps.onPointerLeave}
      onPointerDownOutside={contentInteractionProps.onPointerDownOutside}
      onInteractOutside={contentInteractionProps.onInteractOutside}
      {...props}
    >
      {children(activeItem)}
    </PopoverContent>
  );
}

export const HoverDetailTooltip = Object.assign(HoverDetailTooltipRoot, {
  TriggerZone: HoverDetailTooltipTriggerZone,
  Anchor: HoverDetailTooltipAnchor,
  Content: HoverDetailTooltipContent,
});
