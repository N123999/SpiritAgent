import path from 'node:path';

/**
 * 主会话首条 Worktree 消息的非阻塞 bootstrap：先入 timeline，再在 poll tick 中完成 git/LLM 命名并 gate LLM turn。
 */
import type { PendingWorkspaceFile } from '@spirit-agent/core';
import { cloneActiveSkills } from './runtime.js';

import i18n from '../lib/i18n-host.js';
import type { ConversationMessageSnapshot, DesktopSnapshot } from '../types.js';
import type { DesktopRewindCheckpointSnapshot } from './rewind.js';
import type { SessionBundle } from './session-bundle.js';
import {
  buildWorktreeBootstrapToolSnapshot,
  isWorktreeBootstrapInFlight,
  type PendingWorktreeBootstrap,
  worktreeBootstrapToolCallId,
} from './worktree-bootstrap-card.js';
import type {
  SessionTurnOrchestratorContext,
  SubmitUserTurnAfterInitializedOptions,
} from './session-turn-orchestrator.js';
import {
  applyDrainedRuntimeHostEvents,
  drainQueuedUserTurnIfIdle,
} from './session-turn-orchestrator.js';

export interface WorktreeBootstrapHostContext {
  validateWorktreeBootstrapPreconditions(): void;
  executeWorktreeBootstrap(userPrompt: string): Promise<void>;
  resolveWorktreeBootstrapSessionKey(): string;
  setLastRuntimeError(error: string): void;
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
  return i18n.t('error.attachedFiles', {
    files: explicitWorkspaceFiles.map((file) => path.basename(file.path)).join(', '),
  });
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

function syncMessagesFromTimeline(bundle: SessionBundle): void {
  bundle.messages = bundle.messageTimeline.toMessages();
}

function upsertWorktreeBootstrapCard(
  bundle: SessionBundle,
  toolCallId: string,
  phase: PendingWorktreeBootstrap['phase'],
): void {
  const snapshot = buildWorktreeBootstrapToolSnapshot(phase);
  snapshot.toolCallId = toolCallId;
  bundle.messageTimeline.upsertToolMessage(toolCallId, snapshot);
  syncMessagesFromTimeline(bundle);
}

export async function startWorktreeBootstrapTurnCommand(
  ctx: SessionTurnOrchestratorContext,
  host: WorktreeBootstrapHostContext,
  text: string,
  options: SubmitUserTurnAfterInitializedOptions = {},
): Promise<DesktopSnapshot> {
  host.validateWorktreeBootstrapPreconditions();

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
  if (bundle.activeSession?.readOnly) {
    throw new Error(i18n.t('error.readonlySessionSend'));
  }
  bundle.rewindWarnings = [];
  ctx.clearAssistantContinuationMarkers();
  const todoSessionKeyBeforeEnsure = ctx.resolveTodoSessionKeyForBundle(bundle);
  ctx.ensureActiveSession(displayText);
  await ctx.reconcileTodoScopeAfterSessionPathChange(bundle, todoSessionKeyBeforeEnsure);
  await ctx.maybeRefreshRuntimeAfterTodoScopeChange(bundle, todoSessionKeyBeforeEnsure);
  const beforeUserCheckpoint = await ctx.buildRewindCheckpointSnapshot() as DesktopRewindCheckpointSnapshot;
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
  bundle.messages.push(userMessage);
  bundle.messageTimeline.beginUserTurn(userMessage.content, {
    messageId: userMessage.id,
    ...(localFileAttachments ? { localFileAttachments } : {}),
  });
  ctx.resetStreamingPlacementState(false);

  const toolCallId = worktreeBootstrapToolCallId(host.resolveWorktreeBootstrapSessionKey());
  upsertWorktreeBootstrapCard(bundle, toolCallId, 'running');

  bundle.pendingWorktreeBootstrap = {
    toolCallId,
    userPrompt: trimmed,
    displayText,
    explicitWorkspaceFiles: explicitWorkspaceFiles.length > 0 ? [...explicitWorkspaceFiles] : undefined,
    userMessageId: userMessage.id,
    beforeUserCheckpoint,
    phase: 'running',
  };

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
  ctx.emitLiveSnapshotUpdate();
  return ctx.buildSnapshot();
}

async function startStreamingAfterWorktreeBootstrap(
  ctx: SessionTurnOrchestratorContext,
  bundle: SessionBundle,
  pending: PendingWorktreeBootstrap,
): Promise<void> {
  const runtime = ctx.requireRuntime();
  await ctx.ensureToolExecutor(bundle);
  try {
    await runtime.startUserTurnStreaming(
      pending.userPrompt,
      [],
      pending.explicitWorkspaceFiles ?? [],
    );
    ctx.refreshArchiveFromRuntime();
    await ctx.recordRewindCheckpoint(pending.userMessageId, pending.beforeUserCheckpoint);
    await runtime.poll();
    applyDrainedRuntimeHostEvents(ctx, bundle, runtime.drainEvents());
  } catch (error) {
    bundle.currentTurnSkills = [];
    ctx.orchestrationFor(bundle).assistantMessages.handleMessageRemoved(
      bundle.messages.length - 1,
      pending.userMessageId,
      'send-user-rollback',
    );
    bundle.messages.pop();
    ctx.rebuildMessageTimelineFromMessages();
    throw error;
  }

  const orchestration = ctx.orchestrationFor(bundle);
  orchestration.runtimeEvents.consumeCompletedTurnResult();
  orchestration.runtimeEvents.syncPendingToolStates();
  orchestration.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
  await ctx.flushDeferredRuntimeRefreshIfIdle(bundle);
  await ctx.refreshTodoSnapshotForBundle(bundle);
}

export async function advancePendingWorktreeBootstrapCommand(
  ctx: SessionTurnOrchestratorContext,
  host: WorktreeBootstrapHostContext,
  bundle: SessionBundle,
): Promise<void> {
  const pending = bundle.pendingWorktreeBootstrap;
  if (!isWorktreeBootstrapInFlight(pending)) {
    return;
  }

  try {
    await host.executeWorktreeBootstrap(pending!.userPrompt);
    upsertWorktreeBootstrapCard(bundle, pending!.toolCallId, 'succeeded');
    host.setLastRuntimeError('');
    ctx.emitLiveSnapshotUpdate();
    await startStreamingAfterWorktreeBootstrap(ctx, bundle, pending!);
    bundle.pendingWorktreeBootstrap = undefined;
    await ctx.persistCurrentSessionIfNeeded();
    await drainQueuedUserTurnIfIdle(ctx, bundle);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    upsertWorktreeBootstrapCard(bundle, pending!.toolCallId, 'failed');
    pending!.phase = 'failed';
    pending!.error = message;
    host.setLastRuntimeError(message);
    bundle.pendingWorktreeBootstrap = undefined;
    bundle.currentTurnSkills = [];
    await ctx.persistCurrentSessionIfNeeded();
    ctx.emitLiveSnapshotUpdate();
  }
}

export function shouldAdvanceWorktreeBootstrap(bundle: SessionBundle): boolean {
  return isWorktreeBootstrapInFlight(bundle.pendingWorktreeBootstrap);
}

/** 切换/重置会话时终止 in-flight bootstrap；卡片标记 failed，不持久化 pending 状态。 */
export function cancelPendingWorktreeBootstrapOnBundle(bundle: SessionBundle): void {
  const pending = bundle.pendingWorktreeBootstrap;
  if (!isWorktreeBootstrapInFlight(pending)) {
    return;
  }
  upsertWorktreeBootstrapCard(bundle, pending!.toolCallId, 'failed');
  bundle.pendingWorktreeBootstrap = undefined;
  bundle.currentTurnSkills = [];
}

export function abortPendingWorktreeBootstrap(
  ctx: SessionTurnOrchestratorContext,
  host: WorktreeBootstrapHostContext,
  bundle: SessionBundle,
): boolean {
  if (!isWorktreeBootstrapInFlight(bundle.pendingWorktreeBootstrap)) {
    return false;
  }
  cancelPendingWorktreeBootstrapOnBundle(bundle);
  host.setLastRuntimeError('');
  void ctx.persistCurrentSessionIfNeeded();
  ctx.emitLiveSnapshotUpdate();
  return true;
}
