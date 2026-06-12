export type ConversationAbortShortcutContext = {
  activeSurface: "conversation" | "settings" | "marketplace" | "automations" | "automation-detail";
  conversationAbortShortcutEligible: boolean;
};

export type KeyboardEventLike = Pick<
  KeyboardEvent,
  "defaultPrevented" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "code" | "key"
> & {
  target: EventTarget | null;
};

/** Physical Ctrl+C abort shortcut (conversation surface only). */
export function shouldTriggerConversationAbortShortcut(
  event: KeyboardEventLike,
  context: ConversationAbortShortcutContext,
): boolean {
  if (event.defaultPrevented) {
    return false;
  }
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return false;
  }
  if (event.code !== "KeyC") {
    return false;
  }
  if (context.activeSurface !== "conversation") {
    return false;
  }
  if (!context.conversationAbortShortcutEligible) {
    return false;
  }
  const target = event.target as HTMLElement | null;
  if (target?.closest(".workspace-shell-xterm, .xterm, .monaco-editor")) {
    return false;
  }
  if (
    target &&
    (target.tagName === "TEXTAREA" ||
      target.tagName === "INPUT" ||
      target.tagName === "SELECT" ||
      (target.isContentEditable &&
        !target.closest("[data-spirit-surface='composer-surface']")))
  ) {
    return false;
  }
  const selection = typeof window !== "undefined" ? window.getSelection() : null;
  if (selection && !selection.isCollapsed) {
    return false;
  }
  return true;
}

/** Mod+P opens file picker; Mod+Shift+P opens action picker. */
export function resolveModPShortcutAction(
  event: Pick<KeyboardEventLike, "defaultPrevented" | "key" | "shiftKey"> & {
    modPressed: boolean;
  },
): "action-picker" | "file-picker" | null {
  if (event.defaultPrevented || !event.modPressed || event.key.toLowerCase() !== "p") {
    return null;
  }
  return event.shiftKey ? "action-picker" : "file-picker";
}
