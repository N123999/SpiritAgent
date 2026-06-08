import path from 'node:path';

import type {
  LlmActiveSkill,
  PendingWorkspaceFile,
  RuntimeApprovalDecision,
  RuntimeEvent,
} from '@spirit-agent/core';
import { cloneActiveSkills } from './runtime.js';

import i18n from '../lib/i18n-host.js';
import type {
  AskQuestionsResult,
  ConversationMessageSnapshot,
  DesktopApprovalDecision,
  DesktopSnapshot,
} from '../types.js';
import type { DesktopToolRequest } from './contracts.js';
import type { DesktopRuntime } from './runtime.js';
import type { SessionBundle } from './session-bundle.js';
import { toolMessageKey } from './message-ordering.js';
import {
  runtimeEventsIncludeAppliedFinishTaskPreview,
  runtimeEventsIncludeAppliedHostToolStreamingUpdate,
  runtimeEventsIncludeAppliedResponsesBuiltInToolPreview,
  runtimeEventsIncludeAppliedResponsesBuiltInToolStreamingUpdate,
  splitRuntimeEventsForIncrementalFinishTaskPreview,
  splitRuntimeEventsForIncrementalResponsesBuiltInToolPreview,
} from './runtime-event-orchestrator.js';
import {
  canDrainQueuedUserTurn,
  explicitWorkspaceFilesFromQueuedItem,
  findQueuedUserTurnIndex,
  isSessionBundleQueueBlocked,
  removeQueuedUserTurn,
  shiftNextQueuedUserTurn,
} from './message-queue.js';
import {
  isSessionBundleBusy,
  scheduleDirectMediaTurn,
  shouldUseComposerDirectMediaTurn,
} from './direct-media-turn.js';
import { syncSubagentConversationProjections } from './subagent-conversation-projection.js';
import { toRuntimeAskQuestionsResult } from './service-utils.js';

type RuntimeEventsFacade = {
  applyRuntimeHostEvents(events: RuntimeEvent<DesktopToolRequest>[]): void;
  finalizeInterruptedDeferredThinking(input?: {
    thinkingText?: string;
    compactionText?: string;
  }): void;
  consumeCompletedTurnResult(): void;
  syncPendingToolStates(): void;
  syncAssistantPrefixFromHistoryBeforeToolRow(): void;
};

type AssistantMessagesFacade = {
  handleMessageRemoved(index: number, messageId: number, reason: string): void;
};

type TurnOrchestration = {
  runtimeEvents: RuntimeEventsFacade;
  assistantMessages: AssistantMessagesFacade;
};

export interface SubmitUserTurnAfterInitializedOptions {
  preserveRewindWarnings?: boolean;
  displayText?: string;
  turnSkills?: LlmActiveSkill[];
  explicitWorkspaceFiles?: PendingWorkspaceFile[];
  /** Reuse message id from a queued turn when draining the queue. */
  preallocatedMessageId?: number;
}

export interface SessionTurnOrchestratorContext {
  runSerialized<T>(work: () => Promise<T>): Promise<T>;
  ensureInitialized(workspaceRootOverride?: string, options?: { fastPath?: boolean }): Promise<void>;
  requireRuntime(): DesktopRuntime;
  requireState(): { workspaceRoot: string };
  requireConfig(): import('./storage.js').DesktopConfigFile;
  resolveApiKeyForConfigModel(model: string): Promise<string | undefined>;
  activeBundle(): SessionBundle;
  allBundles(): Iterable<SessionBundle>;
  getActiveBundle(): SessionBundle | undefined;
  activeSessionId(): string | undefined;
  emitLiveSnapshotUpdate(): void;
  refreshRuntimeForBundle(bundle: SessionBundle): Promise<void>;
  syncActiveRuntimePointer(): void;
  clearAssistantContinuationMarkers(): void;
  resolveTodoSessionKeyForBundle(bundle: SessionBundle): string;
  ensureActiveSession(displayText: string): void;
  reconcileTodoScopeAfterSessionPathChange(bundle: SessionBundle, previousSessionKey: string): Promise<void>;
  maybeRefreshRuntimeAfterTodoScopeChange(bundle: SessionBundle, previousSessionKey: string): Promise<void>;
  buildRewindCheckpointSnapshot(): Promise<unknown>;
  allocateMessageId(): number;
  resetStreamingPlacementState(full: boolean): void;
  persistCurrentSessionIfNeeded(): Promise<void>;
  scheduleSessionTitleGenerationIfNeeded(seedText: string): void;
  dispatchUserMessageExtensionEvent(text: string, displayText: string, messageId: number): Promise<void>;
  ensureToolExecutor(bundle?: SessionBundle): Promise<unknown>;
  refreshArchiveFromRuntime(bundle?: SessionBundle): void;
  recordRewindCheckpoint(messageId: number, beforeUserCheckpoint?: unknown): Promise<void>;
  orchestrationFor(bundle: SessionBundle): TurnOrchestration;
  rebuildMessageTimelineFromMessages(): void;
  flushDeferredRuntimeRefreshIfIdle(bundle?: SessionBundle): Promise<void>;
  refreshTodoSnapshotForBundle(bundle: SessionBundle): Promise<void>;
  buildSnapshot(): DesktopSnapshot;
  startDreamCollectorIfNeeded(): void;
  persistSessionBundle(bundle: SessionBundle, options: { fromRuntime?: DesktopRuntime; bumpListSortAt?: boolean }): Promise<void>;
  syncSubagentToolStreamingOutput(bundle: SessionBundle): void;
  markInterruptedToolsInCurrentTurn(): void;
  markAssistantMessageContinuable(content: string): void;
  markLatestRenderableAssistantMessageContinuableInCurrentTurn(): void;
  latestContinuableAssistantMessage(): ConversationMessageSnapshot | undefined;
  insertUserApprovalReplyMessage(content: string, pendingToolCallId?: string): void;
  normalizeApprovalDecision(decision: DesktopApprovalDecision | undefined): RuntimeApprovalDecision;
}

export async function submitUserTurnAfterInitializedCommand(
  ctx: SessionTurnOrchestratorContext,
  text: string,
  options: SubmitUserTurnAfterInitializedOptions = {},
): Promise<DesktopSnapshot> {
  const bundle = ctx.activeBundle();
  const trimmed = text.trim();
  const explicitWorkspaceFiles = options.explicitWorkspaceFiles ?? [];
  const displayText = (options.displayText ?? defaultDisplayTextForUserTurn(text, explicitWorkspaceFiles)).trim();
  if (!trimmed && explicitWorkspaceFiles.length === 0) {
    throw new Error(i18n.t('error.messageRequired'));
  }
  if (!displayText) {
    throw new Error(i18n.t('error.messageRequired'));
  }

  const turnSkills = cloneActiveSkills(options.turnSkills ?? []);
  bundle.currentTurnSkills = turnSkills;
  if (!bundle.runtime) {
    await ctx.refreshRuntimeForBundle(bundle);
    ctx.syncActiveRuntimePointer();
  }

  ctx.requireState();
  if (ctx.activeBundle().activeSession?.readOnly) {
    throw new Error(i18n.t('error.readonlySessionSend'));
  }
  if (!options.preserveRewindWarnings) {
    ctx.activeBundle().rewindWarnings = [];
  }
  ctx.clearAssistantContinuationMarkers();
  const todoSessionKeyBeforeEnsure = ctx.resolveTodoSessionKeyForBundle(bundle);
  ctx.ensureActiveSession(displayText);
  await ctx.reconcileTodoScopeAfterSessionPathChange(bundle, todoSessionKeyBeforeEnsure);
  await ctx.maybeRefreshRuntimeAfterTodoScopeChange(bundle, todoSessionKeyBeforeEnsure);
  const beforeUserCheckpoint = await ctx.buildRewindCheckpointSnapshot();
  const localFileAttachments =
    explicitWorkspaceFiles.length > 0
      ? pendingWorkspaceFilesToAttachmentSnapshots(explicitWorkspaceFiles)
      : undefined;
  const userMessage: ConversationMessageSnapshot = {
    id: options.preallocatedMessageId ?? ctx.allocateMessageId(),
    role: 'user',
    content: displayText,
    pending: false,
    ...(localFileAttachments ? { localFileAttachments } : {}),
  };
  ctx.activeBundle().messages.push(userMessage);
  ctx.activeBundle().messageTimeline.beginUserTurn(userMessage.content, {
    messageId: userMessage.id,
    ...(localFileAttachments ? { localFileAttachments } : {}),
  });
  ctx.resetStreamingPlacementState(false);
  const todoSessionKeyBeforePersist = ctx.resolveTodoSessionKeyForBundle(bundle);
  await ctx.persistCurrentSessionIfNeeded();
  ctx.scheduleSessionTitleGenerationIfNeeded(displayText);
  await ctx.reconcileTodoScopeAfterSessionPathChange(bundle, todoSessionKeyBeforePersist);
  await ctx.maybeRefreshRuntimeAfterTodoScopeChange(bundle, todoSessionKeyBeforePersist);
  if (turnSkills.length > 0) {
    await ctx.refreshRuntimeForBundle(bundle);
    ctx.syncActiveRuntimePointer();
  }
  await ctx.dispatchUserMessageExtensionEvent(trimmed, displayText, userMessage.id);

  const config = ctx.requireConfig();
  const directMediaTool = shouldUseComposerDirectMediaTurn(
    config,
    config.activeModel,
    explicitWorkspaceFiles.length,
  );

  if (directMediaTool && trimmed) {
    scheduleDirectMediaTurn(ctx, {
      bundle,
      toolName: directMediaTool,
      prompt: trimmed,
      userMessageId: userMessage.id,
      beforeUserCheckpoint,
    });
    return ctx.buildSnapshot();
  }

  // Re-resolve after promote/persist may have replaced bundle.runtime (todo scope refresh).
  const runtime = ctx.requireRuntime();
  await ctx.ensureToolExecutor(bundle);
  try {
    await runtime.startUserTurnStreaming(trimmed, [], explicitWorkspaceFiles);
    ctx.refreshArchiveFromRuntime();
    await ctx.recordRewindCheckpoint(userMessage.id, beforeUserCheckpoint);
    await runtime.poll();
    applyDrainedRuntimeHostEvents(ctx, bundle, runtime.drainEvents());
  } catch (error) {
    ctx.activeBundle().currentTurnSkills = [];
    ctx.orchestrationFor(ctx.activeBundle()).assistantMessages.handleMessageRemoved(
      ctx.activeBundle().messages.length - 1,
      userMessage.id,
      'send-user-rollback',
    );
    ctx.activeBundle().messages.pop();
    ctx.rebuildMessageTimelineFromMessages();
    throw error;
  }

  const orchestration = ctx.orchestrationFor(ctx.activeBundle());
  orchestration.runtimeEvents.consumeCompletedTurnResult();
  orchestration.runtimeEvents.syncPendingToolStates();
  orchestration.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
  await ctx.flushDeferredRuntimeRefreshIfIdle(bundle);
  await ctx.refreshTodoSnapshotForBundle(bundle);
  await drainQueuedUserTurnIfIdle(ctx, bundle);
  return ctx.buildSnapshot();
}

export async function sendQueuedUserTurnNowCommand(
  ctx: SessionTurnOrchestratorContext,
  queueId: string,
): Promise<DesktopSnapshot> {
  const bundle = ctx.activeBundle();
  const index = findQueuedUserTurnIndex(bundle, queueId);
  if (index < 0) {
    throw new Error(i18n.t('error.queuedUserTurnNotFound'));
  }
  if (bundle.activeSession?.readOnly === true) {
    throw new Error(i18n.t('error.readonlySessionSend'));
  }
  if (isSessionBundleQueueBlocked(bundle)) {
    throw new Error(i18n.t('error.pendingApprovalSend'));
  }

  const [item] = bundle.queuedUserTurns.splice(index, 1);
  if (!item) {
    throw new Error(i18n.t('error.queuedUserTurnNotFound'));
  }

  if (isSessionBundleBusy(bundle)) {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    await abortConversationInContext(ctx);
  }

  return submitUserTurnAfterInitializedCommand(ctx, item.text, {
    displayText: item.displayText,
    preallocatedMessageId: item.messageId,
    explicitWorkspaceFiles: explicitWorkspaceFilesFromQueuedItem(item),
  });
}

export async function drainQueuedUserTurnIfIdle(
  ctx: SessionTurnOrchestratorContext,
  bundle: SessionBundle,
): Promise<void> {
  if (!canDrainQueuedUserTurn(bundle)) {
    return;
  }
  const next = shiftNextQueuedUserTurn(bundle);
  if (!next) {
    return;
  }
  await submitUserTurnAfterInitializedCommand(ctx, next.text, {
    displayText: next.displayText,
    preallocatedMessageId: next.messageId,
    explicitWorkspaceFiles: explicitWorkspaceFilesFromQueuedItem(next),
  });
}

export async function pollCommand(ctx: SessionTurnOrchestratorContext): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    for (const bundle of ctx.allBundles()) {
      if (bundle.runtime?.isBusy()) {
        await tickSessionCommand(ctx, bundle);
      }
    }
    const active = ctx.getActiveBundle();
    if (active && !active.runtime?.isBusy()) {
      await tickSessionCommand(ctx, active, { light: true });
    }
    ctx.syncActiveRuntimePointer();
    ctx.startDreamCollectorIfNeeded();
    return ctx.buildSnapshot();
  });
}

export async function tickSessionCommand(
  ctx: SessionTurnOrchestratorContext,
  bundle: SessionBundle,
  options: { light?: boolean } = {},
): Promise<void> {
  const orchestration = ctx.orchestrationFor(bundle);
  if (bundle.runtime) {
    bundle.runtime.tickThinkingSpinner();
    syncSubagentConversationProjections(bundle, bundle.runtime);
    if (!options.light) {
      await bundle.runtime.poll();
      syncSubagentConversationProjections(bundle, bundle.runtime);
      applyDrainedRuntimeHostEvents(ctx, bundle, bundle.runtime.drainEvents());
    } else {
      const drained = bundle.runtime.drainEvents();
      if (drained.length > 0 || bundle.deferredRuntimeHostEvents.length > 0) {
        applyDrainedRuntimeHostEvents(ctx, bundle, drained);
      }
    }
  } else if (options.light && bundle.deferredRuntimeHostEvents.length > 0) {
    applyDrainedRuntimeHostEvents(ctx, bundle, []);
  }
  if (options.light) {
    return;
  }
  orchestration.runtimeEvents.consumeCompletedTurnResult();
  orchestration.runtimeEvents.syncPendingToolStates();
  ctx.syncSubagentToolStreamingOutput(bundle);
  orchestration.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
  await ctx.persistSessionBundle(bundle, {
    fromRuntime: bundle.runtime,
    bumpListSortAt: false,
  });
  await ctx.flushDeferredRuntimeRefreshIfIdle(bundle);
  await ctx.refreshTodoSnapshotForBundle(bundle);
  await drainQueuedUserTurnIfIdle(ctx, bundle);
}

export async function abortConversationInContext(
  ctx: SessionTurnOrchestratorContext,
): Promise<boolean> {
  const runtime = ctx.requireRuntime();
  const interruptedAssistantText = runtime.pendingAssistantText().trim();
  const interruptedThinkingText = runtime.thinkingText().trim();
  const interruptedCompactionText = runtime.compactionText().trim();
  const interruptedAssistantAuxText =
    interruptedThinkingText || interruptedCompactionText;
  const interruptible =
    runtime.isBusy() &&
    !runtime.currentPendingApproval() &&
    !runtime.currentPendingQuestions();

  if (!interruptible) {
    return false;
  }

  runtime.abort();
  ctx.activeBundle().currentTurnSkills = [];
  const orchestration = ctx.orchestrationFor(ctx.activeBundle());
  orchestration.runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
  orchestration.runtimeEvents.finalizeInterruptedDeferredThinking({
    thinkingText: interruptedThinkingText,
    compactionText: interruptedCompactionText,
  });
  ctx.activeBundle().messageTimeline.abortActiveAssistantSegment();
  orchestration.runtimeEvents.consumeCompletedTurnResult();
  orchestration.runtimeEvents.syncPendingToolStates();
  orchestration.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
  ctx.markInterruptedToolsInCurrentTurn();
  if (interruptedAssistantText || interruptedAssistantAuxText) {
    ctx.markAssistantMessageContinuable(interruptedAssistantText);
  } else {
    ctx.markLatestRenderableAssistantMessageContinuableInCurrentTurn();
  }
  await ctx.persistCurrentSessionIfNeeded();
  await ctx.flushDeferredRuntimeRefreshIfIdle();
  return true;
}

export async function abortConversationCommand(ctx: SessionTurnOrchestratorContext): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    await abortConversationInContext(ctx);
    await drainQueuedUserTurnIfIdle(ctx, ctx.activeBundle());
    return ctx.buildSnapshot();
  });
}

export async function continueAssistantCompletionCommand(
  ctx: SessionTurnOrchestratorContext,
  messageId: number,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    const runtime = ctx.requireRuntime();
    if (runtime.isBusy()) {
      throw new Error(i18n.t('error.runtimeBusy'));
    }
    if (!Number.isFinite(messageId)) {
      throw new Error(i18n.t('error.invalidMessageId'));
    }

    ctx.requireState();
    if (ctx.activeBundle().activeSession?.readOnly) {
      throw new Error(i18n.t('error.readonlySessionContinue'));
    }

    await ctx.ensureToolExecutor();

    const continuable = ctx.latestContinuableAssistantMessage();
    if (!continuable || continuable.id !== messageId) {
      throw new Error(i18n.t('error.messageNotContinuable'));
    }

    const previousContinuationIds = ctx.activeBundle().messages
      .filter((message) => message.canContinue === true)
      .map((message) => message.id);
    try {
      ctx.clearAssistantContinuationMarkers();
      ctx.resetStreamingPlacementState(false);
      await ctx.persistCurrentSessionIfNeeded();
      ctx.activeBundle().nextTimelineAssistantSegmentKind = 'continuation';
      await runtime.continueAssistantCompletionStreaming();
    } catch (error) {
      ctx.activeBundle().nextTimelineAssistantSegmentKind = 'initial';
      for (const message of ctx.activeBundle().messages) {
        if (previousContinuationIds.includes(message.id)) {
          message.canContinue = true;
        }
      }
      throw error;
    }
    ctx.refreshArchiveFromRuntime();
    await runtime.poll();
    const orchestration = ctx.orchestrationFor(ctx.activeBundle());
    orchestration.runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
    orchestration.runtimeEvents.consumeCompletedTurnResult();
    orchestration.runtimeEvents.syncPendingToolStates();
    orchestration.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
    await ctx.flushDeferredRuntimeRefreshIfIdle();
    return ctx.buildSnapshot();
  });
}

export async function replyPendingApprovalCommand(
  ctx: SessionTurnOrchestratorContext,
  decision: DesktopApprovalDecision,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    const runtime = ctx.requireRuntime();
    const pendingApproval = runtime.currentPendingApproval();
    const runtimeDecision = ctx.normalizeApprovalDecision(decision);
    if (runtimeDecision.kind === 'guidance' && runtimeDecision.userMessage.trim()) {
      ctx.insertUserApprovalReplyMessage(
        runtimeDecision.userMessage.trim(),
        pendingApproval ? toolMessageKey(pendingApproval) : undefined,
      );
      ctx.resetStreamingPlacementState(false);
    }
    await runtime.continuePendingApproval(runtimeDecision);
    const orchestration = ctx.orchestrationFor(ctx.activeBundle());
    orchestration.runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
    orchestration.runtimeEvents.consumeCompletedTurnResult();
    orchestration.runtimeEvents.syncPendingToolStates();
    orchestration.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
    await ctx.flushDeferredRuntimeRefreshIfIdle();
    return ctx.buildSnapshot();
  });
}

export async function replyPendingQuestionsCommand(
  ctx: SessionTurnOrchestratorContext,
  result: AskQuestionsResult,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    const runtime = ctx.requireRuntime();
    await runtime.continuePendingQuestions(toRuntimeAskQuestionsResult(result));
    const orchestration = ctx.orchestrationFor(ctx.activeBundle());
    orchestration.runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
    orchestration.runtimeEvents.consumeCompletedTurnResult();
    orchestration.runtimeEvents.syncPendingToolStates();
    orchestration.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
    await ctx.persistCurrentSessionIfNeeded();
    await ctx.flushDeferredRuntimeRefreshIfIdle();
    return ctx.buildSnapshot();
  });
}

export function applyDrainedRuntimeHostEvents(
  ctx: SessionTurnOrchestratorContext,
  bundle: SessionBundle,
  drained: RuntimeEvent<DesktopToolRequest>[],
): void {
  const orchestration = ctx.orchestrationFor(bundle);
  const queued = [...bundle.deferredRuntimeHostEvents, ...drained];
  bundle.deferredRuntimeHostEvents = [];
  const splitFinish = splitRuntimeEventsForIncrementalFinishTaskPreview(queued);
  const splitBuiltin = splitRuntimeEventsForIncrementalResponsesBuiltInToolPreview(
    splitFinish.toApply,
    bundle.responsesBuiltInPreviewSeenCallIds,
  );
  bundle.deferredRuntimeHostEvents = [...splitFinish.deferred, ...splitBuiltin.deferred];
  orchestration.runtimeEvents.applyRuntimeHostEvents(splitBuiltin.toApply);
  for (const event of splitBuiltin.toApply) {
    if (
      event.kind === 'streaming-tool-preview'
      && runtimeEventsIncludeAppliedResponsesBuiltInToolPreview([event])
    ) {
      bundle.responsesBuiltInPreviewSeenCallIds.add(event.toolCallId);
    }
  }
  bundle.messages = bundle.messageTimeline.toMessages();
  if (bundle.id !== ctx.activeSessionId()) {
    return;
  }
  const shouldEmitLiveUpdate =
    runtimeEventsIncludeAppliedFinishTaskPreview(splitBuiltin.toApply)
    || runtimeEventsIncludeAppliedResponsesBuiltInToolStreamingUpdate(splitBuiltin.toApply)
    || runtimeEventsIncludeAppliedHostToolStreamingUpdate(splitBuiltin.toApply);
  if (shouldEmitLiveUpdate) {
    bundle.conversationRevision += 1;
    ctx.emitLiveSnapshotUpdate();
  }
}

function defaultDisplayTextForUserTurn(
  text: string,
  explicitWorkspaceFiles: readonly PendingWorkspaceFile[],
): string {
  const trimmed = text.trim();
  if (trimmed) {
    return trimmed;
  }

  if (explicitWorkspaceFiles.length === 0) {
    return '';
  }

  return i18n.t('error.attachedFiles', { files: explicitWorkspaceFiles.map((file) => path.basename(file.path)).join(', ') });
}

function pendingWorkspaceFilesToAttachmentSnapshots(
  files: readonly PendingWorkspaceFile[],
): ConversationMessageSnapshot['localFileAttachments'] {
  return files.map((file) => ({
    path: file.path,
    name: path.basename(file.path),
    isImage: file.kind === 'image',
  }));
}
