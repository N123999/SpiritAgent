import {
  llmMessageTextContent,
  normalizeStoredLlmMessage,
  type ChatArchive,
  type LlmMessage,
} from '@spirit-agent/core';

import type { ConversationMessageSnapshot } from '../types.js';
import {
  finishTaskNoticeFromExecution,
  isFinishTaskToolName,
  normalizeMessageAuxSnapshot,
} from './message-ordering.js';
import type { DesktopMessageTimeline } from './message-timeline.js';

const FINISH_TASK_DEFAULT_OUTPUT = 'Task marked complete.';

export function rehydrateFinishTaskNoticesForRestoredSession(input: {
  messages: ConversationMessageSnapshot[];
  messageTimeline: DesktopMessageTimeline;
  archiveHistory: ChatArchive['llmHistory'];
}): ConversationMessageSnapshot[] {
  rehydrateFinishTaskNoticesInConversation(input.messages, input.archiveHistory);
  rehydrateFinishTaskNoticesInTimeline(input.messageTimeline, input.archiveHistory);
  return input.messageTimeline.toMessages();
}

export function rehydrateFinishTaskNoticesInConversation(
  messages: ConversationMessageSnapshot[],
  llmHistory: ChatArchive['llmHistory'],
): void {
  const historyTurns = splitLlmHistoryIntoTurns(llmHistory);
  const conversationTurns = splitConversationIntoTurns(messages);
  const turnCount = Math.min(historyTurns.length, conversationTurns.length);
  for (let turnIndex = 0; turnIndex < turnCount; turnIndex += 1) {
    const notices = finishTaskNoticesFromHistoryTurn(historyTurns[turnIndex]!);
    if (notices.length === 0) {
      continue;
    }
    applyFinishTaskNoticeToConversationTurn(
      conversationTurns[turnIndex]!,
      notices[notices.length - 1]!,
    );
  }
}

export function rehydrateFinishTaskNoticesInTimeline(
  timeline: DesktopMessageTimeline,
  llmHistory: ChatArchive['llmHistory'],
): void {
  const messages = timeline.toMessages();
  const historyTurns = splitLlmHistoryIntoTurns(llmHistory);
  const conversationTurns = splitConversationIntoTurns(messages);
  const turnCount = Math.min(historyTurns.length, conversationTurns.length);
  for (let turnIndex = 0; turnIndex < turnCount; turnIndex += 1) {
    const notices = finishTaskNoticesFromHistoryTurn(historyTurns[turnIndex]!);
    if (notices.length === 0) {
      continue;
    }
    const notice = notices[notices.length - 1]!;
    const turnMessages = conversationTurns[turnIndex]!;
    for (let index = turnMessages.length - 1; index >= 0; index -= 1) {
      const message = turnMessages[index]!;
      if (message.role !== 'assistant' || message.tool) {
        continue;
      }
      if (message.aux?.finishTaskNotice?.trim() === notice.trim()) {
        break;
      }
      timeline.applyFinishTaskNoticeByMessageId(message.id, notice);
      break;
    }
  }
}

function splitConversationIntoTurns(
  messages: ConversationMessageSnapshot[],
): ConversationMessageSnapshot[][] {
  const turns: ConversationMessageSnapshot[][] = [];
  let current: ConversationMessageSnapshot[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      if (current.length > 0) {
        turns.push(current);
      }
      current = [message];
      continue;
    }
    if (current.length === 0) {
      continue;
    }
    current.push(message);
  }
  if (current.length > 0) {
    turns.push(current);
  }
  return turns;
}

function splitLlmHistoryIntoTurns(
  llmHistory: ChatArchive['llmHistory'],
): LlmMessage[][] {
  const turns: LlmMessage[][] = [];
  let current: LlmMessage[] = [];
  for (const entry of llmHistory) {
    const message = normalizeStoredLlmMessage(entry);
    if (message.role === 'user') {
      if (current.length > 0) {
        turns.push(current);
      }
      current = [message];
      continue;
    }
    if (current.length === 0) {
      continue;
    }
    current.push(message);
  }
  if (current.length > 0) {
    turns.push(current);
  }
  return turns;
}

function finishTaskNoticesFromHistoryTurn(historyTurn: LlmMessage[]): string[] {
  const notices: string[] = [];
  for (let index = 0; index < historyTurn.length; index += 1) {
    const message = historyTurn[index]!;
    if (message.role !== 'assistant' || !message.toolCalls) {
      continue;
    }
    for (const toolCall of message.toolCalls) {
      if (!isFinishTaskToolName(toolCall.name)) {
        continue;
      }
      let request: unknown;
      try {
        request = {
          name: 'finish_task',
          ...(JSON.parse(toolCall.argumentsJson) as Record<string, unknown>),
        };
      } catch {
        request = { name: 'finish_task' };
      }
      const toolResult = historyTurn[index + 1];
      const output =
        toolResult?.role === 'tool' && toolResult.toolCallId === toolCall.id
          ? llmMessageTextContent(toolResult.content).trim()
          : undefined;
      if (!output || output.startsWith('[tool schema error]')) {
        continue;
      }
      if (output === FINISH_TASK_DEFAULT_OUTPUT) {
        notices.push(finishTaskNoticeFromExecution({ request }));
        continue;
      }
      notices.push(finishTaskNoticeFromExecution({ request, output }));
    }
  }
  return notices;
}

function applyFinishTaskNoticeToConversationTurn(
  turnMessages: ConversationMessageSnapshot[],
  notice: string,
): void {
  const normalizedNotice = notice.trim();
  if (!normalizedNotice) {
    return;
  }
  for (let index = turnMessages.length - 1; index >= 0; index -= 1) {
    const message = turnMessages[index]!;
    if (message.role !== 'assistant' || message.tool) {
      continue;
    }
    if (message.aux?.finishTaskNotice?.trim() === normalizedNotice) {
      return;
    }
    message.aux = normalizeMessageAuxSnapshot({
      ...(message.aux?.thinking ? { thinking: message.aux.thinking } : {}),
      ...(message.aux?.compaction ? { compaction: message.aux.compaction } : {}),
      finishTaskNotice: normalizedNotice,
    });
    return;
  }
}
