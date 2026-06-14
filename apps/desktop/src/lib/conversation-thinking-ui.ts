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

export function hasAssistantBodyTextLaterInTurn(
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
    if (candidate.role === 'assistant' && !candidate.tool && candidate.content.trim()) {
      return true;
    }
  }
  return false;
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

/** Pending assistant row still streaming reasoning (before answer body). */
export function isAssistantReasoningLive(
  message: ConversationMessageSnapshot,
  pendingAuxState: PendingAssistantAux | undefined,
  messages?: readonly ConversationMessageSnapshot[],
  messageIndex?: number,
): boolean {
  if (message.role !== 'assistant' || !message.pending || message.content.trim() || message.tool) {
    return false;
  }
  if (
    messages !== undefined &&
    messageIndex !== undefined &&
    hasAssistantBodyTextLaterInTurn(messages, messageIndex)
  ) {
    return false;
  }
  const thinking = message.aux?.thinking?.trim();
  if (thinking && !isGenericPendingThinkingStatusText(thinking)) {
    return true;
  }
  return isLiveReasoningPlaceholderMessage(message, pendingAuxState);
}

/**
 * The very next assistant row is live reasoning with no tool in between — suppress
 * finalized Thought to avoid Thought + Thinking on the same stream. When a tool row
 * is next, pre-tool Thought must stay visible through tool execution.
 */
export function hasAssistantLiveReasoningLaterInTurn(
  messages: readonly ConversationMessageSnapshot[],
  messageIndex: number,
  pendingAuxState: PendingAssistantAux | undefined,
): boolean {
  const next = messages[messageIndex + 1];
  if (!next || next.role === 'user') {
    return false;
  }
  if (next.role === 'assistant' && next.tool) {
    return false;
  }
  if (
    next.role === 'assistant' &&
    !next.pending &&
    !next.tool &&
    next.content.trim()
  ) {
    return false;
  }
  return isAssistantReasoningLive(next, pendingAuxState, messages, messageIndex + 1);
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

export function shouldShowAssistantThinkingCollapsible(
  message: ConversationMessageSnapshot,
  pendingAuxState: PendingAssistantAux | undefined,
  messages?: readonly ConversationMessageSnapshot[],
  listIndex?: number,
): boolean {
  if (
    messages !== undefined &&
    listIndex !== undefined &&
    hasAssistantBodyTextLaterInTurn(messages, listIndex)
  ) {
    const thinking = message.aux?.thinking?.trim();
    if (
      message.pending &&
      !message.content.trim() &&
      thinking &&
      !isGenericPendingThinkingStatusText(thinking)
    ) {
      return false;
    }
  }
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

  if (
    !message.pending &&
    hasDisplayableThinkingAux &&
    hasAssistantLiveReasoningLaterInTurn(messages, listIndex, pendingAuxState)
  ) {
    // 已固化的独立思考行（无正文）在工具回合中必须保持可见，即使后面还有 live reasoning。
    if (isStandaloneThinkingMessage(message) && hasAssistantToolLaterInTurn(messages, listIndex)) {
      return true;
    }
    // Abort + continue (no tools): prior standalone Thought must stay visible while the next
    // segment streams live Thinking — deferAfterStream normally prevents this adjacency.
    if (isStandaloneThinkingMessage(message) && !hasAssistantToolInCurrentTurn(messages, listIndex)) {
      return true;
    }
    return false;
  }

  if (!hasAssistantToolLaterInTurn(messages, listIndex)) {
    return true;
  }

  if (isLiveReasoningPlaceholderMessage(message, pendingAuxState)) {
    return false;
  }

  // Keep finalized or in-flight substantive reasoning visible while tools run in the
  // same turn. Only suppress the empty pending placeholder row (see test below).
  if (hasDisplayableThinkingAux) {
    return true;
  }

  return isAssistantReasoningLive(message, pendingAuxState, messages, listIndex);
}

export function shouldCollapseThinkingDuringToolPreview(
  messages: readonly ConversationMessageSnapshot[],
  messageIndex: number,
): boolean {
  return hasAssistantToolLaterInTurn(messages, messageIndex);
}
