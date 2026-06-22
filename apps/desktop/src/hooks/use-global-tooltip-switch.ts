import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import {
  DEFAULT_ANCHORED_ITEM_SWITCH_ANCHOR_LINGER_MS,
  DEFAULT_ANCHORED_ITEM_SWITCH_CLOSE_DELAY_MS,
  DEFAULT_ANCHORED_ITEM_SWITCH_OPEN_DELAY_MS,
  type AnchoredItemSwitchTriggerProps,
} from "@/hooks/use-anchored-item-switch";
import {
  GlobalTooltipSwitchStateModel,
  TOOLTIP_SWITCH_CONTENT_LINGER_MS,
  isActiveTooltipAnchorSlot,
  isPointerOverTooltipCompanionOverlays,
  isWithinGlobalTooltipRelatedTarget,
  tooltipSwitchSlotKey,
  tooltipSwitchSlotsEqual,
  type TooltipSwitchSlotKey,
} from "@/hooks/tooltip-switch-registry";

function isDomNode(target: EventTarget | null): target is Node {
  if (target === null || typeof target !== "object") {
    return false;
  }
  return "nodeType" in target && typeof (target as Node).contains === "function";
}

export type TooltipSwitchOpenKind = "closed" | "delayed" | "instant";

export type UseGlobalTooltipSwitchOptions = {
  defaultOpenDelayMs?: number;
  defaultCloseDelayMs?: number;
  defaultAnchorLingerMs?: number;
};

export type TooltipLingerAnchorScreenRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type UseGlobalTooltipSwitchResult = {
  open: boolean;
  openKind: TooltipSwitchOpenKind;
  anchorSlot: TooltipSwitchSlotKey | null;
  contentActiveItem: unknown | null;
  activeRegistrationId: string | null;
  contentRef: RefObject<HTMLDivElement | null>;
  registerTriggerZone: (registrationId: string, zone: HTMLDivElement | null) => void;
  unregisterTriggerZone: (registrationId: string) => void;
  registerTriggerElement: (registrationId: string, element: HTMLElement | null) => void;
  registerActiveAnchorElement: (element: HTMLElement | null) => void;
  setRegistrationTiming: (
    registrationId: string,
    timing: { closeDelayMs?: number; anchorLingerMs?: number },
  ) => void;
  getTriggerProps: <TItem>(
    registrationId: string,
    item: TItem,
    getItemId: (item: TItem) => string,
    openDelayMs: number,
  ) => AnchoredItemSwitchTriggerProps;
  onTriggerZonePointerLeave: (
    registrationId: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  dismissActiveItem: () => void;
  dismissIfOpen: () => void;
  onTriggerPointerDown: (registrationId: string, itemId: string) => void;
  isAnchorSlot: (registrationId: string, itemId: string) => boolean;
  onContentPointerEnter: () => void;
  lingerAnchorScreenRect: TooltipLingerAnchorScreenRect | null;
};

export function useGlobalTooltipSwitch({
  defaultOpenDelayMs = DEFAULT_ANCHORED_ITEM_SWITCH_OPEN_DELAY_MS,
  defaultCloseDelayMs = DEFAULT_ANCHORED_ITEM_SWITCH_CLOSE_DELAY_MS,
  defaultAnchorLingerMs = DEFAULT_ANCHORED_ITEM_SWITCH_ANCHOR_LINGER_MS,
}: UseGlobalTooltipSwitchOptions = {}): UseGlobalTooltipSwitchResult {
  const [activeSlot, setActiveSlot] = useState<GlobalTooltipSwitchStateModel["activeSlot"]>(null);
  const [activeItem, setActiveItem] = useState<unknown | null>(null);
  const [pointerSlot, setPointerSlot] = useState<GlobalTooltipSwitchStateModel["pointerSlot"]>(null);
  const [lingerAnchorSlot, setLingerAnchorSlot] =
    useState<GlobalTooltipSwitchStateModel["lingerAnchorSlot"]>(null);
  const [lingerActiveItem, setLingerActiveItem] =
    useState<GlobalTooltipSwitchStateModel["lingerActiveItem"]>(null);
  const [openKind, setOpenKind] = useState<TooltipSwitchOpenKind>("closed");

  const hoverOpenTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lingerClearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lingerContentClearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeItemRef = useRef<unknown | null>(null);
  const activeSlotRef = useRef<GlobalTooltipSwitchStateModel["activeSlot"]>(null);
  const pointerSlotRef = useRef<GlobalTooltipSwitchStateModel["pointerSlot"]>(null);
  const triggerZonesRef = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const triggerElementsRef = useRef<Map<string, HTMLElement | null>>(new Map());
  const lastEnterTargetByRegistrationRef = useRef<Map<string, HTMLElement>>(new Map());
  const activeAnchorElementRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const openDelayByRegistrationRef = useRef<Map<string, number>>(new Map());
  const closeDelayByRegistrationRef = useRef<Map<string, number>>(new Map());
  const anchorLingerByRegistrationRef = useRef<Map<string, number>>(new Map());
  const [lingerAnchorScreenRect, setLingerAnchorScreenRect] =
    useState<TooltipLingerAnchorScreenRect | null>(null);

  activeItemRef.current = activeItem;
  activeSlotRef.current = activeSlot;
  pointerSlotRef.current = pointerSlot;

  const setRegistrationTiming = useCallback(
    (
      registrationId: string,
      timing: { closeDelayMs?: number; anchorLingerMs?: number },
    ) => {
      if (timing.closeDelayMs !== undefined) {
        closeDelayByRegistrationRef.current.set(registrationId, timing.closeDelayMs);
      }
      if (timing.anchorLingerMs !== undefined) {
        anchorLingerByRegistrationRef.current.set(registrationId, timing.anchorLingerMs);
      }
    },
    [],
  );

  const model = useMemo(() => {
    const next = new GlobalTooltipSwitchStateModel();
    next.activeSlot = activeSlot;
    next.activeItem = activeItem;
    next.pointerSlot = pointerSlot;
    next.lingerAnchorSlot = lingerAnchorSlot;
    next.lingerActiveItem = lingerActiveItem;
    return next;
  }, [activeItem, activeSlot, lingerActiveItem, lingerAnchorSlot, pointerSlot]);

  const open = model.open;
  const anchorSlot = model.anchorSlot;
  const contentActiveItem = model.contentActiveItem;
  const activeRegistrationId = activeSlot?.registrationId ?? null;

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

  const getCloseDelayMs = useCallback(
    (registrationId: string | null) => {
      if (!registrationId) {
        return defaultCloseDelayMs;
      }
      return closeDelayByRegistrationRef.current.get(registrationId) ?? defaultCloseDelayMs;
    },
    [defaultCloseDelayMs],
  );

  const getAnchorLingerMs = useCallback(
    (registrationId: string | null) => {
      if (!registrationId) {
        return defaultAnchorLingerMs;
      }
      return anchorLingerByRegistrationRef.current.get(registrationId) ?? defaultAnchorLingerMs;
    },
    [defaultAnchorLingerMs],
  );

  const commitClose = useCallback(
    (closingRegistrationId: string | null) => {
      const closingItem = activeItemRef.current;
      const closingSlot = activeSlotRef.current;
      const anchorEl = activeAnchorElementRef.current;
      const anchorRectSnapshot = anchorEl?.isConnected
        ? anchorEl.getBoundingClientRect()
        : null;
      if (anchorRectSnapshot) {
        setLingerAnchorScreenRect({
          top: anchorRectSnapshot.top,
          left: anchorRectSnapshot.left,
          width: anchorRectSnapshot.width,
          height: anchorRectSnapshot.height,
        });
      }
      clearHoverOpenTimer();
      pointerSlotRef.current = null;
      setPointerSlot(null);
      setLingerAnchorSlot(closingSlot);
      setLingerActiveItem(closingItem);
      setActiveSlot(null);
      setActiveItem(null);
      setOpenKind("closed");
      // 锚点保留到 linger 结束，避免 Popper 在退出动画期间漂到 (0,0)
      const anchorLingerMs = getAnchorLingerMs(closingRegistrationId);
      if (lingerClearTimerRef.current !== undefined) {
        clearTimeout(lingerClearTimerRef.current);
      }
      lingerClearTimerRef.current = setTimeout(() => {
        lingerClearTimerRef.current = undefined;
        setLingerAnchorSlot(null);
        setLingerAnchorScreenRect(null);
        activeAnchorElementRef.current = null;
      }, anchorLingerMs);

      if (lingerContentClearTimerRef.current !== undefined) {
        clearTimeout(lingerContentClearTimerRef.current);
      }
      lingerContentClearTimerRef.current = setTimeout(() => {
        lingerContentClearTimerRef.current = undefined;
        setLingerActiveItem(null);
      }, TOOLTIP_SWITCH_CONTENT_LINGER_MS);
    },
    [clearHoverOpenTimer, getAnchorLingerMs],
  );

  const onContentPointerEnter = clearHoverCloseTimer;

  const scheduleHoverClose = useCallback(() => {
    clearHoverOpenTimer();
    clearHoverCloseTimer();
    const closingRegistrationId = activeSlot?.registrationId ?? null;
    if (!activeItemRef.current || !closingRegistrationId) {
      pointerSlotRef.current = null;
      setPointerSlot(null);
      return;
    }
    const closeDelayMs = getCloseDelayMs(closingRegistrationId);
    hoverCloseTimerRef.current = setTimeout(() => {
      hoverCloseTimerRef.current = undefined;
      commitClose(closingRegistrationId);
    }, closeDelayMs);
  }, [activeSlot, clearHoverCloseTimer, clearHoverOpenTimer, commitClose, getCloseDelayMs]);

  const dismissActiveItem = useCallback(() => {
    const closingRegistrationId = activeSlot?.registrationId ?? null;
    clearHoverOpenTimer();
    clearHoverCloseTimer();
    if (!activeItemRef.current || !closingRegistrationId) {
      pointerSlotRef.current = null;
      setPointerSlot(null);
      return;
    }
    commitClose(closingRegistrationId);
  }, [activeSlot, clearHoverCloseTimer, clearHoverOpenTimer, commitClose]);

  const dismissIfOpen = useCallback(() => {
    if (activeItemRef.current !== null) {
      dismissActiveItem();
    }
  }, [dismissActiveItem]);

  const onTriggerPointerDown = useCallback(
    (registrationId: string, itemId: string) => {
      clearHoverOpenTimer();
      clearHoverCloseTimer();
      const active = activeSlotRef.current;
      if (
        activeItemRef.current !== null &&
        active !== null &&
        active.registrationId === registrationId &&
        active.itemId === itemId
      ) {
        commitClose(registrationId);
        return;
      }
      const pointer = pointerSlotRef.current;
      if (
        pointer !== null &&
        pointer.registrationId === registrationId &&
        pointer.itemId === itemId
      ) {
        pointerSlotRef.current = null;
        setPointerSlot(null);
      }
    },
    [clearHoverCloseTimer, clearHoverOpenTimer, commitClose],
  );

  const isRelatedTarget = useCallback((target: EventTarget | null) => {
    if (isDomNode(target) && activeAnchorElementRef.current?.contains(target)) {
      return true;
    }
    return isWithinGlobalTooltipRelatedTarget(target, {
      triggerZones: triggerZonesRef.current.values(),
      triggerElements: triggerElementsRef.current.values(),
      content: contentRef.current,
    });
  }, []);

  const registerActiveAnchorElement = useCallback((element: HTMLElement | null) => {
    activeAnchorElementRef.current = element;
    const active = activeSlotRef.current;
    if (element && active) {
      lastEnterTargetByRegistrationRef.current.set(active.registrationId, element);
      triggerElementsRef.current.set(active.registrationId, element);
    }
  }, []);

  const notePointerEnterTarget = useCallback(
    (registrationId: string, element: HTMLElement) => {
      lastEnterTargetByRegistrationRef.current.set(registrationId, element);
      triggerElementsRef.current.set(registrationId, element);
    },
    [],
  );

  const reapplyCachedTriggerElement = useCallback((registrationId: string) => {
    const cached = lastEnterTargetByRegistrationRef.current.get(registrationId);
    if (cached) {
      triggerElementsRef.current.set(registrationId, cached);
    }
  }, []);

  const isTargetWithinRegistration = useCallback(
    (registrationId: string, target: Node) => {
      const cached = lastEnterTargetByRegistrationRef.current.get(registrationId);
      if (cached?.contains(target)) {
        return true;
      }
      const triggerEl = triggerElementsRef.current.get(registrationId);
      if (triggerEl?.contains(target)) {
        return true;
      }
      const zone = triggerZonesRef.current.get(registrationId);
      return zone?.contains(target) ?? false;
    },
    [],
  );

  const reaffirmActiveRegistrationTrigger = useCallback(
    (event: PointerEvent) => {
      const active = activeSlotRef.current;
      if (!active || activeItemRef.current === null || !isDomNode(event.target)) {
        return;
      }
      const anchor = activeAnchorElementRef.current;
      if (anchor?.isConnected && anchor.contains(event.target)) {
        triggerElementsRef.current.set(active.registrationId, anchor);
        lastEnterTargetByRegistrationRef.current.set(active.registrationId, anchor);
        return;
      }
      if (isTargetWithinRegistration(active.registrationId, event.target)) {
        reapplyCachedTriggerElement(active.registrationId);
      }
    },
    [isTargetWithinRegistration, reapplyCachedTriggerElement],
  );

  const handleItemPointerEnter = useCallback(
    <TItem,>(
      registrationId: string,
      item: TItem,
      getItemId: (item: TItem) => string,
      openDelayMs: number,
    ) => {
      const itemId = getItemId(item);
      openDelayByRegistrationRef.current.set(registrationId, openDelayMs);
      clearHoverCloseTimer();
      if (lingerClearTimerRef.current !== undefined) {
        clearTimeout(lingerClearTimerRef.current);
        lingerClearTimerRef.current = undefined;
      }
      if (lingerContentClearTimerRef.current !== undefined) {
        clearTimeout(lingerContentClearTimerRef.current);
        lingerContentClearTimerRef.current = undefined;
      }
      setLingerAnchorSlot(null);
      setLingerActiveItem(null);
      setLingerAnchorScreenRect(null);

      const slot = tooltipSwitchSlotKey(registrationId, itemId);
      pointerSlotRef.current = slot;
      setPointerSlot(slot);

      if (
        activeItemRef.current !== null &&
        activeSlotRef.current !== null &&
        tooltipSwitchSlotsEqual(activeSlotRef.current, slot)
      ) {
        clearHoverCloseTimer();
        reapplyCachedTriggerElement(registrationId);
        return;
      }

      if (activeItemRef.current !== null) {
        clearHoverOpenTimer();
        setActiveSlot(slot);
        setActiveItem(item);
        setOpenKind("instant");
        reapplyCachedTriggerElement(registrationId);
        return;
      }

      clearHoverOpenTimer();
      hoverOpenTimerRef.current = setTimeout(() => {
        hoverOpenTimerRef.current = undefined;
        const pointer = pointerSlotRef.current;
        if (!pointer || !tooltipSwitchSlotKey(registrationId, itemId)) {
          return;
        }
        if (pointer.registrationId !== registrationId || pointer.itemId !== itemId) {
          return;
        }
        setActiveSlot(slot);
        setActiveItem(item);
        setOpenKind("delayed");
        reapplyCachedTriggerElement(registrationId);
      }, openDelayMs);
    },
    [clearHoverCloseTimer, clearHoverOpenTimer, reapplyCachedTriggerElement],
  );

  const getTriggerProps = useCallback(
    <TItem,>(
      registrationId: string,
      item: TItem,
      getItemId: (item: TItem) => string,
      openDelayMs: number,
    ): AnchoredItemSwitchTriggerProps => {
      const itemId = getItemId(item);
      const slot = tooltipSwitchSlotKey(registrationId, itemId);
      return {
        onPointerEnter: (event?: ReactPointerEvent) => {
          const enterTarget = event?.currentTarget;
          if (enterTarget instanceof HTMLElement) {
            notePointerEnterTarget(registrationId, enterTarget);
          }
          handleItemPointerEnter(registrationId, item, getItemId, openDelayMs);
        },
        isHighlighted:
          (pointerSlot !== null &&
            pointerSlot.registrationId === registrationId &&
            pointerSlot.itemId === itemId) ||
          (activeSlot !== null &&
            activeSlot.registrationId === registrationId &&
            activeSlot.itemId === itemId),
        isAnchor: isActiveTooltipAnchorSlot(anchorSlot, registrationId, itemId),
      };
    },
    [activeSlot, anchorSlot, handleItemPointerEnter, notePointerEnterTarget, pointerSlot],
  );

  const onTriggerZonePointerLeave = useCallback(
    (registrationId: string, event: ReactPointerEvent<HTMLDivElement>) => {
      const related = event.relatedTarget;
      if (isDomNode(related)) {
        if (isRelatedTarget(related)) {
          return;
        }
        const triggerEl = triggerElementsRef.current.get(registrationId);
        if (triggerEl?.contains(related)) {
          return;
        }
        const cachedEnter = lastEnterTargetByRegistrationRef.current.get(registrationId);
        if (cachedEnter?.contains(related)) {
          return;
        }
      }
      pointerSlotRef.current = null;
      setPointerSlot(null);
    },
    [isRelatedTarget],
  );

  const registerTriggerZone = useCallback((registrationId: string, zone: HTMLDivElement | null) => {
    triggerZonesRef.current.set(registrationId, zone);
  }, []);

  const registerTriggerElement = useCallback(
    (registrationId: string, element: HTMLElement | null) => {
      if (element) {
        triggerElementsRef.current.set(registrationId, element);
      } else {
        triggerElementsRef.current.delete(registrationId);
      }
    },
    [],
  );

  const unregisterTriggerZone = useCallback((registrationId: string) => {
    triggerZonesRef.current.delete(registrationId);
    triggerElementsRef.current.delete(registrationId);
    lastEnterTargetByRegistrationRef.current.delete(registrationId);
    openDelayByRegistrationRef.current.delete(registrationId);
    closeDelayByRegistrationRef.current.delete(registrationId);
    anchorLingerByRegistrationRef.current.delete(registrationId);
  }, []);

  const isAnchorSlot = useCallback(
    (registrationId: string, itemId: string) =>
      isActiveTooltipAnchorSlot(anchorSlot, registrationId, itemId),
    [anchorSlot],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleDocumentPointerMove = (event: PointerEvent) => {
      reaffirmActiveRegistrationTrigger(event);
      const isRelated =
        (isDomNode(event.target) &&
          activeAnchorElementRef.current?.contains(event.target)) ||
        isWithinGlobalTooltipRelatedTarget(event.target, {
          triggerZones: triggerZonesRef.current.values(),
          triggerElements: triggerElementsRef.current.values(),
          content: contentRef.current,
        }) ||
        isPointerOverTooltipCompanionOverlays(event.clientX, event.clientY);
      if (isRelated) {
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
  }, [clearHoverCloseTimer, open, reaffirmActiveRegistrationTrigger, scheduleHoverClose]);

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
      if (lingerContentClearTimerRef.current !== undefined) {
        clearTimeout(lingerContentClearTimerRef.current);
      }
    };
  }, []);

  return {
    open,
    openKind,
    anchorSlot,
    contentActiveItem,
    activeRegistrationId,
    contentRef,
    registerTriggerZone,
    unregisterTriggerZone,
    registerTriggerElement,
    registerActiveAnchorElement,
    setRegistrationTiming,
    getTriggerProps,
    onTriggerZonePointerLeave,
    dismissActiveItem,
    dismissIfOpen,
    onTriggerPointerDown,
    isAnchorSlot,
    onContentPointerEnter,
    lingerAnchorScreenRect,
  };
}
