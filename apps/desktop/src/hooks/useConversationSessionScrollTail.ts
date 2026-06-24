import { useLayoutEffect, useRef, type ComponentRef, type RefObject } from "react";

import type { ScrollArea } from "@/components/ui/scroll-area";
import { scrollAreaToBottom, scrollAreaViewport } from "@/lib/scroll-area-viewport";

export type UseConversationSessionScrollTailOptions = {
  scrollAreaRef: RefObject<ComponentRef<typeof ScrollArea> | null>;
  composerSessionKey: string;
  /** 会话内容可见（非空、非导航占位隐藏）时才滚动 */
  enabled: boolean;
};

/** 切换 composer 会话后默认滚到对话尾部（最新消息）。 */
export function useConversationSessionScrollTail({
  scrollAreaRef,
  composerSessionKey,
  enabled,
}: UseConversationSessionScrollTailOptions): void {
  const previousComposerSessionKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    const sessionChanged = previousComposerSessionKeyRef.current !== composerSessionKey;
    if (!sessionChanged) {
      return;
    }
    previousComposerSessionKeyRef.current = composerSessionKey;

    const scrollToTail = () => {
      const viewport = scrollAreaViewport(scrollAreaRef.current);
      if (!viewport) {
        return;
      }
      scrollAreaToBottom(viewport);
    };

    scrollToTail();
    requestAnimationFrame(scrollToTail);
  }, [composerSessionKey, enabled, scrollAreaRef]);
}
