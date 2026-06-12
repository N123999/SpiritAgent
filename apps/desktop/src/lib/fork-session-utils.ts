import type { ConversationMessageSnapshot } from '../types.js';

const FORK_DISPLAY_NAME_PREFIX = /^\((\d+)\)\s+([\s\S]*)$/;

/** Stackable fork title: `My Chat` → `(1) My Chat` → `(2) My Chat`. */
export function deriveForkedSessionDisplayName(sourceDisplayName: string): string {
  const match = sourceDisplayName.match(FORK_DISPLAY_NAME_PREFIX);
  if (match) {
    const next = Number.parseInt(match[1]!, 10) + 1;
    return `(${next}) ${match[2]!}`;
  }
  return `(1) ${sourceDisplayName}`;
}

export function resolveForkAnchorIndex(
  messages: readonly ConversationMessageSnapshot[],
  messageId: number,
): number | null {
  if (!Number.isFinite(messageId)) {
    return null;
  }
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) {
    return null;
  }
  const message = messages[index]!;
  if (message.role !== 'assistant' || message.pending) {
    return null;
  }
  return index;
}

export function truncateMessagesThroughIndex(
  messages: readonly ConversationMessageSnapshot[],
  index: number,
): ConversationMessageSnapshot[] {
  if (index < 0 || index >= messages.length) {
    return [];
  }
  return sanitizeTruncatedMessagesForFork(messages.slice(0, index + 1));
}

export function sanitizeTruncatedMessagesForFork(
  messages: readonly ConversationMessageSnapshot[],
): ConversationMessageSnapshot[] {
  return messages.map((message) => {
    const { canContinue: _canContinue, canRewind: _canRewind, pending: _pending, ...rest } = message;
    return {
      ...rest,
      pending: false,
    };
  });
}

export function findLastForkableAssistantMessageId(
  messages: readonly ConversationMessageSnapshot[],
): number | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === 'assistant' && !message.pending) {
      return message.id;
    }
  }
  return null;
}
