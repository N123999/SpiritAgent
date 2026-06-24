import {
  isGenericPendingCompactionStatusText,
  isLivePendingReasoningAux,
} from './subagent-display.js';
import type { ConversationMessageSnapshot, PendingAssistantAux } from '../types.js';

export function isStandaloneCompactionMessage(
  message: ConversationMessageSnapshot | undefined,
): boolean {
  return Boolean(
    message?.role === 'assistant' &&
      !message.tool &&
      !message.content.trim() &&
      message.aux?.compaction?.trim() &&
      !isGenericPendingCompactionStatusText(message.aux.compaction),
  );
}

/** Compaction aux worth showing/copying: non-placeholder and not identical to trimmed body. */
export function displayableCompactionText(
  message: ConversationMessageSnapshot,
): string | undefined {
  const compaction = message.aux?.compaction?.trim();
  if (
    !compaction ||
    isGenericPendingCompactionStatusText(compaction) ||
    (message.content.trim() && compaction === message.content.trim())
  ) {
    return undefined;
  }
  return compaction;
}

function isLiveCompactionPlaceholderMessage(
  message: ConversationMessageSnapshot,
  pendingAuxState: PendingAssistantAux | undefined,
): boolean {
  if (
    message.role !== 'assistant' ||
    !message.pending ||
    message.content.trim() ||
    message.tool ||
    !isLivePendingReasoningAux(pendingAuxState) ||
    pendingAuxState?.kind !== 'compressing'
  ) {
    return false;
  }

  const compaction = message.aux?.compaction?.trim();
  if (compaction && !isGenericPendingCompactionStatusText(compaction)) {
    return false;
  }

  return true;
}

export function assistantCompactionLive(
  message: ConversationMessageSnapshot,
  pendingAuxState?: PendingAssistantAux,
): boolean {
  if (message.role !== 'assistant' || message.content.trim() || message.tool || !message.pending) {
    return false;
  }

  const compaction = message.aux?.compaction?.trim();
  if (compaction && !isGenericPendingCompactionStatusText(compaction)) {
    return true;
  }

  return isLiveCompactionPlaceholderMessage(message, pendingAuxState);
}

export function shouldShowAssistantCompactionCollapsible(
  message: ConversationMessageSnapshot,
  pendingAuxState: PendingAssistantAux | undefined,
): boolean {
  if (message.role === 'user') {
    return false;
  }

  if (displayableCompactionText(message)) {
    return true;
  }

  if (isLiveCompactionPlaceholderMessage(message, pendingAuxState)) {
    return true;
  }

  return isStandaloneCompactionMessage(message);
}
