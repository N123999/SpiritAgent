import { setImmediate as waitForImmediate } from 'node:timers/promises';

import type { RuntimeEvent, RuntimeTurnResult } from '@spirit-agent/core';

import type { ConversationMessageSnapshot } from '../types.js';
import { DesktopAssistantMessageStateMachine } from './assistant-message-state.js';
import { DesktopConversationSnapshotView } from './conversation-snapshot.js';
import type { DesktopToolRequest } from './contracts.js';
import {
  DesktopMessageTimeline,
  type DesktopTimelineSegmentKind,
  type DesktopTimelineTurnSnapshot,
} from './message-timeline.js';
import {
  DesktopRuntimeEventOrchestrator,
  runtimeEventsIncludeAppliedResponsesBuiltInToolPreview,
  splitRuntimeEventsForIncrementalFinishTaskPreview,
  splitRuntimeEventsForIncrementalResponsesBuiltInToolPreview,
} from './runtime-event-orchestrator.js';
import type { DesktopRuntime } from './runtime.js';
import {
  buildArchiveAssistantAuxFromConversation,
  buildArchiveMessagesFromConversation,
  sanitizeConversationMessagesForPersistence,
} from './sessions.js';

function nextMessageIdFromMessages(messages: ConversationMessageSnapshot[]): number {
  return Math.max(0, ...messages.map((message) => message.id)) + 1;
}

export class AutomationConversationProjection {
  readonly messageTimeline: DesktopMessageTimeline;
  private readonly assistantMessages: DesktopAssistantMessageStateMachine;
  private readonly runtimeEvents: DesktopRuntimeEventOrchestrator;
  private messageIdCounter: number;
  private deferredRuntimeHostEvents: RuntimeEvent<DesktopToolRequest>[] = [];
  private responsesBuiltInPreviewSeenCallIds = new Set<string>();
  private nextTimelineAssistantSegmentKind: DesktopTimelineSegmentKind = 'initial';
  private runtime: DesktopRuntime | undefined;

  private constructor(messages: ConversationMessageSnapshot[]) {
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
      isRuntimeBusy: () => Boolean(this.runtime?.isBusy()),
    });
    this.runtimeEvents = new DesktopRuntimeEventOrchestrator({
      runtime: () => this.runtime,
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

  static create(): AutomationConversationProjection {
    return new AutomationConversationProjection([]);
  }

  bindRuntime(runtime: DesktopRuntime): void {
    this.runtime = runtime;
  }

  beginUserTurn(userContent: string): void {
    const trimmed = userContent.trim();
    if (!trimmed) {
      return;
    }
    this.messageTimeline.beginUserTurn(trimmed, { messageId: this.allocateMessageId() });
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

  applyCompletedTurnResult(
    result: RuntimeTurnResult<unknown, DesktopToolRequest, string>,
  ): void {
    this.runtimeEvents.applyCompletedTurnResult(result);
    this.runtimeEvents.syncTurnTailState();
    this.nextTimelineAssistantSegmentKind = 'initial';
  }

  toMessages(): ConversationMessageSnapshot[] {
    return sanitizeConversationMessagesForPersistence(this.messageTimeline.toMessages());
  }

  timelineSnapshot(): DesktopTimelineTurnSnapshot[] {
    return this.messageTimeline.snapshot();
  }

  buildArchivePayload(): {
    messages: ReturnType<typeof buildArchiveMessagesFromConversation>;
    assistantAux: ReturnType<typeof buildArchiveAssistantAuxFromConversation>;
  } {
    const desktopMessages = this.toMessages();
    return {
      messages: buildArchiveMessagesFromConversation(desktopMessages),
      assistantAux: buildArchiveAssistantAuxFromConversation(desktopMessages),
    };
  }

  private allocateMessageId(): number {
    const next = this.messageIdCounter;
    this.messageIdCounter += 1;
    return next;
  }
}

export async function runAutomationStreamingTurn(
  runtime: DesktopRuntime,
  projection: AutomationConversationProjection,
  startTurn: () => Promise<void>,
): Promise<RuntimeTurnResult<unknown, DesktopToolRequest, string>> {
  await startTurn();
  while (true) {
    const completed = runtime.takeCompletedTurnResult();
    if (completed) {
      projection.applyDrainedEvents(runtime.drainEvents());
      projection.applyCompletedTurnResult(completed);
      return completed;
    }
    if (!runtime.isBusy()) {
      throw new Error('Automation runtime ended without a turn result.');
    }
    runtime.tickThinkingSpinner();
    await runtime.poll();
    projection.applyDrainedEvents(runtime.drainEvents());
    await waitForImmediate();
  }
}
