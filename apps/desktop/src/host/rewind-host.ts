import path from 'node:path';

import type { ChatArchive, RuntimeToolExecution } from '@spirit-agent/agent-core';
import type { HostRecordedFileChange } from '@spirit-agent/host-internal';

import { resolveDesktopAgentMode } from '../lib/agent-mode.js';
import type { ConversationMessageSnapshot, DesktopGitSnapshot, PlanSnapshot } from '../types.js';
import type { DesktopRuntime } from './runtime.js';
import type { SessionBundle } from './session-bundle.js';
import {
  bindRewindFileChangesToToolMessage,
  createRewindCheckpointMetadata,
  fileChangeMetadata,
  nextDesktopRewindSequence,
  pruneRewindMetadataAfterCheckpoint,
  saveRewindCheckpointSnapshot,
  saveRewindFileChange,
  toDesktopFileChange,
  upsertRewindCheckpointMetadata,
  type DesktopRewindCheckpointSnapshot,
} from './rewind.js';
import type { DesktopMessageTimeline } from './message-timeline.js';
import { sanitizeConversationMessagesForPersistence } from './sessions.js';
import {
  archiveBeforeLastUser,
  cloneArchiveHistory,
  cloneArchiveSubagentSessions,
  cloneChatArchive,
} from './service-utils.js';
import { cloneHostTodoRecords, listSessionTodos, replaceSessionTodos } from './todos.js';
import { loadHostMetadata, spiritAgentDataDir, type DesktopConfigFile, type DesktopWorkspaceBinding, type HostMetadataSummary } from './storage.js';
import type { DesktopToolRequest } from './contracts.js';

interface RewindHostState {
  workspaceRoot: string;
  workspaceBinding: DesktopWorkspaceBinding;
  config: DesktopConfigFile;
  git: DesktopGitSnapshot;
  metadata: HostMetadataSummary;
  plan: PlanSnapshot;
}

export interface RewindHostContext {
  state(): RewindHostState | undefined;
  requireState(): RewindHostState;
  activeBundle(): SessionBundle;
  activeSessionId(): string | undefined;
  runtime(): DesktopRuntime | undefined;
  requireRuntime(): DesktopRuntime;
  desktopMessages(): ConversationMessageSnapshot[];
  archiveMessages(): Array<{ role: 'user' | 'assistant'; content: string }>;
  archiveAssistantAux(): ChatArchive['assistantAux'];
  resolveTodoSessionKeyForBundle(bundle: SessionBundle): string;
  cancelTodoClearing(sessionKey: string): void;
  refreshTodoSnapshotForBundle(bundle: SessionBundle): Promise<void>;
  createMessageTimelineFromMessages(messages: ConversationMessageSnapshot[]): DesktopMessageTimeline;
  resetStreamingPlacementState(full: boolean): void;
}

export async function recordHostFileChange(
  ctx: RewindHostContext,
  bundle: SessionBundle,
  change: HostRecordedFileChange,
): Promise<void> {
  const state = ctx.state();
  if (!state) {
    return;
  }

  if (
    change.toolName === 'create_plan'
    && change.after.exists
    && change.after.file
  ) {
    bundle.activePlanPath = change.resolvedPath;
  }

  if (
    bundle.id === ctx.activeSessionId()
    && (
      (bundle.activePlanPath && sameFsPath(change.resolvedPath, bundle.activePlanPath))
      || sameFsPath(change.resolvedPath, state.plan.path)
    )
  ) {
    if (bundle.activePlanPath && sameFsPath(change.resolvedPath, bundle.activePlanPath)) {
      state.metadata = await loadHostMetadata(state.workspaceRoot, resolveDesktopAgentMode(state.config), {
        activePlanPath: bundle.activePlanPath,
        workspaceBinding: state.workspaceBinding,
      });
    }
    state.metadata.planMetadata.exists = change.after.exists && change.after.file;
    state.plan = {
      path: change.resolvedPath,
      exists: change.after.exists && change.after.file,
      ...(change.after.content !== undefined ? { content: change.after.content } : {}),
      ...(typeof change.after.mtimeMs === 'number'
        ? { modifiedAtUnixMs: change.after.mtimeMs }
        : {}),
    };
  }

  if (!bundle.activeSession) {
    return;
  }

  const stored = toDesktopFileChange(change, nextDesktopRewindSequence(bundle.rewind));
  await saveRewindFileChange(spiritAgentDataDir(), bundle.rewind.sessionId, stored);
  const metadata = fileChangeMetadata(stored);
  bundle.rewind.fileChanges.push(metadata);
  if (!metadata.toolCallId) {
    bundle.pendingUnboundFileChangeIds.push(metadata.id);
  }
}

export function bindFileChangesToToolMessage(
  bundle: SessionBundle,
  execution: RuntimeToolExecution<DesktopToolRequest>,
  messageId: number,
): void {
  bundle.pendingUnboundFileChangeIds = bindRewindFileChangesToToolMessage(
    bundle.rewind,
    bundle.pendingUnboundFileChangeIds,
    execution,
    messageId,
  );
}

export async function recordRewindCheckpoint(
  ctx: RewindHostContext,
  messageId: number,
  beforeUserCheckpoint?: DesktopRewindCheckpointSnapshot,
): Promise<void> {
  ctx.requireState();
  if (!ctx.activeBundle().activeSession) {
    return;
  }
  const desktopMessages = ctx.desktopMessages();
  const messageIndex = desktopMessages.findIndex((message) => message.id === messageId);
  if (messageIndex < 0) {
    return;
  }

  const checkpoint = createRewindCheckpointMetadata(
    messageId,
    messageIndex,
    nextDesktopRewindSequence(ctx.activeBundle().rewind),
  );
  const runtime = ctx.runtime();
  const archive = runtime
    ? runtime.toArchive(ctx.archiveMessages(), ctx.archiveAssistantAux())
    : {
        messages: ctx.archiveMessages(),
        assistantAux: ctx.archiveAssistantAux(),
        llmHistory: ctx.activeBundle().archiveHistory,
        subagentSessions: ctx.activeBundle().archiveSubagentSessions ?? [],
        loopEnabled: ctx.activeBundle().loopEnabled,
      } satisfies ChatArchive;
  const sessionKey = ctx.resolveTodoSessionKeyForBundle(ctx.activeBundle());
  const currentTodos = cloneHostTodoRecords(await listSessionTodos(sessionKey));
  await saveRewindCheckpointSnapshot(
    spiritAgentDataDir(),
    ctx.activeBundle().rewind.sessionId,
    checkpoint.id,
    {
      archive,
      desktopMessages: sanitizeConversationMessagesForPersistence(desktopMessages),
      todos: currentTodos,
      ...(beforeUserCheckpoint
        ? {
            beforeArchive: cloneChatArchive(beforeUserCheckpoint.archive),
            beforeDesktopMessages: beforeUserCheckpoint.desktopMessages.map((message) => ({ ...message })),
            ...(beforeUserCheckpoint.todos
              ? { beforeTodos: cloneHostTodoRecords(beforeUserCheckpoint.todos) }
              : {}),
          }
        : {}),
    },
  );

  upsertRewindCheckpointMetadata(ctx.activeBundle().rewind, checkpoint);
}

export async function applyTodosAfterRewind(
  ctx: RewindHostContext,
  snapshot: DesktopRewindCheckpointSnapshot,
): Promise<void> {
  const bundle = ctx.activeBundle();
  const sessionKey = ctx.resolveTodoSessionKeyForBundle(bundle);
  ctx.cancelTodoClearing(sessionKey);
  const restored = snapshot.beforeTodos ?? snapshot.todos ?? [];
  await replaceSessionTodos(sessionKey, restored);
  await ctx.refreshTodoSnapshotForBundle(bundle);
}

export async function buildRewindCheckpointSnapshot(
  ctx: RewindHostContext,
): Promise<DesktopRewindCheckpointSnapshot> {
  ctx.requireState();
  const desktopMessages = ctx.desktopMessages();
  const runtime = ctx.runtime();
  const archive = runtime
    ? runtime.toArchive(ctx.archiveMessages(), ctx.archiveAssistantAux())
    : {
        messages: ctx.archiveMessages(),
        assistantAux: ctx.archiveAssistantAux(),
        llmHistory: ctx.activeBundle().archiveHistory,
        subagentSessions: ctx.activeBundle().archiveSubagentSessions ?? [],
        loopEnabled: ctx.activeBundle().loopEnabled,
      } satisfies ChatArchive;
  const sessionKey = ctx.resolveTodoSessionKeyForBundle(ctx.activeBundle());
  const todos = cloneHostTodoRecords(await listSessionTodos(sessionKey));
  return {
    archive,
    desktopMessages: sanitizeConversationMessagesForPersistence(desktopMessages),
    todos,
  };
}

export function restoreBeforeRewindCheckpoint(
  ctx: RewindHostContext,
  snapshot: DesktopRewindCheckpointSnapshot,
  checkpointSequence: number,
): void {
  ctx.requireState();
  const archive = snapshot.beforeArchive ?? archiveBeforeLastUser(snapshot.archive);
  const desktopMessages = snapshot.beforeDesktopMessages ?? snapshot.desktopMessages.slice(0, -1);

  ctx.activeBundle().messages = desktopMessages.map((message) => ({ ...message }));
  ctx.activeBundle().messageTimeline = ctx.createMessageTimelineFromMessages(ctx.activeBundle().messages);
  ctx.activeBundle().archiveHistory = cloneArchiveHistory(archive.llmHistory);
  ctx.activeBundle().archiveSubagentSessions = cloneArchiveSubagentSessions(archive.subagentSessions ?? []);
  ctx.activeBundle().loopEnabled = archive.loopEnabled === true;
  pruneRewindMetadataAfterCheckpoint(ctx.activeBundle().rewind, checkpointSequence);
  ctx.activeBundle().pendingUnboundFileChangeIds = [];
  ctx.activeBundle().messageIdCounter = nextMessageIdFromMessages(ctx.activeBundle().messages);
  ctx.activeBundle().conversationRevision += 1;
  ctx.resetStreamingPlacementState(true);
  ctx.requireRuntime().replaceFromArchive(archive);
}

function nextMessageIdFromMessages(messages: ConversationMessageSnapshot[]): number {
  return messages.reduce((next, message) => Math.max(next, message.id + 1), 1);
}

function normalizeFsPath(value: string): string {
  return path.normalize(value).replace(/\\/g, '/').toLowerCase();
}

function sameFsPath(left: string, right: string): boolean {
  return normalizeFsPath(left) === normalizeFsPath(right);
}
