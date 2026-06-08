import path from 'node:path';

import type { ChatArchive } from '@spirit-agent/core';

import type {
  ActiveSessionSnapshot,
  ConversationContextUsageSnapshot,
  ConversationMessageSnapshot,
  SessionListItem,
} from '../types.js';
import { extractActivePlanPathFromLlmHistory, normalizeApprovalLevel } from '@spirit-agent/host-internal';
import type { ApprovalLevel } from '@spirit-agent/host-internal';
import type { QueuedUserTurn } from './message-queue.js';
import type { SessionTitleSource, StoredDesktopSession } from './contracts.js';
import type { DesktopTimelineTurnSnapshot } from './message-timeline.js';
import type { SessionBundle } from './session-bundle.js';
import { isSessionBundleBusy } from './direct-media-turn.js';
import {
  normalizeMessageAuxSnapshot,
  normalizeToolBlockSnapshot,
  shouldDropEmptyAssistantMessage,
  shouldHideEmptyPendingAssistantSnapshot,
} from './message-ordering.js';
import { cloneArchiveHistory, cloneArchiveSubagentSessions } from './service-utils.js';
import { cloneSubagentDesktopMessagesRecord } from './subagent-conversation-projection.js';
import { createDesktopRewindMetadata, type StoredDesktopRewindMetadata } from './rewind.js';

export const EPHEMERAL_COMMIT_SESSION_PREFIX = 'ephemeral://commit-message/';
export const EPHEMERAL_WORKTREE_SESSION_PREFIX = 'ephemeral://worktree-naming/';
export const EPHEMERAL_SESSION_TITLE_PREFIX = 'ephemeral://session-title/';
const MAX_EPHEMERAL_COMMIT_SESSIONS = 8;
const MAX_EPHEMERAL_WORKTREE_SESSIONS = 8;

export interface EphemeralSessionRecord {
  path: string;
  displayName: string;
  workspaceRoot: string;
  modifiedAtUnixMs: number;
  messages: ConversationMessageSnapshot[];
  llmHistory: ChatArchive['llmHistory'];
  readOnly: true;
}

export interface RestoredSessionState {
  messages: ConversationMessageSnapshot[];
  desktopMessageTimeline?: DesktopTimelineTurnSnapshot[];
  activeSession: ActiveSessionSnapshot;
  archiveHistory: ChatArchive['llmHistory'];
  archiveSubagentSessions: NonNullable<ChatArchive['subagentSessions']>;
  rewind: StoredDesktopRewindMetadata;
  loopEnabled: boolean;
  approvalLevel: ApprovalLevel;
  activePlanPath?: string;
  sessionTitleSource?: SessionTitleSource;
  contextUsage?: ConversationContextUsageSnapshot;
  subagentDesktopMessagesBySessionId?: Map<string, ConversationMessageSnapshot[]>;
  queuedUserTurns?: QueuedUserTurn[];
}

export function isEphemeralCommitSessionPath(filePath: string): boolean {
  return filePath.startsWith(EPHEMERAL_COMMIT_SESSION_PREFIX);
}

export function isEphemeralWorktreeSessionPath(filePath: string): boolean {
  return filePath.startsWith(EPHEMERAL_WORKTREE_SESSION_PREFIX);
}

export function isEphemeralDebugSessionPath(filePath: string): boolean {
  return isEphemeralCommitSessionPath(filePath) || isEphemeralWorktreeSessionPath(filePath);
}

export function createEphemeralWorktreeSessionPath(now = Date.now()): string {
  return `${EPHEMERAL_WORKTREE_SESSION_PREFIX}${now}`;
}

export function rememberEphemeralSessionRecord(
  sessions: EphemeralSessionRecord[],
  record: EphemeralSessionRecord,
): EphemeralSessionRecord[] {
  return [
    record,
    ...sessions.filter((session) => session.path !== record.path),
  ].slice(0, MAX_EPHEMERAL_COMMIT_SESSIONS);
}

export function removeEphemeralSessionRecord(
  sessions: EphemeralSessionRecord[],
  filePath: string,
): EphemeralSessionRecord[] {
  return sessions.filter((session) => session.path !== filePath);
}

export function ephemeralSessionsToListItems(
  sessions: EphemeralSessionRecord[],
): SessionListItem[] {
  return sessions.map((session) => ({
    path: session.path,
    displayName: session.displayName,
    modifiedAtUnixMs: session.modifiedAtUnixMs,
    workspaceRoot: session.workspaceRoot,
    kind: 'ephemeral',
    readOnly: true,
  }));
}

export function buildCommitEphemeralSessionRecord(input: {
  path: string;
  displayName: string;
  workspaceRoot: string;
  messages: ConversationMessageSnapshot[];
  modifiedAtUnixMs?: number;
}): EphemeralSessionRecord {
  return {
    path: input.path,
    displayName: input.displayName,
    workspaceRoot: input.workspaceRoot,
    modifiedAtUnixMs: input.modifiedAtUnixMs ?? Date.now(),
    messages: cloneConversationMessages(input.messages),
    llmHistory: input.messages.map((entry) => ({
      role: entry.role,
      content: entry.content,
      imagePaths: [],
    })),
    readOnly: true,
  };
}

export function rememberEphemeralWorktreeSessionRecord(
  sessions: EphemeralSessionRecord[],
  record: EphemeralSessionRecord,
): EphemeralSessionRecord[] {
  return [
    record,
    ...sessions.filter((session) => session.path !== record.path),
  ].slice(0, MAX_EPHEMERAL_WORKTREE_SESSIONS);
}

export function buildWorktreeEphemeralSessionRecord(input: {
  path: string;
  displayName: string;
  workspaceRoot: string;
  messages: ConversationMessageSnapshot[];
  modifiedAtUnixMs?: number;
}): EphemeralSessionRecord {
  return buildCommitEphemeralSessionRecord(input);
}

export function restoreEphemeralSessionState(record: EphemeralSessionRecord): RestoredSessionState {
  return {
    messages: cloneConversationMessages(record.messages),
    activeSession: {
      filePath: record.path,
      displayName: record.displayName,
      kind: 'ephemeral',
      readOnly: true,
    },
    archiveHistory: cloneArchiveHistory(record.llmHistory),
    archiveSubagentSessions: [],
    rewind: createDesktopRewindMetadata(),
    loopEnabled: false,
    approvalLevel: 'default',
  };
}

export function restoreStoredSessionState(input: {
  filePath: string;
  loaded: StoredDesktopSession;
  fallbackMessages: ConversationMessageSnapshot[];
}): RestoredSessionState {
  const messages = input.loaded.desktopMessages
    ? cloneConversationMessages(input.loaded.desktopMessages)
    : cloneConversationMessages(input.fallbackMessages);
  const desktopMessageTimeline = tryCloneDesktopMessageTimeline(input.loaded.desktopMessageTimeline);
  const storedActivePlanPath = typeof input.loaded.activePlanPath === 'string'
    ? input.loaded.activePlanPath.trim()
    : '';
  const activePlanPath = storedActivePlanPath.length > 0
    ? storedActivePlanPath
    : extractActivePlanPathFromLlmHistory(input.loaded.llmHistory);
  return {
    messages,
    ...(desktopMessageTimeline ? { desktopMessageTimeline } : {}),
    activeSession: {
      filePath: path.resolve(input.filePath),
      displayName: input.loaded.sessionDisplayName ?? deriveDisplayNameFromMessages(messages),
      kind: 'stored',
    },
    archiveHistory: cloneArchiveHistory(input.loaded.llmHistory),
    archiveSubagentSessions: cloneSubagentSessions(input.loaded.subagentSessions ?? []),
    rewind: input.loaded.rewind ?? createDesktopRewindMetadata(),
    loopEnabled: input.loaded.loopEnabled === true,
    approvalLevel: normalizeApprovalLevel(input.loaded.approvalLevel),
    ...(activePlanPath ? { activePlanPath } : {}),
    ...(input.loaded.sessionTitleSource === 'seed' || input.loaded.sessionTitleSource === 'llm'
      ? { sessionTitleSource: input.loaded.sessionTitleSource }
      : {}),
    ...(input.loaded.contextUsage ? { contextUsage: { ...input.loaded.contextUsage } } : {}),
    ...(input.loaded.subagentDesktopMessages
      ? {
          subagentDesktopMessagesBySessionId: cloneSubagentDesktopMessagesRecord(
            input.loaded.subagentDesktopMessages,
          ),
        }
      : {}),
    ...(input.loaded.queuedUserTurns?.length
      ? { queuedUserTurns: cloneQueuedUserTurns(input.loaded.queuedUserTurns) }
      : {}),
  };
}

export function buildStoredDesktopSession(input: {
  archive: ChatArchive;
  savedAtUnixMs?: number;
  sessionDisplayName: string;
  sessionTitleSource?: SessionTitleSource;
  workspaceRoot: string;
  gitBranch?: string;
  activePlanPath?: string;
  desktopMessages: ConversationMessageSnapshot[];
  desktopMessageTimeline?: DesktopTimelineTurnSnapshot[];
  rewind: StoredDesktopRewindMetadata;
  loopEnabled: boolean;
  approvalLevel: ApprovalLevel;
  contextUsage?: ConversationContextUsageSnapshot;
  subagentDesktopMessages?: Record<string, ConversationMessageSnapshot[]>;
  queuedUserTurns?: QueuedUserTurn[];
  automationId?: string;
  automationRunId?: string;
}): StoredDesktopSession {
  return {
    ...input.archive,
    loopEnabled: input.loopEnabled,
    approvalLevel: input.approvalLevel,
    savedAtUnixMs: input.savedAtUnixMs ?? Date.now(),
    sessionDisplayName: input.sessionDisplayName,
    ...(input.sessionTitleSource ? { sessionTitleSource: input.sessionTitleSource } : {}),
    workspaceRoot: input.workspaceRoot,
    ...(input.gitBranch ? { gitBranch: input.gitBranch } : {}),
    ...(input.automationId ? { automationId: input.automationId } : {}),
    ...(input.automationRunId ? { automationRunId: input.automationRunId } : {}),
    ...(input.activePlanPath ? { activePlanPath: input.activePlanPath } : {}),
    desktopMessages: sanitizeConversationMessagesForPersistence(input.desktopMessages),
    ...(input.desktopMessageTimeline
      ? { desktopMessageTimeline: cloneDesktopMessageTimeline(input.desktopMessageTimeline) }
      : {}),
    rewind: input.rewind,
    ...(input.contextUsage ? { contextUsage: { ...input.contextUsage } } : {}),
    ...(input.subagentDesktopMessages ? { subagentDesktopMessages: input.subagentDesktopMessages } : {}),
    ...(input.queuedUserTurns?.length
      ? { queuedUserTurns: cloneQueuedUserTurns(input.queuedUserTurns) }
      : {}),
  };
}

export function cloneQueuedUserTurns(queued: readonly QueuedUserTurn[]): QueuedUserTurn[] {
  return queued.map((item) => ({
    ...item,
    ...(item.explicitWorkspaceFiles
      ? { explicitWorkspaceFiles: item.explicitWorkspaceFiles.map((file) => ({ ...file })) }
      : {}),
    ...(item.localFileAttachments
      ? { localFileAttachments: item.localFileAttachments.map((attachment) => ({ ...attachment })) }
      : {}),
  }));
}

export function sanitizeConversationMessagesForPersistence(
  messages: ConversationMessageSnapshot[],
): ConversationMessageSnapshot[] {
  return messages.flatMap((message) => {
    const tool = normalizeToolBlockSnapshot(message.tool);
    const aux = normalizeMessageAuxSnapshot(message.aux);
    const normalized: ConversationMessageSnapshot = {
      ...message,
      ...(tool ? { tool } : {}),
      ...(aux ? { aux } : {}),
    };
    if (
      shouldDropEmptyAssistantMessage(normalized, tool, aux) ||
      shouldHideEmptyPendingAssistantSnapshot(normalized)
    ) {
      return [];
    }
    const { canRewind: _canRewind, ...persisted } = normalized;
    return [persisted];
  });
}

/** 当磁盘 llmHistory 为空但 desktop 消息已有往返时，供 runtime 恢复的最小 llm 历史。 */
export function buildLlmHistoryFallbackFromDesktopMessages(
  messages: ConversationMessageSnapshot[],
): ChatArchive['llmHistory'] {
  return archiveProjectableConversationMessages(messages)
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role,
      content: message.content,
      imagePaths: [],
    }));
}

export function buildArchiveMessagesFromConversation(
  messages: ConversationMessageSnapshot[],
): ChatArchive['messages'] {
  return archiveProjectableConversationMessages(messages).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export function buildArchiveAssistantAuxFromConversation(
  messages: ConversationMessageSnapshot[],
): ChatArchive['assistantAux'] {
  return archiveProjectableConversationMessages(messages).flatMap((message, index) => {
    if (!message.aux) {
      return [];
    }
    return [{
      messageIndex: index,
      ...(message.aux.thinking ? { thinking: message.aux.thinking } : {}),
      ...(message.aux.compaction ? { compaction: message.aux.compaction } : {}),
      ...(message.aux.finishTaskNotice ? { finishTaskNotice: message.aux.finishTaskNotice } : {}),
    }];
  });
}

export function nextMessageIdFromMessages(messages: ConversationMessageSnapshot[]): number {
  return Math.max(0, ...messages.map((message) => message.id)) + 1;
}

export function deriveDisplayNameFromSeed(seed: string): string {
  const trimmed = seed.trim();
  if (!trimmed) {
    return 'New conversation';
  }
  return trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed;
}

export function deriveDisplayNameFromMessages(messages: ConversationMessageSnapshot[]): string {
  const firstUser = messages.find(
    (message) => message.role === 'user' && message.content.trim().length > 0,
  );
  return deriveDisplayNameFromSeed(firstUser?.content ?? 'New conversation');
}

function cloneConversationMessages(
  messages: ConversationMessageSnapshot[],
): ConversationMessageSnapshot[] {
  return messages.map((message) => ({ ...message }));
}

function tryCloneDesktopMessageTimeline(
  timeline: DesktopTimelineTurnSnapshot[] | undefined,
): DesktopTimelineTurnSnapshot[] | undefined {
  if (!timeline) {
    return undefined;
  }
  try {
    return cloneDesktopMessageTimeline(timeline);
  } catch {
    return undefined;
  }
}

function cloneDesktopMessageTimeline(
  timeline: DesktopTimelineTurnSnapshot[],
): DesktopTimelineTurnSnapshot[] {
  return timeline.map((turn) => ({
    ...turn,
    ...(turn.userRow
      ? {
          userRow: {
            ...turn.userRow,
            ...(turn.userRow.localFileAttachments?.length
              ? {
                  localFileAttachments: turn.userRow.localFileAttachments.map((attachment) => ({
                    ...attachment,
                  })),
                }
              : {}),
            ...(turn.userRow.tool
              ? {
                  tool: {
                    ...turn.userRow.tool,
                    detailLines: [...turn.userRow.tool.detailLines],
                    ...(turn.userRow.tool.imagePaths
                      ? { imagePaths: [...turn.userRow.tool.imagePaths] }
                      : {}),
                    ...(turn.userRow.tool.videoPaths
                      ? { videoPaths: [...turn.userRow.tool.videoPaths] }
                      : {}),
                  },
                }
              : {}),
            ...(turn.userRow.aux ? { aux: { ...turn.userRow.aux } } : {}),
          },
        }
      : {}),
    segments: turn.segments.map((segment) => ({
      ...segment,
      rows: segment.rows.map((row) => ({
        ...row,
        ...(row.localFileAttachments?.length
          ? {
              localFileAttachments: row.localFileAttachments.map((attachment) => ({
                ...attachment,
              })),
            }
          : {}),
        ...(row.tool
          ? {
              tool: {
                ...row.tool,
                detailLines: [...row.tool.detailLines],
                ...(row.tool.imagePaths ? { imagePaths: [...row.tool.imagePaths] } : {}),
                ...(row.tool.videoPaths ? { videoPaths: [...row.tool.videoPaths] } : {}),
              },
            }
          : {}),
        ...(row.aux ? { aux: { ...row.aux } } : {}),
      })),
    })),
  }));
}

function archiveProjectableConversationMessages(
  messages: ConversationMessageSnapshot[],
): ConversationMessageSnapshot[] {
  return sanitizeConversationMessagesForPersistence(messages).filter(
    (message) => !message.tool || message.content.trim().length > 0,
  );
}

function cloneSubagentSessions(
  sessions: NonNullable<ChatArchive['subagentSessions']>,
): NonNullable<ChatArchive['subagentSessions']> {
  return cloneArchiveSubagentSessions(sessions);
}

type SessionListActivity = Pick<SessionListItem, 'isBusy' | 'isBlocked'>;

/** Map in-memory bundle runtime to session list activity flags. */
export function sessionListActivityFromBundle(bundle?: SessionBundle): SessionListActivity {
  if (!isSessionBundleBusy(bundle)) {
    return {};
  }
  const runtime = bundle?.runtime;
  if (runtime?.hasPendingApproval() || runtime?.hasPendingQuestions()) {
    return { isBusy: true, isBlocked: true };
  }
  return { isBusy: true };
}
