import path from 'node:path';

import type { ChatArchive } from '@spirit-agent/agent-core';

import {
  buildArchiveAssistantAuxFromConversation,
  buildArchiveMessagesFromConversation,
  buildStoredDesktopSession,
  sanitizeConversationMessagesForPersistence,
} from './sessions.js';
import type { SessionBundle } from './session-bundle.js';
import type { DesktopRuntime } from './runtime.js';
import { saveStoredSession } from './storage.js';

export interface PersistDesktopSessionBundleInput {
  bundle: SessionBundle;
  workspaceRoot: string;
  gitBranch?: string;
  fromRuntime?: DesktopRuntime;
  bumpListSortAt?: boolean;
}

export interface PersistDesktopSessionBundleResult {
  previousId?: string;
  nextId?: string;
  rekeyNeeded: boolean;
}

export async function persistDesktopSessionBundle(
  input: PersistDesktopSessionBundleInput,
): Promise<PersistDesktopSessionBundleResult> {
  const { bundle } = input;
  const activeSession = bundle.activeSession;
  if (!activeSession || activeSession.kind === 'ephemeral') {
    return { rekeyNeeded: false };
  }

  const desktopMessages = bundle.messageTimeline.toMessages();
  if (desktopMessages.length === 0) {
    return { rekeyNeeded: false };
  }
  const archiveMessages = buildArchiveMessagesFromConversation(desktopMessages);
  const archiveAssistantAux = buildArchiveAssistantAuxFromConversation(desktopMessages);
  const archive = input.fromRuntime
    ? input.fromRuntime.toArchive(archiveMessages, archiveAssistantAux)
    : {
        messages: archiveMessages,
        assistantAux: archiveAssistantAux,
        llmHistory: bundle.archiveHistory,
        subagentSessions: bundle.archiveSubagentSessions ?? [],
        loopEnabled: bundle.loopEnabled,
      } satisfies ChatArchive;

  bundle.archiveHistory = archive.llmHistory;
  bundle.archiveSubagentSessions = archive.subagentSessions ?? [];
  bundle.loopEnabled = archive.loopEnabled === true;

  const bumpListSortAt = input.bumpListSortAt === true;
  const savedAtUnixMs = bumpListSortAt
    ? Date.now()
    : (bundle.listSortSavedAtUnixMs ?? Date.now());
  const stored = buildStoredDesktopSession({
    archive,
    savedAtUnixMs,
    sessionDisplayName: activeSession.displayName,
    workspaceRoot: input.workspaceRoot,
    gitBranch: input.gitBranch,
    ...(bundle.activePlanPath ? { activePlanPath: bundle.activePlanPath } : {}),
    desktopMessages: sanitizeConversationMessagesForPersistence(desktopMessages),
    desktopMessageTimeline: bundle.messageTimeline.snapshot(),
    rewind: bundle.rewind,
    loopEnabled: bundle.loopEnabled,
    approvalLevel: bundle.approvalLevel,
  });
  if (bumpListSortAt) {
    bundle.listSortSavedAtUnixMs = savedAtUnixMs;
  }
  const previousId = bundle.id;
  activeSession.filePath = await saveStoredSession(activeSession.filePath, stored);
  bundle.lastPersistedAtUnixMs = Date.now();
  return {
    previousId,
    nextId: activeSession.filePath,
    rekeyNeeded: path.resolve(previousId) !== path.resolve(activeSession.filePath),
  };
}
