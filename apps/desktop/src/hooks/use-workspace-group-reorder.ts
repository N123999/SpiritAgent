import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  applyWorkspaceGroupDragOffset,
  captureListFlipTops,
  clearListFlipInlineStyles,
  measureWorkspaceGroupLayoutMetrics,
  playListFlipAnimation,
  readLayoutTopWithoutTransform,
  settleWorkspaceGroupCollapseAfterDrag,
} from "@/lib/list-flip-animation";
import {
  applyWorkspaceGroupReorderBoundaryTargetIndex,
  clampWorkspaceGroupDragOffsetY,
  clampWorkspaceGroupReorderProbeY,
  computeWorkspaceGroupDragProbeY,
  computeWorkspaceGroupTargetIndexFromLayoutTops,
  getWorkspaceGroupDragOffsetBounds,
} from "@/lib/workspace-group-reorder-target";

export const WORKSPACE_GROUP_REORDER_DRAG_THRESHOLD_PX = 5;

type DragSession = {
  groupId: string;
  pointerId: number;
  anchorClientX: number;
  anchorClientY: number;
  anchorOffsetY: number;
  didDrag: boolean;
  swapCount: number;
};

type UseWorkspaceGroupReorderOptions = {
  enabled: boolean;
  order: readonly string[];
  onOrderChange(nextOrder: string[]): void;
  onPersist(nextOrder: string[]): void;
};

function ordersEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function moveGroupToIndex(
  currentOrder: readonly string[],
  groupId: string,
  targetIndex: number,
): string[] {
  const fromIndex = currentOrder.indexOf(groupId);
  if (fromIndex < 0 || fromIndex === targetIndex) {
    return [...currentOrder];
  }
  const next = [...currentOrder];
  const [item] = next.splice(fromIndex, 1);
  next.splice(targetIndex, 0, item!);
  return next;
}

function syncDraggedGroupOffset(groupId: string, offsetY: number, nodeById: Map<string, HTMLElement>): void {
  const node = nodeById.get(groupId);
  if (!node) {
    return;
  }
  if (Math.abs(offsetY) < 0.5) {
    clearListFlipInlineStyles(node);
    return;
  }
  applyWorkspaceGroupDragOffset(node, offsetY);
}

type WindowDragListeners = {
  move: (event: PointerEvent) => void;
  finish: (event: PointerEvent) => void;
};

export function useWorkspaceGroupReorder({
  enabled,
  order,
  onOrderChange,
  onPersist,
}: UseWorkspaceGroupReorderOptions) {
  const orderRef = useRef(order);
  const nodeByIdRef = useRef(new Map<string, HTMLElement>());
  const dragSessionRef = useRef<DragSession | null>(null);
  const suppressCollapseToggleRef = useRef(false);
  const pendingFlipRef = useRef<{
    beforeTops: Map<string, number>;
    draggedId: string;
    draggedVisualTop: number;
  } | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [pressingGroupId, setPressingGroupId] = useState<string | null>(null);
  const windowDragListenersRef = useRef<WindowDragListeners | null>(null);
  /** FLIP 期间 DOM 含 translateY，实时测量会把邻居读成旧槽位；仅在 drag 开始与换位后（FLIP 前）刷新 */
  const slotLayoutTopsRef = useRef<Map<string, number>>(new Map());

  const refreshSlotLayoutTops = useCallback((currentOrder: readonly string[]) => {
    const { layoutTops } = measureWorkspaceGroupLayoutMetrics(currentOrder, nodeByIdRef.current);
    slotLayoutTopsRef.current = layoutTops;
    return layoutTops;
  }, []);

  const detachWindowDragListeners = useCallback(() => {
    const listeners = windowDragListenersRef.current;
    if (!listeners) {
      return;
    }
    window.removeEventListener("pointermove", listeners.move);
    window.removeEventListener("pointerup", listeners.finish);
    window.removeEventListener("pointercancel", listeners.finish);
    windowDragListenersRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      detachWindowDragListeners();
    };
  }, [detachWindowDragListeners]);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  useEffect(() => {
    const root = document.documentElement;
    if (draggingGroupId !== null) {
      root.dataset.workspaceGroupReorderDragging = "";
      delete root.dataset.workspaceGroupReorderPressing;
      return () => {
        delete root.dataset.workspaceGroupReorderDragging;
      };
    }
    if (pressingGroupId !== null) {
      root.dataset.workspaceGroupReorderPressing = "";
      return () => {
        delete root.dataset.workspaceGroupReorderPressing;
      };
    }
    delete root.dataset.workspaceGroupReorderDragging;
    delete root.dataset.workspaceGroupReorderPressing;
    return undefined;
  }, [draggingGroupId, pressingGroupId]);

  useLayoutEffect(() => {
    const pending = pendingFlipRef.current;
    if (!pending) {
      return;
    }
    pendingFlipRef.current = null;
    const slotLayoutTops = refreshSlotLayoutTops(order);
    playListFlipAnimation({
      nodeById: nodeByIdRef.current,
      orderedIds: order,
      beforeTops: pending.beforeTops,
      draggedId: pending.draggedId,
    });

    const draggedNode = nodeByIdRef.current.get(pending.draggedId);
    const session = dragSessionRef.current;
    if (draggedNode && session?.groupId === pending.draggedId) {
      const layoutTop =
        slotLayoutTops.get(pending.draggedId) ?? readLayoutTopWithoutTransform(draggedNode);
      const rawPreservedOffset = pending.draggedVisualTop - layoutTop;
      const preservedOffset = clampWorkspaceGroupDragOffsetY(
        order,
        slotLayoutTops,
        layoutTop,
        rawPreservedOffset,
      );
      applyWorkspaceGroupDragOffset(draggedNode, preservedOffset);
      session.anchorOffsetY = preservedOffset;
    }
  }, [order, refreshSlotLayoutTops]);

  const registerGroupNode = useCallback((groupId: string, node: HTMLElement | null) => {
    if (node) {
      nodeByIdRef.current.set(groupId, node);
      return;
    }
    nodeByIdRef.current.delete(groupId);
  }, []);

  const computeTargetIndex = useCallback((
    probeY: number,
    currentOrder: readonly string[],
    draggedId: string,
    slotLayoutTops: ReadonlyMap<string, number>,
  ) => computeWorkspaceGroupTargetIndexFromLayoutTops(
    probeY,
    currentOrder,
    draggedId,
    slotLayoutTops,
  ), []);

  const endDrag = useCallback(
    (session: DragSession, didDrag: boolean) => {
      detachWindowDragListeners();
      const draggedNode = nodeByIdRef.current.get(session.groupId);
      if (draggedNode) {
        settleWorkspaceGroupCollapseAfterDrag(draggedNode);
        clearListFlipInlineStyles(draggedNode);
      }
      if (didDrag) {
        suppressCollapseToggleRef.current = true;
        onPersist([...orderRef.current]);
      }
      dragSessionRef.current = null;
      slotLayoutTopsRef.current = new Map();
      setDraggingGroupId(null);
      setPressingGroupId(null);
    },
    [onPersist, detachWindowDragListeners],
  );

  const processPointerMove = useCallback(
    (session: DragSession, clientX: number, clientY: number) => {
      const groupId = session.groupId;
      const dx = clientX - session.anchorClientX;
      const dy = clientY - session.anchorClientY;
      const dragOffsetY = session.anchorOffsetY + dy;
      if (!session.didDrag) {
        if (Math.hypot(dx, dy) < WORKSPACE_GROUP_REORDER_DRAG_THRESHOLD_PX) {
          return;
        }
        session.didDrag = true;
        setDraggingGroupId(groupId);
        refreshSlotLayoutTops(orderRef.current);
      }

      const currentOrder = orderRef.current;
      const slotLayoutTops =
        slotLayoutTopsRef.current.size > 0
          ? slotLayoutTopsRef.current
          : refreshSlotLayoutTops(currentOrder);
      const draggedNode = nodeByIdRef.current.get(groupId);
      const draggedLayoutTop = slotLayoutTops.get(groupId) ?? (draggedNode
        ? readLayoutTopWithoutTransform(draggedNode)
        : clientY);
      const offsetBounds = getWorkspaceGroupDragOffsetBounds(
        currentOrder,
        slotLayoutTops,
        draggedLayoutTop,
      );
      const clampedOffsetY = clampWorkspaceGroupDragOffsetY(
        currentOrder,
        slotLayoutTops,
        draggedLayoutTop,
        dragOffsetY,
      );
      const dragProbeY = computeWorkspaceGroupDragProbeY(draggedLayoutTop, clampedOffsetY);
      const clampedProbeY = clampWorkspaceGroupReorderProbeY(
        currentOrder,
        slotLayoutTops,
        dragProbeY,
      );

      const fromIndex = currentOrder.indexOf(groupId);
      let targetIndex = computeTargetIndex(clampedProbeY, currentOrder, groupId, slotLayoutTops);
      targetIndex = applyWorkspaceGroupReorderBoundaryTargetIndex(
        targetIndex,
        fromIndex,
        currentOrder.length,
        clampedOffsetY,
        offsetBounds,
        dy,
      );
      const nextOrder = moveGroupToIndex(currentOrder, groupId, targetIndex);

      if (!ordersEqual(nextOrder, currentOrder)) {
        session.swapCount += 1;
        pendingFlipRef.current = {
          beforeTops: captureListFlipTops(nodeByIdRef.current, currentOrder),
          draggedId: groupId,
          draggedVisualTop: draggedLayoutTop + clampedOffsetY,
        };
        orderRef.current = nextOrder;
        onOrderChange(nextOrder);
        session.anchorClientX = clientX;
        session.anchorClientY = clientY;
      } else {
        syncDraggedGroupOffset(groupId, clampedOffsetY, nodeByIdRef.current);
      }
    },
    [computeTargetIndex, onOrderChange, refreshSlotLayoutTops],
  );

  const attachWindowDragListeners = useCallback(
    (session: DragSession) => {
      detachWindowDragListeners();

      const onWindowPointerMove = (event: PointerEvent) => {
        const active = dragSessionRef.current;
        if (!active || active.pointerId !== event.pointerId) {
          return;
        }
        event.preventDefault();
        processPointerMove(active, event.clientX, event.clientY);
      };

      const onWindowPointerFinish = (event: PointerEvent) => {
        const active = dragSessionRef.current;
        if (!active || active.pointerId !== event.pointerId) {
          return;
        }
        const didDrag = active.didDrag;
        endDrag(active, didDrag);
      };

      windowDragListenersRef.current = {
        move: onWindowPointerMove,
        finish: onWindowPointerFinish,
      };
      window.addEventListener("pointermove", onWindowPointerMove);
      window.addEventListener("pointerup", onWindowPointerFinish);
      window.addEventListener("pointercancel", onWindowPointerFinish);
    },
    [detachWindowDragListeners, endDrag, processPointerMove],
  );

  const getHeaderPointerHandlers = useCallback(
    (groupId: string) => {
      const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
        if (!enabled || event.button !== 0) {
          return;
        }
        if (
          event.target instanceof Element &&
          event.target.closest("[data-workspace-new-session]")
        ) {
          return;
        }
        setPressingGroupId(groupId);
        dragSessionRef.current = {
          groupId,
          pointerId: event.pointerId,
          anchorClientX: event.clientX,
          anchorClientY: event.clientY,
          anchorOffsetY: 0,
          didDrag: false,
          swapCount: 0,
        };
        attachWindowDragListeners(dragSessionRef.current);
      };

      return {
        onPointerDown,
      };
    },
    [enabled, attachWindowDragListeners],
  );

  const handleHeaderClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressCollapseToggleRef.current) {
      return;
    }
    suppressCollapseToggleRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    draggingGroupId,
    pressingGroupId,
    registerGroupNode,
    getHeaderPointerHandlers,
    handleHeaderClickCapture,
  };
}
