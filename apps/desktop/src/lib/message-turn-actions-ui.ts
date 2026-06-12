import { isSubagentStatusSurfaceMessage } from '@/lib/subagent-display';
import type { ConversationMessageSnapshot } from '@/types';

/** Assistant body row that can show Continue / Fork actions. */
export function messageShowsAssistantTurnActions(
  message: ConversationMessageSnapshot,
): boolean {
  return (
    message.role === 'assistant'
    && Boolean(message.content.trim())
    && !message.pending
    && !isSubagentStatusSurfaceMessage(message)
  );
}

export function findLastAssistantTurnActionsListIndex(
  messages: readonly ConversationMessageSnapshot[],
): number | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messageShowsAssistantTurnActions(messages[index]!)) {
      return index;
    }
  }
  return null;
}

/** Matches Thought / Compaction chevron hover reveal. */
export const MESSAGE_TURN_HOVER_REVEAL_CLASSES =
  'opacity-0 transition-all duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100';
