import { aggregateProcessToolCounts } from '@/lib/process-tool-category';
import type { ProcessToolCounts } from '@/lib/process-tool-category';
import type { ConversationMessageSnapshot } from '@/types';

export type ConversationRenderItem =
  | { kind: 'message'; messageIndex: number }
  | {
      kind: 'process-group';
      groupId: string;
      messageIndices: number[];
      sealed: boolean;
      toolCounts: ProcessToolCounts;
    };

function isAssistantBodyTextMessage(message: ConversationMessageSnapshot | undefined): boolean {
  return Boolean(message?.role === 'assistant' && !message.tool && message.content.trim());
}

function isProcessEligibleMetaMessage(message: ConversationMessageSnapshot | undefined): boolean {
  if (!message || message.role !== 'assistant') {
    return false;
  }
  if (message.content.trim()) {
    return false;
  }
  if (message.tool) {
    return message.tool.toolName !== 'finish_task';
  }
  return Boolean(message.aux?.thinking?.trim() || message.aux?.compaction?.trim());
}

function lastUserMessageIndex(messages: readonly ConversationMessageSnapshot[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return index;
    }
  }
  return -1;
}

function hasAssistantBodyTextLaterInTurn(
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
    if (isAssistantBodyTextMessage(candidate)) {
      return true;
    }
  }
  return false;
}

function collectToolCountsForIndices(
  messages: readonly ConversationMessageSnapshot[],
  messageIndices: readonly number[],
): ProcessToolCounts {
  const tools = messageIndices
    .map((index) => messages[index]?.tool)
    .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool));
  return aggregateProcessToolCounts(tools);
}

function buildProcessGroupId(
  scopeKey: string,
  messages: readonly ConversationMessageSnapshot[],
  messageIndices: readonly number[],
): string {
  const firstMessage = messages[messageIndices[0] ?? -1];
  return `${scopeKey}:process:${firstMessage?.id ?? messageIndices.join('-')}`;
}

export function buildConversationRenderItems(
  messages: readonly ConversationMessageSnapshot[],
  scopeKey: string,
): ConversationRenderItem[] {
  const items: ConversationRenderItem[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];
    if (!isProcessEligibleMetaMessage(message)) {
      items.push({ kind: 'message', messageIndex: index });
      index += 1;
      continue;
    }

    const runStart = index;
    while (index < messages.length && isProcessEligibleMetaMessage(messages[index])) {
      index += 1;
    }
    const messageIndices = Array.from(
      { length: index - runStart },
      (_, offset) => runStart + offset,
    );
    const sealed = hasAssistantBodyTextLaterInTurn(messages, runStart);

    if (!sealed) {
      for (const messageIndex of messageIndices) {
        items.push({ kind: 'message', messageIndex });
      }
      continue;
    }

    items.push({
      kind: 'process-group',
      groupId: buildProcessGroupId(scopeKey, messages, messageIndices),
      messageIndices,
      sealed,
      toolCounts: collectToolCountsForIndices(messages, messageIndices),
    });
  }

  return items;
}

export function messageIndexInSealedProcessGroup(
  renderItems: readonly ConversationRenderItem[],
  messageIndex: number,
): ConversationRenderItem | undefined {
  return renderItems.find(
    (item) =>
      item.kind === 'process-group' &&
      item.sealed &&
      item.messageIndices.includes(messageIndex),
  );
}

export function isMessageHiddenByProcessGroup(
  renderItems: readonly ConversationRenderItem[],
  messageIndex: number,
): boolean {
  return messageIndexInSealedProcessGroup(renderItems, messageIndex) !== undefined;
}

export { isProcessEligibleMetaMessage, isAssistantBodyTextMessage };

export function resolveMessageForRenderSpacing(
  item: ConversationRenderItem | undefined,
  messages: readonly ConversationMessageSnapshot[],
): ConversationMessageSnapshot | undefined {
  if (!item) {
    return undefined;
  }
  if (item.kind === 'message') {
    return messages[item.messageIndex];
  }
  const lastIndex = item.messageIndices[item.messageIndices.length - 1];
  return lastIndex === undefined ? undefined : messages[lastIndex];
}
