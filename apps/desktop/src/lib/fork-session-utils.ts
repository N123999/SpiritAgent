import type { ConversationMessageSnapshot } from '../types.js';

const FORK_DISPLAY_NAME_PREFIX = /^\((\d+)\)\s+([\s\S]*)$/;

/** Matches UI fork anchor: completed assistant row with body text or a tool card. */
export function isForkableForkAnchor(message: ConversationMessageSnapshot): boolean {
  if (message.role !== 'assistant' || message.pending) {
    return false;
  }
  return Boolean(message.content.trim() || message.tool);
}

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
  listIndex?: number,
): number | null {
  if (!Number.isFinite(messageId)) {
    return null;
  }
  if (
    listIndex !== undefined
    && listIndex >= 0
    && listIndex < messages.length
  ) {
    const atListIndex = messages[listIndex]!;
    if (atListIndex.id === messageId && isForkableForkAnchor(atListIndex)) {
      return listIndex;
    }
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.id === messageId && isForkableForkAnchor(message)) {
      return index;
    }
  }
  return null;
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
    if (isForkableForkAnchor(message)) {
      return message.id;
    }
  }
  return null;
}

export function collectSubagentParentToolCallIdsInMessages(
  messages: readonly ConversationMessageSnapshot[],
): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    const toolCallId = message.tool?.toolCallId?.trim();
    if (toolCallId) {
      ids.add(toolCallId);
    }
  }
  return ids;
}

export function filterSubagentSessionsForTruncatedMessages<
  T extends { summary: { parentToolCallId: string } },
>(
  sessions: readonly T[],
  truncatedMessages: readonly ConversationMessageSnapshot[],
): T[] {
  const visibleParentIds = collectSubagentParentToolCallIdsInMessages(truncatedMessages);
  return sessions.filter((entry) =>
    visibleParentIds.has(entry.summary.parentToolCallId.trim()),
  );
}
