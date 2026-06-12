import path from 'node:path';

import i18n from '../lib/i18n-host.js';
import type { ForkSessionRequest } from '../types.js';
import type { DesktopSnapshot } from '../types.js';
import type { DesktopRuntime } from './runtime.js';
import type { SessionBundle } from './session-bundle.js';
import type { SessionActivationContext } from './session-activation.js';
import { finishSessionActivationCommand } from './session-activation.js';
import {
  buildArchiveAssistantAuxFromConversation,
  buildArchiveMessagesFromConversation,
  nextMessageIdFromMessages,
  sanitizeConversationMessagesForPersistence,
} from './sessions.js';
import { createDesktopRewindMetadata } from './rewind.js';
import { cloneHostTodoRecords, listSessionTodos, replaceSessionTodos } from './todos.js';
import { defaultNewSessionPath } from './storage.js';
import {
  buildTruncatedChatArchiveForFork,
  deriveForkedSessionDisplayName,
  resolveForkAnchorIndex,
  truncateMessagesThroughIndex,
} from './fork-session.js';
import { cloneArchiveHistory, cloneArchiveSubagentSessions } from './service-utils.js';

export interface ForkSessionHostContext extends SessionActivationContext {
  requireRuntime(): DesktopRuntime;
  isConversationBusy(): boolean;
  isActiveSessionReadOnly(): boolean;
  notifySessionListUpdated?(): void;
}

function applyForkStateToBundle(
  forkBundle: SessionBundle,
  input: {
    workspaceRoot: string;
    filePath: string;
    displayName: string;
    truncatedMessages: ReturnType<typeof truncateMessagesThroughIndex>;
    archive: ReturnType<typeof buildTruncatedChatArchiveForFork>;
    sourceBundle: SessionBundle;
  },
  ctx: ForkSessionHostContext,
): void {
  const timeline = ctx.createMessageTimelineFromMessages(input.truncatedMessages);
  forkBundle.workspaceRoot = input.workspaceRoot;
  forkBundle.activeSession = {
    filePath: path.resolve(input.filePath),
    displayName: input.displayName,
    kind: 'stored',
  };
  forkBundle.messages = input.truncatedMessages.map((message) => ({ ...message }));
  forkBundle.messageTimeline = timeline;
  forkBundle.archiveHistory = cloneArchiveHistory(input.archive.llmHistory);
  forkBundle.archiveSubagentSessions = cloneArchiveSubagentSessions(
    input.archive.subagentSessions ?? [],
  );
  forkBundle.loopEnabled = input.sourceBundle.loopEnabled;
  forkBundle.approvalLevel = input.sourceBundle.approvalLevel;
  forkBundle.workLocation = input.sourceBundle.workLocation;
  forkBundle.rewind = createDesktopRewindMetadata();
  forkBundle.rewindWarnings = [];
  forkBundle.messageIdCounter = nextMessageIdFromMessages(input.truncatedMessages);
  forkBundle.currentTurnSkills = [];
  forkBundle.pendingUnboundFileChangeIds = [];
  forkBundle.deferredRuntimeRefreshWhileBusy = false;
  forkBundle.deferredRuntimeHostEvents = [];
  forkBundle.responsesBuiltInPreviewSeenCallIds = new Set();
  forkBundle.queuedUserTurns = [];
  forkBundle.conversationRevision = 0;
  forkBundle.contextUsage = undefined;
  forkBundle.sessionTitleSource = 'seed';
  forkBundle.subagentDesktopMessagesBySessionId = new Map();
  forkBundle.subagentConversationProjections = new Map();
  forkBundle.runtime = undefined;
  forkBundle.runtimeActivationSignature = undefined;
  forkBundle.runtimeTransport = undefined;
  forkBundle.toolExecutor = undefined;
  if (input.sourceBundle.activePlanPath) {
    forkBundle.activePlanPath = input.sourceBundle.activePlanPath;
  }
}

export async function forkSessionCommand(
  ctx: ForkSessionHostContext,
  request: ForkSessionRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    ctx.clearSubagentViewerTarget();

    if (ctx.isActiveSessionReadOnly()) {
      throw new Error(i18n.t('error.forkReadOnlySession'));
    }
    if (ctx.isConversationBusy()) {
      throw new Error(i18n.t('error.runtimeBusy'));
    }
    if (!Number.isFinite(request.messageId)) {
      throw new Error(i18n.t('error.invalidMessageId'));
    }

    const state = ctx.requireState();
    const sourceBundle = ctx.sessionRegistry().getActive();
    if (!sourceBundle?.activeSession) {
      throw new Error(i18n.t('error.hostNotInitialized'));
    }

    const sourceMessages = sourceBundle.messageTimeline.toMessages();
    const anchorIndex = resolveForkAnchorIndex(
      sourceMessages,
      request.messageId,
      request.listIndex,
    );
    if (anchorIndex === null) {
      throw new Error(i18n.t('error.forkInvalidAnchor'));
    }

    const truncatedMessages = truncateMessagesThroughIndex(sourceMessages, anchorIndex);
    if (truncatedMessages.length === 0) {
      throw new Error(i18n.t('error.forkInvalidAnchor'));
    }

    const sourceMessageCount = sourceMessages.length;
    if (sourceBundle.activeSession && sourceMessageCount > 0) {
      await ctx.runSessionEndForBundle?.(sourceBundle, 'switch');
      await ctx.persistSessionBundle(sourceBundle, {
        fromRuntime: ctx.sessionRegistry().activeSessionId() === sourceBundle.id
          ? ctx.currentRuntime()
          : undefined,
        bumpListSortAt: false,
      });
    }

    const runtime = ctx.requireRuntime();
    const sourceArchive = runtime.toArchive(
      buildArchiveMessagesFromConversation(sourceMessages),
      buildArchiveAssistantAuxFromConversation(sourceMessages),
    );
    sourceArchive.loopEnabled = sourceBundle.loopEnabled;
    const archive = buildTruncatedChatArchiveForFork(sourceArchive, sourceMessages, anchorIndex);

    const forkDisplayName = deriveForkedSessionDisplayName(sourceBundle.activeSession.displayName);
    const sessionPath = defaultNewSessionPath();
    const forkBundle = ctx.sessionRegistry().activateProvisional(state.workspaceRoot, sessionPath);

    applyForkStateToBundle(
      forkBundle,
      {
        workspaceRoot: state.workspaceRoot,
        filePath: sessionPath,
        displayName: forkDisplayName,
        truncatedMessages: sanitizeConversationMessagesForPersistence(truncatedMessages).map(
          (message) => ({ ...message }),
        ),
        archive,
        sourceBundle,
      },
      ctx,
    );

    await ctx.finalizeTodoScopeForNewActiveBundle(forkBundle, state.workspaceRoot);
    const sourceTodoKey = ctx.resolveTodoSessionKeyForBundle(sourceBundle);
    const forkTodoKey = ctx.resolveTodoSessionKeyForBundle(forkBundle);
    const sourceTodos = cloneHostTodoRecords(await listSessionTodos(sourceTodoKey));
    await replaceSessionTodos(forkTodoKey, sourceTodos);

    ctx.sessionRegistry().activateExisting(forkBundle);
    await finishSessionActivationCommand(ctx, forkBundle, { sessionStartSource: 'open' });
    await ctx.persistSessionBundle(forkBundle, {
      fromRuntime: forkBundle.runtime,
      bumpListSortAt: true,
    });

    ctx.notifySessionListUpdated?.();
    ctx.setLastRuntimeError('');
    ctx.scheduleSessionExtensionWarmup({
      type: 'onSessionOpened',
      detail: {
        filePath: path.resolve(forkBundle.activeSession!.filePath),
        displayName: forkDisplayName,
      },
    });
    return ctx.buildSnapshot();
  });
}
