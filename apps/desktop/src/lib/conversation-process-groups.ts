import { aggregateProcessToolCounts } from '@/lib/process-tool-category';
import type { ProcessToolCounts } from '@/lib/process-tool-category';
import type { ConversationMessageSnapshot } from '@/types';

export type ConversationRenderItem =
  | { kind: 'message'; messageIndex: number }
  | {
      kind: 'process-group';
      groupId: string;
      messageIndices: number[];
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

function hasAssistantBodyTextBeforeInTurn(
  messages: readonly ConversationMessageSnapshot[],
  messageIndex: number,
): boolean {
  const lastUser = lastUserMessageIndex(messages);
  for (let index = Math.max(0, lastUser + 1); index < messageIndex; index += 1) {
    if (isAssistantBodyTextMessage(messages[index])) {
      return true;
    }
  }
  return false;
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

function runHasToolActivity(
  messages: readonly ConversationMessageSnapshot[],
  messageIndices: readonly number[],
): boolean {
  const counts = collectToolCountsForIndices(messages, messageIndices);
  return Object.values(counts).some((count) => count > 0);
}

function shouldExposeLoneThinkingAsMessage(
  messages: readonly ConversationMessageSnapshot[],
  messageIndices: readonly number[],
  runStart: number,
): boolean {
  return (
    messageIndices.length === 1 &&
    !hasAssistantBodyTextBeforeInTurn(messages, runStart) &&
    Boolean(messages[messageIndices[0] ?? -1]?.aux?.thinking?.trim())
  );
}

function nextAssistantBodyIndexInTurn(
  messages: readonly ConversationMessageSnapshot[],
  messageIndex: number,
): number | undefined {
  for (let index = messageIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index];
    if (!candidate || candidate.role === 'user') {
      break;
    }
    if (isAssistantBodyTextMessage(candidate)) {
      return index;
    }
    if (candidate.tool) {
      return undefined;
    }
  }
  return undefined;
}

/** Continue 等场景：turn 内已有正文，thinking 紧跟下一段正文且无工具夹在中间。 */
function shouldExposeSandwichedThinkingAsMessage(
  messages: readonly ConversationMessageSnapshot[],
  messageIndices: readonly number[],
  runStart: number,
): boolean {
  if (messageIndices.length !== 1) {
    return false;
  }
  const message = messages[messageIndices[0] ?? -1];
  if (!message?.aux?.thinking?.trim()) {
    return false;
  }
  if (!hasAssistantBodyTextBeforeInTurn(messages, runStart)) {
    return false;
  }
  const nextBodyIndex = nextAssistantBodyIndexInTurn(messages, runStart);
  if (nextBodyIndex === undefined) {
    return false;
  }
  for (let index = runStart + 1; index < nextBodyIndex; index += 1) {
    if (messages[index]?.tool) {
      return false;
    }
  }
  return true;
}

function buildProcessGroupId(scopeKey: string, runStart: number): string {
  return `${scopeKey}:process:${runStart}`;
}

export function buildConversationRenderItems(
  messages: readonly ConversationMessageSnapshot[],
  scopeKey: string,
): ConversationRenderItem[] {
  const items: ConversationRenderItem[] = [];
  let pendingAuxIndices: number[] = [];
  let index = 0;

  const pushProcessGroup = (messageIndices: readonly number[], runStart: number) => {
    if (messageIndices.length === 0) {
      return;
    }
    items.push({
      kind: 'process-group',
      groupId: buildProcessGroupId(scopeKey, runStart),
      messageIndices: [...messageIndices],
      toolCounts: collectToolCountsForIndices(messages, messageIndices),
    });
  };

  while (index < messages.length) {
    const message = messages[index];
    if (!isProcessEligibleMetaMessage(message)) {
      if (isAssistantBodyTextMessage(message) && pendingAuxIndices.length > 0) {
        pushProcessGroup(pendingAuxIndices, pendingAuxIndices[0]!);
        pendingAuxIndices = [];
      }
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
      pendingAuxIndices = [];
      for (const messageIndex of messageIndices) {
        items.push({ kind: 'message', messageIndex });
      }
      continue;
    }

    const auxOnly = !runHasToolActivity(messages, messageIndices);

    if (auxOnly) {
      if (
        shouldExposeLoneThinkingAsMessage(messages, messageIndices, runStart)
        || shouldExposeSandwichedThinkingAsMessage(messages, messageIndices, runStart)
      ) {
        items.push({ kind: 'message', messageIndex: messageIndices[0]! });
      } else {
        pendingAuxIndices.push(...messageIndices);
      }
      continue;
    }

    const combinedIndices = [...pendingAuxIndices, ...messageIndices];
    pendingAuxIndices = [];
    pushProcessGroup(combinedIndices, runStart);
  }

  if (pendingAuxIndices.length === 1 && shouldExposeLoneThinkingAsMessage(messages, pendingAuxIndices, pendingAuxIndices[0]!)) {
    items.push({ kind: 'message', messageIndex: pendingAuxIndices[0]! });
  } else if (pendingAuxIndices.length > 0) {
    pushProcessGroup(pendingAuxIndices, pendingAuxIndices[0]!);
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
