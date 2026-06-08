import type { ConversationMessageSnapshot } from '@/types';

export function isRunSubagentToolCallPending(
  messages: ReadonlyArray<ConversationMessageSnapshot>,
  toolCallId: string,
): boolean {
  const trimmed = toolCallId.trim();
  if (!trimmed) {
    return false;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.tool?.toolCallId !== trimmed) {
      continue;
    }
    const phase = message.tool.phase;
    return phase === 'preview' || phase === 'running' || phase === 'pending-approval';
  }

  return false;
}
