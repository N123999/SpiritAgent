import type { ConversationMessageSnapshot } from "@/types";

export type MessageRewindStartInput = {
  messageRewindComposerEnabled: boolean;
  message: ConversationMessageSnapshot;
};

/** Whether the user can enter rewind-edit mode for a message. */
export function canStartMessageRewind({
  messageRewindComposerEnabled,
  message,
}: MessageRewindStartInput): boolean {
  return messageRewindComposerEnabled && message.canRewind === true;
}
