import path from 'node:path';

import type { ChatArchive } from '@spirit-agent/agent-core';

import type {
  ActiveSessionSnapshot,
  ConversationMessageSnapshot,
  SessionListItem,
} from '../types.js';
import type { StoredDesktopSession } from './contracts.js';
import {
  normalizeMessageAuxSnapshot,
  normalizeToolBlockSnapshot,
  shouldDropEmptyAssistantMessage,
  shouldHideEmptyPendingAssistantSnapshot,
} from './message-ordering.js';
import { createDesktopRewindMetadata, type StoredDesktopRewindMetadata } from './rewind.js';

export const EPHEMERAL_COMMIT_SESSION_PREFIX = 'ephemeral://commit-message/';
const MAX_EPHEMERAL_COMMIT_SESSIONS = 8;

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
  activeSession: ActiveSessionSnapshot;
  archiveHistory: ChatArchive['llmHistory'];
  archiveSubagentSessions: NonNullable<ChatArchive['subagentSessions']>;
  rewind: StoredDesktopRewindMetadata;
}

export function isEphemeralCommitSessionPath(filePath: string): boolean {
  return filePath.startsWith(EPHEMERAL_COMMIT_SESSION_PREFIX);
}

export function createEphemeralCommitSessionPath(now = Date.now()): string {
  return `${EPHEMERAL_COMMIT_SESSION_PREFIX}${now}`;
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
  return {
    messages,
    activeSession: {
      filePath: path.resolve(input.filePath),
      displayName: input.loaded.sessionDisplayName ?? deriveDisplayNameFromMessages(messages),
      kind: 'stored',
    },
    archiveHistory: cloneArchiveHistory(input.loaded.llmHistory),
    archiveSubagentSessions: cloneSubagentSessions(input.loaded.subagentSessions ?? []),
    rewind: input.loaded.rewind ?? createDesktopRewindMetadata(),
  };
}

export function buildStoredDesktopSession(input: {
  archive: ChatArchive;
  savedAtUnixMs?: number;
  sessionDisplayName: string;
  workspaceRoot: string;
  gitBranch?: string;
  desktopMessages: ConversationMessageSnapshot[];
  rewind: StoredDesktopRewindMetadata;
}): StoredDesktopSession {
  return {
    ...input.archive,
    savedAtUnixMs: input.savedAtUnixMs ?? Date.now(),
    sessionDisplayName: input.sessionDisplayName,
    workspaceRoot: input.workspaceRoot,
    ...(input.gitBranch ? { gitBranch: input.gitBranch } : {}),
    desktopMessages: sanitizeConversationMessagesForPersistence(input.desktopMessages),
    rewind: input.rewind,
  };
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

function archiveProjectableConversationMessages(
  messages: ConversationMessageSnapshot[],
): ConversationMessageSnapshot[] {
  return sanitizeConversationMessagesForPersistence(messages).filter(
    (message) => !message.tool || message.content.trim().length > 0,
  );
}

function cloneArchiveHistory(history: ChatArchive['llmHistory']): ChatArchive['llmHistory'] {
  return history.map((message) => ({
    role: message.role,
    content: message.content,
    imagePaths: [...message.imagePaths],
  }));
}

function cloneSubagentSessions(
  sessions: NonNullable<ChatArchive['subagentSessions']>,
): NonNullable<ChatArchive['subagentSessions']> {
  return sessions.map((entry) => ({
    summary: { ...entry.summary },
    llmHistory: cloneArchiveHistory(entry.llmHistory),
  }));
}