import { useLayoutEffect, useRef } from "react";

export type UseConversationSessionFocusComposerOptions = {
  composerSessionKey: string;
  focusComposer: () => void;
  /** 会话页可见且导航已完成时才聚焦 */
  enabled: boolean;
};

/** 进入会话页或切换 composer 会话后，将焦点移至输入框。 */
export function useConversationSessionFocusComposer({
  composerSessionKey,
  focusComposer,
  enabled,
}: UseConversationSessionFocusComposerOptions): void {
  const lastFocusedSessionKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!enabled || !composerSessionKey.trim()) {
      return;
    }

    if (lastFocusedSessionKeyRef.current === composerSessionKey) {
      return;
    }

    lastFocusedSessionKeyRef.current = composerSessionKey;

    const focus = () => focusComposer();
    queueMicrotask(focus);
    requestAnimationFrame(focus);
  }, [composerSessionKey, enabled, focusComposer]);
}
