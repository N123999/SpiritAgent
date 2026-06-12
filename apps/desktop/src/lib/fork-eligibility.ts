import type { ConversationMessageSnapshot } from '@/types';

export type ForkMessageEligibilityInput = {
  message: ConversationMessageSnapshot;
  conversationBusy: boolean;
  activeSessionReadOnly: boolean;
  forkBusy: boolean;
};

export type ForkSessionEligibilityInput = {
  conversationBusy: boolean;
  activeSessionReadOnly: boolean;
  forkBusy: boolean;
  hasForkableAssistantMessage: boolean;
};

export function canForkMessage({
  message,
  conversationBusy,
  activeSessionReadOnly,
  forkBusy,
}: ForkMessageEligibilityInput): boolean {
  if (activeSessionReadOnly || forkBusy || conversationBusy) {
    return false;
  }
  return message.role === 'assistant' && !message.pending;
}

export function canForkSession({
  conversationBusy,
  activeSessionReadOnly,
  forkBusy,
  hasForkableAssistantMessage,
}: ForkSessionEligibilityInput): boolean {
  if (activeSessionReadOnly || forkBusy || conversationBusy) {
    return false;
  }
  return hasForkableAssistantMessage;
}
