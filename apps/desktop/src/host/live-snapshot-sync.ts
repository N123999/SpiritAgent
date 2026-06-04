import type { PendingAssistantAux } from '../types.js';
import type { SessionBundle } from './session-bundle.js';
import { parsePendingSubagentStatusText } from './message-ordering.js';
import type { DesktopAssistantMessageStateMachine } from './assistant-message-state.js';
import type { DesktopConversationSnapshotView } from './conversation-snapshot.js';

export function syncLivePendingAuxSnapshot(input: {
  pendingAux: PendingAssistantAux | undefined;
  activeBundle: SessionBundle;
  assistantMessages: DesktopAssistantMessageStateMachine;
  conversationSnapshotView: DesktopConversationSnapshotView;
}): void {
  const standaloneAnchorState = input.assistantMessages.standaloneAnchorState();
  input.conversationSnapshotView.syncStandalonePendingAux({
    livePendingAux: input.pendingAux,
    pendingAssistantMessageId: standaloneAnchorState.pendingAssistantMessageId,
    lastSettledAssistantMessageId: standaloneAnchorState.lastSettledAssistantMessageId,
  });
  if (input.pendingAux && !parsePendingSubagentStatusText(input.pendingAux.statusText)) {
    const auxText = input.pendingAux.detailText?.trim();
    if (auxText) {
      input.assistantMessages.updatePendingAssistantAux(
        input.pendingAux.kind,
        auxText,
      );
      const alreadyFinalized = input.activeBundle.messageTimeline.hasFinalizedAuxInActiveSegment(
        input.pendingAux.kind,
        auxText,
      );
      const skipDuplicatePendingThinking =
        input.pendingAux.kind === 'thinking' &&
        input.activeBundle.messageTimeline.hasPendingThinkingAuxInActiveSegment(auxText);
      if (!alreadyFinalized && !skipDuplicatePendingThinking) {
        input.activeBundle.messageTimeline.updatePendingAssistantAux(
          input.pendingAux.kind,
          auxText,
        );
      }
    }
  }
}
