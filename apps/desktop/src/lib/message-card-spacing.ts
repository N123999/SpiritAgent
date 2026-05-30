import type { ConversationMessageSnapshot } from '../types.js';
import { isSubagentStatusSurfaceMessage } from './subagent-display.js';
import { isMinimalToolCallMessage } from './tool-call-display.js';

export function isStandaloneAssistantAuxMessage(
  message: ConversationMessageSnapshot | undefined,
): boolean {
  return Boolean(
    message &&
      message.role === 'assistant' &&
      !message.tool &&
      !message.content.trim() &&
      (message.aux?.thinking?.trim() || message.aux?.compaction?.trim()),
  );
}

export function isGrayMetaLeadingMessage(
  message: ConversationMessageSnapshot | undefined,
): boolean {
  if (!message || message.role !== 'assistant') {
    return false;
  }
  if (isSubagentStatusSurfaceMessage(message)) {
    return true;
  }
  if (!message.content.trim()) {
    return Boolean(!message.tool && message.aux?.thinking?.trim());
  }
  if (message.tool) {
    return isMinimalToolCallMessage(message);
  }
  return Boolean(message.aux?.thinking?.trim());
}

export function isGrayMetaTrailingMessage(
  message: ConversationMessageSnapshot | undefined,
): boolean {
  if (!message || message.role !== 'assistant') {
    return false;
  }
  if (isSubagentStatusSurfaceMessage(message)) {
    return true;
  }
  if (message.content.trim()) {
    return false;
  }
  if (message.tool) {
    return isMinimalToolCallMessage(message);
  }
  return Boolean(message.aux?.thinking?.trim() || message.aux?.finishTaskNotice?.trim());
}

export function shouldCompactAfterPreviousMessage(
  previous: ConversationMessageSnapshot | undefined,
  current: ConversationMessageSnapshot,
): boolean {
  const currentHasStandaloneAux = Boolean(
    current.role === 'assistant' &&
      !current.tool &&
      (current.aux?.thinking?.trim() || current.aux?.compaction?.trim()),
  );

  return Boolean(
    isStandaloneAssistantAuxMessage(previous) &&
      current.role === 'assistant' &&
      !current.tool &&
      current.content.trim() &&
      !currentHasStandaloneAux,
  );
}

export function shouldTightenAfterPreviousMetaMessage(
  previous: ConversationMessageSnapshot | undefined,
  current: ConversationMessageSnapshot,
): boolean {
  // Symmetric Thought↔tool rhythm: list rows use space-y-3 + pb-3 only — never -mt-3 when a tool
  // is on either side (logs: tool tighten=false but nextTighten=true made tool→Thought tighter than Thought→tool).
  if (
    !previous ||
    current.role !== 'assistant' ||
    current.tool ||
    previous.tool
  ) {
    return false;
  }

  return isGrayMetaTrailingMessage(previous) && isGrayMetaLeadingMessage(current);
}
