import type {
  ConversationMessageSnapshot,
  PendingAssistantAux,
} from '../types.js';
import {
  buildVisibleMessageSnapshots,
} from './message-snapshots.js';
import {
  isStandaloneSubagentStatusAux,
  messageOrderDebugLevel,
  parsePendingSubagentStatusText,
  rewindStandalonePendingAuxInsertIndexForThinking,
  shouldReanchorPersistedStandaloneSubagentStatusOnBeginAssistantResponse,
  summarizeMessagesTailForOrderDebug,
  truncateOneLineForDebug,
} from './message-ordering.js';
import type { StoredDesktopRewindMetadata } from './rewind.js';

export interface BuildConversationMessagesInput {
  messages: ConversationMessageSnapshot[];
  livePendingAux?: PendingAssistantAux;
  rewind: StoredDesktopRewindMetadata;
}

export interface SyncStandalonePendingAuxInput {
  livePendingAux?: PendingAssistantAux;
  pendingAssistantMessageId?: number;
  lastSettledAssistantMessageId?: number;
}

interface StandalonePendingAuxSnapshot {
  message: ConversationMessageSnapshot;
  insertAt: number;
  source: 'live' | 'persisted';
  anchorMessageId?: number;
  anchorResolvedIndex?: number;
}

export class DesktopConversationSnapshotView {
  private persistedStandalonePendingAux: PendingAssistantAux | undefined;
  private persistedStandalonePendingAuxAnchorMessageId: number | undefined;
  private standalonePendingAuxMessageId: number | undefined;
  private lastStandalonePendingAuxSnapshotLogSignature: string | undefined;

  constructor(private readonly allocateMessageId: () => number) {}

  buildMessagesWithPendingAssistant(input: BuildConversationMessagesInput): ConversationMessageSnapshot[] {
    const snapshots = buildVisibleMessageSnapshots({
      messages: input.messages,
      livePendingAux: input.livePendingAux,
      rewind: input.rewind,
    });

    const standalonePendingAux = this.standalonePendingAuxSnapshot(
      input.livePendingAux,
      snapshots,
    );
    if (!standalonePendingAux) {
      this.lastStandalonePendingAuxSnapshotLogSignature = undefined;
      return snapshots;
    }

    const insertAt = Math.max(0, Math.min(standalonePendingAux.insertAt, snapshots.length));
    snapshots.splice(insertAt, 0, standalonePendingAux.message);
    this.logSnapshotStandalonePendingAux(standalonePendingAux, snapshots);
    return snapshots;
  }

  syncStandalonePendingAux(input: SyncStandalonePendingAuxInput): void {
    const livePendingAux = input.livePendingAux;
    if (livePendingAux && isStandaloneSubagentStatusAux(livePendingAux)) {
      this.persistedStandalonePendingAux = {
        kind: livePendingAux.kind,
        statusText: livePendingAux.statusText,
        ...(livePendingAux.detailText ? { detailText: livePendingAux.detailText } : {}),
      };
      if (this.standalonePendingAuxMessageId === undefined) {
        this.standalonePendingAuxMessageId = this.allocateMessageId();
      }
      const anchorMessageId = input.pendingAssistantMessageId ?? input.lastSettledAssistantMessageId;
      if (anchorMessageId !== undefined) {
        this.persistedStandalonePendingAuxAnchorMessageId = anchorMessageId;
      }
      return;
    }

    if (!isStandaloneSubagentStatusAux(this.persistedStandalonePendingAux)) {
      this.clearStandalonePendingAuxState();
    }
  }

  shouldReanchorPersistedStandaloneSubagentStatusOnBeginAssistantResponse(
    previousMessage: ConversationMessageSnapshot | undefined,
  ): boolean {
    return shouldReanchorPersistedStandaloneSubagentStatusOnBeginAssistantResponse(
      previousMessage,
      this.persistedStandalonePendingAux,
    );
  }

  reanchorPersistedStandalonePendingAux(anchorMessageId: number): void {
    this.persistedStandalonePendingAuxAnchorMessageId = anchorMessageId;
  }

  clearStandalonePendingAuxState(): void {
    this.persistedStandalonePendingAux = undefined;
    this.persistedStandalonePendingAuxAnchorMessageId = undefined;
    this.standalonePendingAuxMessageId = undefined;
    this.lastStandalonePendingAuxSnapshotLogSignature = undefined;
  }

  private standalonePendingAuxSnapshot(
    livePendingAux: PendingAssistantAux | undefined,
    snapshots: ConversationMessageSnapshot[],
  ): StandalonePendingAuxSnapshot | undefined {
    const liveStandalonePendingAux =
      livePendingAux && isStandaloneSubagentStatusAux(livePendingAux)
        ? livePendingAux
        : undefined;
    const liveStatusText = liveStandalonePendingAux
      ? parsePendingSubagentStatusText(liveStandalonePendingAux.statusText)
      : undefined;
    if (liveStatusText) {
      return {
        source: 'live',
        insertAt: snapshots.length,
        message: this.standalonePendingAuxMessage(liveStatusText),
      };
    }

    const persistedStandalonePendingAux =
      this.persistedStandalonePendingAux && isStandaloneSubagentStatusAux(this.persistedStandalonePendingAux)
        ? this.persistedStandalonePendingAux
        : undefined;
    const persistedStatusText = persistedStandalonePendingAux
      ? parsePendingSubagentStatusText(persistedStandalonePendingAux.statusText)
      : undefined;
    if (!persistedStatusText) {
      return undefined;
    }

    const anchorMessageId = this.persistedStandalonePendingAuxAnchorMessageId;
    let anchorResolvedIndex: number | undefined;
    let insertAt: number | undefined;
    if (anchorMessageId !== undefined) {
      const anchoredIndex = snapshots.findIndex((message) => message.id === anchorMessageId);
      if (anchoredIndex >= 0) {
        anchorResolvedIndex = anchoredIndex;
        insertAt = rewindStandalonePendingAuxInsertIndexForThinking(snapshots, anchoredIndex);
      }
    }

    if (insertAt === undefined) {
      insertAt = snapshots.length > 0 ? Math.max(0, snapshots.length - 1) : 0;
    }

    return {
      source: 'persisted',
      anchorMessageId,
      anchorResolvedIndex,
      insertAt,
      message: this.standalonePendingAuxMessage(persistedStatusText),
    };
  }

  private standalonePendingAuxMessage(statusText: string): ConversationMessageSnapshot {
    if (this.standalonePendingAuxMessageId === undefined) {
      this.standalonePendingAuxMessageId = this.allocateMessageId();
    }

    return {
      id: this.standalonePendingAuxMessageId,
      role: 'assistant',
      content: statusText,
      pending: false,
    };
  }

  private logSnapshotStandalonePendingAux(
    standalonePendingAux: StandalonePendingAuxSnapshot,
    snapshots: ConversationMessageSnapshot[],
  ): void {
    if (messageOrderDebugLevel() !== 'verbose') {
      return;
    }

    const status = truncateOneLineForDebug(standalonePendingAux.message.content, 48);
    const tail = summarizeMessagesTailForOrderDebug(snapshots, 6);
    const signature = [
      standalonePendingAux.source,
      standalonePendingAux.message.id,
      standalonePendingAux.insertAt,
      standalonePendingAux.anchorMessageId ?? '∅',
      standalonePendingAux.anchorResolvedIndex ?? '∅',
      standalonePendingAux.message.content,
      tail,
    ].join('|');
    if (signature === this.lastStandalonePendingAuxSnapshotLogSignature) {
      return;
    }
    this.lastStandalonePendingAuxSnapshotLogSignature = signature;
    console.log(
      `[desktop-host][snapshot] standalone-subagent-status source=${standalonePendingAux.source} msg=${standalonePendingAux.message.id} insert=${standalonePendingAux.insertAt} anchorMsg=${standalonePendingAux.anchorMessageId ?? '∅'} anchorIdx=${standalonePendingAux.anchorResolvedIndex ?? '∅'} status≈${status}${standalonePendingAux.message.content.length > 48 ? '…' : ''} tail=${tail}`,
    );
  }
}
