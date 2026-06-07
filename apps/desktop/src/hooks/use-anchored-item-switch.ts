import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

export const DEFAULT_ANCHORED_ITEM_SWITCH_OPEN_DELAY_MS = 400;
export const DEFAULT_ANCHORED_ITEM_SWITCH_CLOSE_DELAY_MS = 120;
/** Keep the anchor row mounted long enough for Radix's close animation to finish. */
export const DEFAULT_ANCHORED_ITEM_SWITCH_ANCHOR_LINGER_MS = 220;

export type AnchoredItemSwitchTriggerProps = {
  onPointerEnter: () => void;
  isHighlighted: boolean;
  isAnchor: boolean;
};

export type AnchoredItemSwitchContentInteractionProps = {
  onOpenAutoFocus: (event: Event) => void;
  onCloseAutoFocus: (event: Event) => void;
  onFocusOutside: (event: Event) => void;
  onPointerEnter: () => void;
  onPointerDownOutside: (event: { target: EventTarget | null; preventDefault(): void }) => void;
  onInteractOutside: (event: { target: EventTarget | null; preventDefault(): void }) => void;
};

export type UseAnchoredItemSwitchOptions<TItem> = {
  getItemId: (item: TItem) => string;
  openDelayMs?: number;
  closeDelayMs?: number;
  anchorLingerMs?: number;
};

export type UseAnchoredItemSwitchResult<TItem> = {
  open: boolean;
  activeItem: TItem | null;
  anchorItemId: string | null;
  getTriggerProps: (item: TItem) => AnchoredItemSwitchTriggerProps;
  triggerZoneRef: RefObject<HTMLDivElement | null>;
  onTriggerZonePointerLeave: (event: ReactPointerEvent<HTMLDivElement>) => void;
  contentRef: RefObject<HTMLDivElement | null>;
  contentInteractionProps: AnchoredItemSwitchContentInteractionProps;
  /** Sync Radix controlled open=false (e.g. Escape) into the switch state. */
  dismissActiveItem: () => void;
};

export function deriveAnchoredItemSwitchOpen(activeItem: unknown): boolean {
  return activeItem !== null;
}

export function deriveAnchoredItemSwitchAnchorId(
  activeItemId: string | null,
  lingerAnchorId: string | null,
): string | null {
  return activeItemId ?? lingerAnchorId;
}

const ANCHORED_ITEM_SWITCH_RELATED_OVERLAY_SELECTOR = '[data-slot="select-content"]';

export type AnchoredItemSwitchRelatedTargetRefs = {
  triggerZone: HTMLDivElement | null;
  content: HTMLDivElement | null;
};

function isDomNode(target: EventTarget | null): target is Node {
  if (target === null || typeof target !== 'object') {
    return false;
  }
  return 'nodeType' in target && typeof (target as Node).contains === 'function';
}

function domTargetClosest(target: EventTarget, selector: string): Element | null {
  const element =
    'closest' in target && typeof (target as Element).closest === 'function'
      ? (target as Element)
      : 'parentElement' in target
        ? (target as Node).parentElement
        : null;
  return element?.closest(selector) ?? null;
}

/** Returns true when `target` is inside the trigger zone, panel content, or a nested overlay (e.g. Select portal). */
export function isWithinAnchoredItemSwitchRelatedTarget(
  target: EventTarget | null,
  refs: AnchoredItemSwitchRelatedTargetRefs,
): boolean {
  if (!isDomNode(target)) {
    return false;
  }
  if (refs.triggerZone?.contains(target) || refs.content?.contains(target)) {
    return true;
  }
  return domTargetClosest(target, ANCHORED_ITEM_SWITCH_RELATED_OVERLAY_SELECTOR) !== null;
}

/** Pure state transitions for tests and the React hook. */
export class AnchoredItemSwitchStateModel<TItem> {
  activeItem: TItem | null = null;
  pointerItemId: string | null = null;
  lingerAnchorId: string | null = null;

  private readonly getItemId: (item: TItem) => string;

  constructor(getItemId: (item: TItem) => string) {
    this.getItemId = getItemId;
  }

  get open(): boolean {
    return deriveAnchoredItemSwitchOpen(this.activeItem);
  }

  get activeItemId(): string | null {
    return this.activeItem ? this.getItemId(this.activeItem) : null;
  }

  get anchorItemId(): string | null {
    return deriveAnchoredItemSwitchAnchorId(this.activeItemId, this.lingerAnchorId);
  }

  clearPointerHighlight(): void {
    this.pointerItemId = null;
  }

  onItemPointerEnter(item: TItem): "instant-switch" | "schedule-open" {
    this.lingerAnchorId = null;
    this.pointerItemId = this.getItemId(item);

    if (this.activeItem !== null) {
      this.activeItem = item;
      return "instant-switch";
    }

    return "schedule-open";
  }

  openScheduledItem(item: TItem, pointerItem: TItem | null): boolean {
    if (!pointerItem || this.getItemId(pointerItem) !== this.getItemId(item)) {
      return false;
    }
    this.activeItem = item;
    return true;
  }

  beginClose(): string | null {
    const closingId = this.activeItem ? this.getItemId(this.activeItem) : null;
    if (!closingId) {
      this.clearPointerHighlight();
      return null;
    }
    this.clearPointerHighlight();
    this.lingerAnchorId = closingId;
    this.activeItem = null;
    return closingId;
  }

  clearLingerAnchor(): void {
    this.lingerAnchorId = null;
  }
}

export function useAnchoredItemSwitch<TItem>({
  getItemId,
  openDelayMs = DEFAULT_ANCHORED_ITEM_SWITCH_OPEN_DELAY_MS,
  closeDelayMs = DEFAULT_ANCHORED_ITEM_SWITCH_CLOSE_DELAY_MS,
  anchorLingerMs = DEFAULT_ANCHORED_ITEM_SWITCH_ANCHOR_LINGER_MS,
}: UseAnchoredItemSwitchOptions<TItem>): UseAnchoredItemSwitchResult<TItem> {
  const [activeItem, setActiveItem] = useState<TItem | null>(null);
  const [pointerItemId, setPointerItemId] = useState<string | null>(null);
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

  const dismissActiveItem = useCallback(() => {
    const closingId = activeItemRef.current ? getItemId(activeItemRef.current) : null;
    clearHoverOpenTimer();
    clearHoverCloseTimer();
    if (!closingId) {
      pointerItemRef.current = null;
      setPointerItemId(null);
      return;
    }
    commitClose(closingId);
  }, [clearHoverCloseTimer, clearHoverOpenTimer, commitClose, getItemId]);

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

  const isRelatedTarget = useCallback((target: EventTarget | null) => {
    return isWithinAnchoredItemSwitchRelatedTarget(target, {
      triggerZone: triggerZoneRef.current,
      content: contentRef.current,
    });
  }, []);

  const handleTriggerZonePointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const related = event.relatedTarget;
      if (isDomNode(related) && isRelatedTarget(related)) {
        return;
      }
      pointerItemRef.current = null;
      setPointerItemId(null);
    },
    [isRelatedTarget],
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

  const open = deriveAnchoredItemSwitchOpen(activeItem);
  const activeItemId = activeItem ? getItemId(activeItem) : null;
  const anchorItemId = deriveAnchoredItemSwitchAnchorId(activeItemId, lingerAnchorId);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleDocumentPointerMove = (event: PointerEvent) => {
      const target = event.target;
      if (
        isWithinAnchoredItemSwitchRelatedTarget(target, {
          triggerZone: triggerZoneRef.current,
          content: contentRef.current,
        })
      ) {
        clearHoverCloseTimer();
        return;
      }
      if (hoverCloseTimerRef.current === undefined) {
        scheduleHoverClose();
      }
    };
    document.addEventListener("pointermove", handleDocumentPointerMove, true);
    return () =>
      document.removeEventListener("pointermove", handleDocumentPointerMove, true);
  }, [open, clearHoverCloseTimer, scheduleHoverClose]);

  const getTriggerProps = useCallback(
    (item: TItem): AnchoredItemSwitchTriggerProps => {
      const itemId = getItemId(item);
      return {
        onPointerEnter: () => handleItemPointerEnter(item),
        isHighlighted: pointerItemId === itemId || activeItemId === itemId,
        isAnchor: anchorItemId === itemId,
      };
    },
    [activeItemId, anchorItemId, getItemId, handleItemPointerEnter, pointerItemId],
  );

  const contentInteractionProps = useMemo(
    (): AnchoredItemSwitchContentInteractionProps => ({
      onOpenAutoFocus: (event: Event) => event.preventDefault(),
      onCloseAutoFocus: (event: Event) => event.preventDefault(),
      onFocusOutside: (event: Event) => event.preventDefault(),
      onPointerEnter: clearHoverCloseTimer,
      onPointerDownOutside: (event) => {
        if (
          isWithinAnchoredItemSwitchRelatedTarget(event.target, {
            triggerZone: triggerZoneRef.current,
            content: contentRef.current,
          })
        ) {
          event.preventDefault();
          return;
        }
        scheduleHoverClose();
      },
      onInteractOutside: (event) => {
        if (
          isWithinAnchoredItemSwitchRelatedTarget(event.target, {
            triggerZone: triggerZoneRef.current,
            content: contentRef.current,
          })
        ) {
          event.preventDefault();
          return;
        }
        scheduleHoverClose();
      },
    }),
    [clearHoverCloseTimer, scheduleHoverClose],
  );

  return {
    open,
    activeItem,
    anchorItemId,
    getTriggerProps,
    triggerZoneRef,
    onTriggerZonePointerLeave: handleTriggerZonePointerLeave,
    contentRef,
    contentInteractionProps,
    dismissActiveItem,
  };
}
