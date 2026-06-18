import type { RuntimeEvent, SubagentSessionArchiveEntry, SubagentSessionStatus } from '@spirit-agent/core';
import { llmMessageTextContent } from '@spirit-agent/core';

import type { ConversationMessageSnapshot } from '../types.js';
import { DesktopAssistantMessageStateMachine } from './assistant-message-state.js';
import { DesktopConversationSnapshotView } from './conversation-snapshot.js';
import type { DesktopToolRequest } from './contracts.js';
import {
  DesktopMessageTimeline,
  type DesktopTimelineSegmentKind,
} from './message-timeline.js';
import {
  resolveWorktreeBootstrapCardPhaseFromSubagentStatus,
  upsertWorktreeBootstrapCardInTimeline,
} from './worktree-bootstrap-card.js';
import {
  DesktopRuntimeEventOrchestrator,
  runtimeEventsIncludeAppliedResponsesBuiltInToolPreview,
  splitRuntimeEventsForIncrementalFinishTaskPreview,
  splitRuntimeEventsForIncrementalResponsesBuiltInToolPreview,
} from './runtime-event-orchestrator.js';
import type { DesktopRuntime } from './runtime.js';
import type { SessionBundle } from './session-bundle.js';
import { sanitizeConversationMessagesForPersistence } from './sessions.js';

function nextMessageIdFromMessages(messages: ConversationMessageSnapshot[]): number {
  return Math.max(0, ...messages.map((message) => message.id)) + 1;
}

function historyText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return llmMessageTextContent(content);
  }
  return '';
}

function seedMessagesFromSubagentSession(
  session: SubagentSessionArchiveEntry,
): ConversationMessageSnapshot[] {
  for (const entry of session.llmHistory) {
    if (entry.role !== 'user') {
      continue;
    }
    const content = historyText(entry.content).trim();
    if (!content) {
      continue;
    }
    return [{
      id: 1,
      role: 'user',
      content,
      pending: false,
    }];
  }
  return [];
}

export class SubagentConversationProjection {
  readonly messageTimeline: DesktopMessageTimeline;
  private readonly assistantMessages: DesktopAssistantMessageStateMachine;
  private readonly runtimeEvents: DesktopRuntimeEventOrchestrator;
  private messageIdCounter: number;
  private deferredRuntimeHostEvents: RuntimeEvent<DesktopToolRequest>[] = [];
  private responsesBuiltInPreviewSeenCallIds = new Set<string>();
  private nextTimelineAssistantSegmentKind: DesktopTimelineSegmentKind = 'initial';

  private constructor(
    readonly sessionId: string,
    messages: ConversationMessageSnapshot[],
  ) {
    this.messageIdCounter = nextMessageIdFromMessages(messages);
    this.messageTimeline = DesktopMessageTimeline.fromMessages(messages, {
      allocateMessageId: () => this.allocateMessageId(),
      reserveMessageId: (messageId) => {
        this.messageIdCounter = Math.max(this.messageIdCounter, messageId + 1);
      },
    });
    const conversationSnapshotView = new DesktopConversationSnapshotView(() => this.allocateMessageId());
    const messageBuffer: ConversationMessageSnapshot[] = [...messages];
    this.assistantMessages = new DesktopAssistantMessageStateMachine({
      messages: () => messageBuffer,
      setMessages: (nextMessages) => {
        messageBuffer.splice(0, messageBuffer.length, ...nextMessages);
      },
      allocateMessageId: () => this.allocateMessageId(),
      isRuntimeBusy: () => true,
    });
    this.runtimeEvents = new DesktopRuntimeEventOrchestrator({
      runtime: () => undefined,
      messages: () => this.messageTimeline.toMessages(),
      allocateMessageId: () => this.allocateMessageId(),
      assistantMessages: this.assistantMessages,
      messageTimeline: () => this.messageTimeline,
      takeNextAssistantSegmentKind: () => this.nextTimelineAssistantSegmentKind,
      conversationSnapshotView,
      clearCurrentTurnSkills: () => {},
      setLastRuntimeError: () => {},
      refreshArchiveFromRuntime: () => {},
      dispatchExtensionEvent: () => {},
      bindFileChangesToToolMessage: () => {},
    });
  }

  static fromSession(
    session: SubagentSessionArchiveEntry,
    existingMessages?: ConversationMessageSnapshot[],
  ): SubagentConversationProjection {
    const messages = existingMessages?.length
      ? existingMessages.map((message) => ({ ...message }))
      : seedMessagesFromSubagentSession(session);
    const projection = new SubagentConversationProjection(session.summary.sessionId, messages);
    syncWorktreeBootstrapCardOnProjection(projection, session.summary.status, session.summary.sessionId);
    return projection;
  }

  applyDrainedEvents(drained: RuntimeEvent<DesktopToolRequest>[]): void {
    const queued = [...this.deferredRuntimeHostEvents, ...drained];
    this.deferredRuntimeHostEvents = [];
    const splitFinish = splitRuntimeEventsForIncrementalFinishTaskPreview(queued);
    const splitBuiltin = splitRuntimeEventsForIncrementalResponsesBuiltInToolPreview(
      splitFinish.toApply,
      this.responsesBuiltInPreviewSeenCallIds,
    );
    this.deferredRuntimeHostEvents = [...splitFinish.deferred, ...splitBuiltin.deferred];
    this.runtimeEvents.applyRuntimeHostEvents(splitBuiltin.toApply);
    for (const event of splitBuiltin.toApply) {
      if (
        event.kind === 'streaming-tool-preview'
        && runtimeEventsIncludeAppliedResponsesBuiltInToolPreview([event])
      ) {
        this.responsesBuiltInPreviewSeenCallIds.add(event.toolCallId);
      }
    }
  }

  toMessages(): ConversationMessageSnapshot[] {
    return sanitizeConversationMessagesForPersistence(this.messageTimeline.toMessages());
  }

  private allocateMessageId(): number {
    const next = this.messageIdCounter;
    this.messageIdCounter += 1;
    return next;
  }
}

function resolveSubagentSessionForProjection(
  bundle: SessionBundle,
  runtime: DesktopRuntime | undefined,
  sessionId: string,
): SubagentSessionArchiveEntry | undefined {
  if (runtime) {
    for (const entry of runtime.childSessionArchives()) {
      if (entry.summary.sessionId === sessionId) {
        return entry;
      }
    }
  }
  return bundle.archiveSubagentSessions.find((entry) => entry.summary.sessionId === sessionId);
}

export function ensureSubagentConversationProjection(
  bundle: SessionBundle,
  session: SubagentSessionArchiveEntry,
): SubagentConversationProjection {
  const existing = bundle.subagentConversationProjections.get(session.summary.sessionId);
  if (existing) {
    return existing;
  }

  const stored = bundle.subagentDesktopMessagesBySessionId.get(session.summary.sessionId);
  const projection = SubagentConversationProjection.fromSession(
    session,
    stored?.map((message) => ({ ...message })),
  );
  bundle.subagentConversationProjections.set(session.summary.sessionId, projection);
  return projection;
}

export function syncSubagentConversationProjections(
  bundle: SessionBundle,
  runtime: DesktopRuntime | undefined,
): void {
  if (!runtime) {
    return;
  }

  syncSubagentWorktreeBootstrapCards(bundle, runtime);

  const childDrains = runtime.drainActiveChildSessionEvents();
  if (childDrains.length === 0) {
    return;
  }

  for (const childDrain of childDrains) {
    const session = resolveSubagentSessionForProjection(bundle, runtime, childDrain.sessionId);
    if (!session) {
      continue;
    }

    const projection = ensureSubagentConversationProjection(bundle, session);
    projection.applyDrainedEvents(childDrain.events);
    const syncedMessages = projection.toMessages();
    bundle.subagentDesktopMessagesBySessionId.set(
      childDrain.sessionId,
      syncedMessages,
    );
  }
}

function syncWorktreeBootstrapCardOnProjection(
  projection: SubagentConversationProjection,
  status: SubagentSessionStatus,
  sessionId: string,
): void {
  const phase = resolveWorktreeBootstrapCardPhaseFromSubagentStatus(status);
  if (!phase) {
    return;
  }
  upsertWorktreeBootstrapCardInTimeline(projection.messageTimeline, sessionId, phase);
}

function syncSubagentWorktreeBootstrapCards(
  bundle: SessionBundle,
  runtime: DesktopRuntime,
): void {
  for (const session of runtime.childSessionArchives()) {
    const isWorktreeSubagent =
      session.summary.status === 'bootstrapping'
      || Boolean(session.summary.worktreePath);
    if (!isWorktreeSubagent) {
      continue;
    }

    const projection = ensureSubagentConversationProjection(bundle, session);
    syncWorktreeBootstrapCardOnProjection(
      projection,
      session.summary.status,
      session.summary.sessionId,
    );
    bundle.subagentDesktopMessagesBySessionId.set(
      session.summary.sessionId,
      projection.toMessages(),
    );
  }
}

export function cloneSubagentDesktopMessagesRecord(
  record: Record<string, ConversationMessageSnapshot[]> | undefined,
): Map<string, ConversationMessageSnapshot[]> {
  const next = new Map<string, ConversationMessageSnapshot[]>();
  if (!record) {
    return next;
  }
  for (const [sessionId, messages] of Object.entries(record)) {
    next.set(sessionId, messages.map((message) => ({ ...message })));
  }
  return next;
}

export function serializeSubagentDesktopMessagesRecord(
  map: Map<string, ConversationMessageSnapshot[]>,
): Record<string, ConversationMessageSnapshot[]> | undefined {
  if (map.size === 0) {
    return undefined;
  }
  const record: Record<string, ConversationMessageSnapshot[]> = {};
  for (const [sessionId, messages] of map.entries()) {
    if (messages.length > 0) {
      record[sessionId] = messages.map((message) => ({ ...message }));
    }
  }
  return Object.keys(record).length > 0 ? record : undefined;
}
