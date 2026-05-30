import {
  isGenericPendingThinkingStatusText,
  isLivePendingReasoningAux,
} from './subagent-display.js';
import type { ConversationMessageSnapshot, PendingAssistantAux } from '../types.js';

export function isMcpBackgroundStatusThinkingText(text: string | undefined): boolean {
  return /^MCP 工具执行中:/u.test(text?.trim() ?? '');
}

export function isStandaloneThinkingMessage(
  message: ConversationMessageSnapshot | undefined,
): boolean {
  return Boolean(
    message?.role === 'assistant' &&
      !message.tool &&
      !message.content.trim() &&
      message.aux?.thinking?.trim(),
  );
}

export function hasAssistantToolLaterInTurn(
  messages: readonly ConversationMessageSnapshot[],
  messageIndex: number,
): boolean {
  for (let index = messageIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index];
    if (!candidate) {
      continue;
    }
    if (candidate.role === 'user') {
      break;
    }
    if (candidate.role === 'assistant' && candidate.tool) {
      return true;
    }
  }
  return false;
}

function lastUserMessageIndex(messages: readonly ConversationMessageSnapshot[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return index;
    }
  }
  return -1;
}

export function hasAssistantToolInCurrentTurn(
  messages: readonly ConversationMessageSnapshot[],
  messageIndex: number,
): boolean {
  const lastUser = lastUserMessageIndex(messages);
  if (messageIndex <= lastUser) {
    return false;
  }
  for (let index = lastUser + 1; index < messages.length; index += 1) {
    const candidate = messages[index];
    if (candidate?.role === 'assistant' && candidate.tool) {
      return true;
    }
  }
  return false;
}

export function shouldStripThinkingAuxNearToolCard(
  message: ConversationMessageSnapshot,
  messages: readonly ConversationMessageSnapshot[],
  messageIndex: number,
): boolean {
  const thinking = message.aux?.thinking?.trim();
  if (!thinking) {
    return false;
  }
  if (message.tool) {
    return isMcpBackgroundStatusThinkingText(thinking);
  }
  if (!hasAssistantToolInCurrentTurn(messages, messageIndex)) {
    return false;
  }
  return (
    isMcpBackgroundStatusThinkingText(thinking) || isGenericPendingThinkingStatusText(thinking)
  );
}

function isLiveReasoningPlaceholderMessage(
  message: ConversationMessageSnapshot,
  pendingAuxState: PendingAssistantAux | undefined,
): boolean {
  return Boolean(
    message.role === 'assistant' &&
      message.pending &&
      !message.content.trim() &&
      !message.tool &&
      isLivePendingReasoningAux(pendingAuxState) &&
      pendingAuxState?.kind === 'thinking' &&
      pendingAuxState.detailText === undefined,
  );
}

function assistantReasoningLive(
  message: ConversationMessageSnapshot,
  pendingAuxState?: PendingAssistantAux,
): boolean {
  if (message.role !== 'assistant' || !message.pending || message.content.trim() || message.tool) {
    return false;
  }
  const thinking = message.aux?.thinking?.trim();
  if (thinking && !isGenericPendingThinkingStatusText(thinking)) {
    return true;
  }
  return isLiveReasoningPlaceholderMessage(message, pendingAuxState);
}

export function shouldShowAssistantThinkingCollapsible(
  message: ConversationMessageSnapshot,
  pendingAuxState: PendingAssistantAux | undefined,
  messages?: readonly ConversationMessageSnapshot[],
  listIndex?: number,
): boolean {
  if (message.role === 'user') {
    return false;
  }

  const thinking = message.aux?.thinking?.trim();
  const hasDisplayableThinkingAux = Boolean(
    thinking &&
      !isGenericPendingThinkingStatusText(thinking) &&
      !isMcpBackgroundStatusThinkingText(thinking) &&
      (!message.content.trim() || thinking !== message.content.trim()),
  );
  const show =
    hasDisplayableThinkingAux || isLiveReasoningPlaceholderMessage(message, pendingAuxState);
  if (!show) {
    return false;
  }

  if (messages === undefined || listIndex === undefined) {
    return true;
  }

  if (!hasAssistantToolLaterInTurn(messages, listIndex)) {
    return true;
  }

  if (isLiveReasoningPlaceholderMessage(message, pendingAuxState)) {
    return false;
  }

  if (isStandaloneThinkingMessage(message)) {
    return hasDisplayableThinkingAux;
  }

  return assistantReasoningLive(message, pendingAuxState);
}

export function shouldCollapseThinkingDuringToolPreview(
  messages: readonly ConversationMessageSnapshot[],
  messageIndex: number,
): boolean {
  return hasAssistantToolLaterInTurn(messages, messageIndex);
}
