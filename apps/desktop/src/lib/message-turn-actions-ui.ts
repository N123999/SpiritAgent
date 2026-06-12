import { isAssistantBodyTextMessage } from '@/lib/conversation-process-groups';
import { isSubagentStatusSurfaceMessage } from '@/lib/subagent-display';
import type { ConversationMessageSnapshot } from '@/types';

export function lastUserMessageIndexBefore(
  messages: readonly ConversationMessageSnapshot[],
  messageIndex: number,
): number {
  for (let index = messageIndex; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return index;
    }
  }
  return -1;
}

/** Any later assistant row in the same user turn (tools, thinking, trailing body, etc.). */
export function hasLaterAssistantMessagesInTurn(
  messages: readonly ConversationMessageSnapshot[],
  messageIndex: number,
): boolean {
  for (let index = messageIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.role === 'user') {
      break;
    }
    if (message.role === 'assistant') {
      return true;
    }
  }
  return false;
}

/** True when the message belongs to the turn currently streaming (not prior completed turns). */
export function isMessageInActiveStreamingTurn(
  messages: readonly ConversationMessageSnapshot[],
  messageIndex: number,
  conversationIsBusy: boolean,
): boolean {
  if (!conversationIsBusy || messages.length === 0) {
    return false;
  }
  const activeTurnStart = lastUserMessageIndexBefore(messages, messages.length - 1);
  return messageIndex > activeTurnStart;
}

function isTurnActionsEligibleBodyMessage(
  message: ConversationMessageSnapshot | undefined,
): boolean {
  return Boolean(
    message
    && isAssistantBodyTextMessage(message)
    && !message.pending
    && !isSubagentStatusSurfaceMessage(message),
  );
}

/** Last assistant body-text row in the same user turn (excludes tool/thinking rows). */
export function findLastAssistantBodyTextIndexInTurn(
  messages: readonly ConversationMessageSnapshot[],
  messageIndex: number,
): number | null {
  const turnStart = lastUserMessageIndexBefore(messages, messageIndex);
  let lastIndex: number | null = null;
  for (let index = turnStart + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.role === 'user') {
      break;
    }
    if (isTurnActionsEligibleBodyMessage(message)) {
      lastIndex = index;
    }
  }
  return lastIndex;
}

export function findTurnForkBodyListIndex(
  messages: readonly ConversationMessageSnapshot[],
  fromIndex: number,
): number | null {
  return findLastAssistantBodyTextIndexInTurn(messages, fromIndex);
}

/** Only the final assistant body in a turn may show Continue / Fork actions. */
export function messageShowsAssistantTurnActions(
  message: ConversationMessageSnapshot,
  messages: readonly ConversationMessageSnapshot[],
  messageIndex: number,
): boolean {
  if (!isTurnActionsEligibleBodyMessage(message)) {
    return false;
  }
  if (hasLaterAssistantMessagesInTurn(messages, messageIndex)) {
    return false;
  }
  return findLastAssistantBodyTextIndexInTurn(messages, messageIndex) === messageIndex;
}

export function findLastAssistantTurnActionsListIndex(
  messages: readonly ConversationMessageSnapshot[],
): number | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messageShowsAssistantTurnActions(messages[index]!, messages, index)) {
      return index;
    }
  }
  return null;
}

/** Matches Thought / Compaction chevron hover reveal. */
export const MESSAGE_TURN_HOVER_REVEAL_CLASSES =
  'opacity-0 transition-all duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100';
