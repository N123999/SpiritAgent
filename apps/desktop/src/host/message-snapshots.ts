import type {
  ConversationMessageSnapshot,
  PendingAssistantAux,
} from '../types.js';
import { canRewindMessage, type StoredDesktopRewindMetadata } from './rewind.js';
import {
  normalizeMessageAuxSnapshot,
  normalizeToolBlockSnapshot,
  shouldDropEmptyAssistantMessage,
  shouldHideEmptyPendingAssistantSnapshot,
  shouldHidePendingAssistantThinkingForLiveStandaloneSubagentStatus,
  stripThinkingFromAux,
} from './message-ordering.js';

export interface PrunedAssistantMessage {
  messageIndex: number;
  messageId: number;
}

export function buildVisibleMessageSnapshots(input: {
  messages: ConversationMessageSnapshot[];
  livePendingAux?: PendingAssistantAux;
  rewind: StoredDesktopRewindMetadata;
}): ConversationMessageSnapshot[] {
  return input.messages.flatMap((message) => {
    const snapshot = buildVisibleMessageSnapshot({
      message,
      livePendingAux: input.livePendingAux,
      rewind: input.rewind,
    });
    return snapshot && !shouldHideEmptyPendingAssistantSnapshot(snapshot) ? [snapshot] : [];
  });
}

export function buildVisibleMessageSnapshot(input: {
  message: ConversationMessageSnapshot;
  livePendingAux?: PendingAssistantAux;
  rewind: StoredDesktopRewindMetadata;
}): ConversationMessageSnapshot | undefined {
  const tool = normalizeToolBlockSnapshot(input.message.tool);
  const aux = shouldHidePendingAssistantThinkingForLiveStandaloneSubagentStatus(
    input.message,
    input.livePendingAux,
  )
    ? stripThinkingFromAux(input.message.aux)
    : normalizeMessageAuxSnapshot(input.message.aux);
  if (shouldDropEmptyAssistantMessage(input.message, tool, aux)) {
    return undefined;
  }

  const { canRewind: _canRewind, ...base } = input.message;
  return {
    ...base,
    ...(tool ? { tool } : {}),
    ...(aux ? { aux } : {}),
    ...(canRewindMessage(input.rewind, input.message) ? { canRewind: true } : {}),
  };
}

export function pruneEmptyAssistantMessages(
  messages: ConversationMessageSnapshot[],
): {
  messages: ConversationMessageSnapshot[];
  removed: PrunedAssistantMessage[];
} {
  const removed: PrunedAssistantMessage[] = [];
  const nextMessages = messages.filter((message, index) => {
    const drop = shouldDropEmptyAssistantMessage(
      message,
      normalizeToolBlockSnapshot(message.tool),
      normalizeMessageAuxSnapshot(message.aux),
    );
    if (drop) {
      removed.push({
        messageIndex: index - removed.length,
        messageId: message.id,
      });
    }
    return !drop;
  });
  return { messages: nextMessages, removed };
}

export function shiftStreamAssistantThinkingAnchorForInsertion(
  anchor: number | undefined,
  insertAt: number,
): number | undefined {
  if (anchor !== undefined && insertAt <= anchor) {
    return anchor + 1;
  }
  return anchor;
}

export function shiftStreamAssistantThinkingAnchorForRemoval(
  anchor: number | undefined,
  removeAt: number,
  removeCount = 1,
): number | undefined {
  if (anchor === undefined || removeCount <= 0) {
    return anchor;
  }

  if (removeAt + removeCount <= anchor) {
    return anchor - removeCount;
  }

  if (removeAt < anchor) {
    return removeAt;
  }

  return anchor;
}