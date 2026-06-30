import { useCallback, useEffect, useLayoutEffect, useRef, type ComponentRef, type RefObject } from "react";

import type { ScrollArea } from "@/components/ui/scroll-area";
import {
  isScrollNearBottom,
  scrollAreaToBottom,
  scrollAreaViewport,
} from "@/lib/scroll-area-viewport";
import type { ConversationMessageSnapshot, PendingAssistantAux } from "@/types";

const STICK_TO_BOTTOM_THRESHOLD_PX = 48;

export type UseConversationStreamScrollTailOptions = {
  scrollAreaRef: RefObject<ComponentRef<typeof ScrollArea> | null>;
  messages: readonly ConversationMessageSnapshot[];
  pendingAuxState: PendingAssistantAux | undefined;
  isBusy: boolean;
  scrollBedPaddingPx: number;
  enabled: boolean;
};

function buildStreamContentSig(
  messages: readonly ConversationMessageSnapshot[],
  pendingAuxState: PendingAssistantAux | undefined,
): string {
  const last = messages[messages.length - 1];
  const auxSig = pendingAuxState
    ? `${pendingAuxState.kind}:${pendingAuxState.statusText.length}:${pendingAuxState.detailText?.length ?? 0}`
    : "";
  return `${messages.length}:${last?.id ?? ""}:${last?.content.length ?? 0}:${last?.pending === true ? 1 : 0}:${auxSig}`;
}

/** 流式输出时若用户仍在尾部附近，持续滚到对话底部；用户上滚后停止跟随。 */
export function useConversationStreamScrollTail({
  scrollAreaRef,
  messages,
  pendingAuxState,
  isBusy,
  scrollBedPaddingPx,
  enabled,
}: UseConversationStreamScrollTailOptions): void {
  const stickToBottomRef = useRef(true);
  const prevBusyRef = useRef(false);
  const prevContentSigRef = useRef("");

  const scrollToTail = useCallback(
    (forceStick = false) => {
      if (forceStick) {
        stickToBottomRef.current = true;
      } else if (!stickToBottomRef.current) {
        return;
      }
      const viewport = scrollAreaViewport(scrollAreaRef.current);
      if (!viewport) {
        return;
      }
      scrollAreaToBottom(viewport);
    },
    [scrollAreaRef],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const viewport = scrollAreaViewport(scrollAreaRef.current);
    if (!viewport) {
      return;
    }

    const onScroll = () => {
      stickToBottomRef.current = isScrollNearBottom(viewport, STICK_TO_BOTTOM_THRESHOLD_PX);
    };

    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, [enabled, scrollAreaRef]);

  useLayoutEffect(() => {
    if (!enabled) {
      prevBusyRef.current = isBusy;
      return;
    }
    const busyStarted = !prevBusyRef.current && isBusy;
    prevBusyRef.current = isBusy;
    if (!busyStarted) {
      return;
    }
    scrollToTail(true);
    requestAnimationFrame(() => scrollToTail(true));
  }, [enabled, isBusy, scrollToTail]);

  const contentSig = buildStreamContentSig(messages, pendingAuxState);

  useLayoutEffect(() => {
    if (!enabled || !isBusy) {
      prevContentSigRef.current = contentSig;
      return;
    }
    if (contentSig === prevContentSigRef.current) {
      return;
    }
    prevContentSigRef.current = contentSig;
    scrollToTail();
    requestAnimationFrame(() => scrollToTail());
  }, [contentSig, enabled, isBusy, scrollToTail]);

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }
    scrollToTail();
    requestAnimationFrame(() => scrollToTail());
  }, [enabled, scrollBedPaddingPx, scrollToTail]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const viewport = scrollAreaViewport(scrollAreaRef.current);
    const content = viewport?.firstElementChild;
    if (!viewport || !(content instanceof HTMLElement)) {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (!stickToBottomRef.current) {
        return;
      }
      scrollAreaToBottom(viewport);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [enabled, scrollAreaRef]);
}
