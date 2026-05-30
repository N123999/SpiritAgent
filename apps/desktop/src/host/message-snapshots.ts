import type {
  ConversationMessageSnapshot,
  PendingAssistantAux,
} from '../types.js';
import { canRewindMessage, type StoredDesktopRewindMetadata } from './rewind.js';
import { isGenericPendingThinkingStatusText } from '../lib/subagent-display.js';
import { shouldStripThinkingAuxNearToolCard } from '../lib/conversation-thinking-ui.js';
import {
  normalizeMessageAuxSnapshot,
  normalizeToolBlockSnapshot,
  shouldDropEmptyAssistantMessage,
  shouldHideEmptyPendingAssistantSnapshot,
  shouldHidePendingAssistantThinkingForLiveStandaloneSubagentStatus,
  stripRedundantThinkingFromMessageAux,
  stripThinkingFromAux,
} from './message-ordering.js';

function stripGenericPendingThinkingStatusFromAux(
  aux: ReturnType<typeof normalizeMessageAuxSnapshot>,
): ReturnType<typeof normalizeMessageAuxSnapshot> {
  if (!aux?.thinking || !isGenericPendingThinkingStatusText(aux.thinking)) {
    return aux;
  }
  return stripThinkingFromAux(aux);
}

export interface PrunedAssistantMessage {
  messageIndex: number;
  messageId: number;
}

export function buildVisibleMessageSnapshots(input: {
  messages: ConversationMessageSnapshot[];
  livePendingAux?: PendingAssistantAux;
  rewind: StoredDesktopRewindMetadata;
}): ConversationMessageSnapshot[] {
  return input.messages.flatMap((message, messageIndex) => {
    const snapshot = buildVisibleMessageSnapshot({
      message,
      messageIndex,
      messages: input.messages,
      livePendingAux: input.livePendingAux,
      rewind: input.rewind,
    });
    return snapshot && !shouldHideEmptyPendingAssistantSnapshot(snapshot, input.livePendingAux)
      ? [snapshot]
      : [];
  });
}

export function buildVisibleMessageSnapshot(input: {
  message: ConversationMessageSnapshot;
  messageIndex?: number;
  messages?: ConversationMessageSnapshot[];
  livePendingAux?: PendingAssistantAux;
  rewind: StoredDesktopRewindMetadata;
}): ConversationMessageSnapshot | undefined {
  const tool = normalizeToolBlockSnapshot(input.message.tool);
  let normalizedAux = shouldHidePendingAssistantThinkingForLiveStandaloneSubagentStatus(
    input.message,
    input.livePendingAux,
  )
    ? stripThinkingFromAux(input.message.aux)
    : normalizeMessageAuxSnapshot(input.message.aux);
  if (
    input.messages !== undefined &&
    input.messageIndex !== undefined &&
    shouldStripThinkingAuxNearToolCard(input.message, input.messages, input.messageIndex)
  ) {
    normalizedAux = stripThinkingFromAux(normalizedAux);
  }
  const baseAux = stripGenericPendingThinkingStatusFromAux(normalizedAux);
  const aux = stripRedundantThinkingFromMessageAux(input.message.content, baseAux);
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
