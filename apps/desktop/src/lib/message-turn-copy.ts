import { lastUserMessageIndexBefore } from '@/lib/message-turn-actions-ui';
import { formatToolCallSummaryPlainText } from '@/lib/tool-call-display';
import {
  isGenericPendingCompactionStatusText,
  isGenericPendingThinkingStatusText,
} from '@/lib/subagent-display';
import type { ConversationMessageSnapshot } from '@/types';

export function assistantTurnMessageIndices(
  messages: readonly ConversationMessageSnapshot[],
  anchorIndex: number,
): number[] {
  const turnStart = lastUserMessageIndexBefore(messages, anchorIndex);
  const indices: number[] = [];
  for (let index = turnStart + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.role === 'user') {
      break;
    }
    if (message.role === 'assistant') {
      indices.push(index);
    }
  }
  return indices;
}

export function formatAssistantMessageCopySegments(
  message: ConversationMessageSnapshot,
): string[] {
  const segments: string[] = [];
  const thinking = message.aux?.thinking?.trim() ?? '';
  if (thinking && !isGenericPendingThinkingStatusText(thinking)) {
    segments.push(thinking);
  }
  const compaction = message.aux?.compaction?.trim() ?? '';
  if (compaction && !isGenericPendingCompactionStatusText(compaction)) {
    segments.push(compaction);
  }
  const content = message.content.trim();
  if (content) {
    segments.push(content);
  }
  const finishTaskNotice = message.aux?.finishTaskNotice?.trim() ?? '';
  if (finishTaskNotice) {
    segments.push(finishTaskNotice);
  }
  if (message.tool) {
    segments.push(formatToolCallSummaryPlainText(message.tool));
  }
  return segments;
}

export function formatAssistantTurnCopyText(
  messages: readonly ConversationMessageSnapshot[],
  anchorIndex: number,
): string {
  const indices = assistantTurnMessageIndices(messages, anchorIndex);
  const parts: string[] = [];
  for (const index of indices) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    parts.push(...formatAssistantMessageCopySegments(message));
  }
  return parts.join('\n\n');
}

export function canCopyAssistantTurn(
  messages: readonly ConversationMessageSnapshot[],
  anchorIndex: number,
): boolean {
  return formatAssistantTurnCopyText(messages, anchorIndex).trim().length > 0;
}
