import type {
  ChatArchive,
  LlmActiveSkill,
  RuntimeEvent,
  SpiritLlmTransport,
} from '@spirit-agent/agent-core';
import type { DesktopToolRequest, SessionTitleSource } from './contracts.js';
import type { ApprovalLevel, WorkLocationKind } from '@spirit-agent/host-internal';

import type { DesktopRuntime } from './runtime.js';
import type { DesktopToolExecutor } from './tool-executor.js';

import type {
  ActiveSessionSnapshot,
  ConversationMessageSnapshot,
  FileRewindWarning,
} from '../types.js';
import type { DesktopTimelineSegmentKind, DesktopMessageTimeline } from './message-timeline.js';
import { createDesktopRewindMetadata, type StoredDesktopRewindMetadata } from './rewind.js';
import { createTodoSessionScopeKey } from './todos.js';
import { rehydrateFinishTaskNoticesForRestoredSession } from './finish-task-notice-rehydrate.js';
import { nextMessageIdFromMessages, type RestoredSessionState } from './sessions.js';
import { DesktopMessageTimeline as TimelineCtor } from './message-timeline.js';

export interface SessionBundle {
  /** Stable id: `activeSession.filePath` or synthetic until first persist. */
  id: string;
  workspaceRoot: string;
  activeSession?: ActiveSessionSnapshot;
  messages: ConversationMessageSnapshot[];
  messageTimeline: DesktopMessageTimeline;
  archiveHistory: ChatArchive['llmHistory'];
  archiveSubagentSessions: NonNullable<ChatArchive['subagentSessions']>;
  loopEnabled: boolean;
  approvalLevel: ApprovalLevel;
  pendingGitBranch?: string;
  workLocation: WorkLocationKind;
  rewind: StoredDesktopRewindMetadata;
  rewindWarnings: FileRewindWarning[];
  messageIdCounter: number;
  currentTurnSkills: LlmActiveSkill[];
  pendingUnboundFileChangeIds: string[];
  nextTimelineAssistantSegmentKind: DesktopTimelineSegmentKind;
  deferredRuntimeRefreshWhileBusy: boolean;
  deferredRuntimeHostEvents: RuntimeEvent<DesktopToolRequest>[];
  /** Provider builtin preview callIds applied in a prior drain (for deferring terminal previews). */
  responsesBuiltInPreviewSeenCallIds: Set<string>;
  lastPersistedAtUnixMs?: number;
  /** `savedAtUnixMs` from disk; used to avoid bumping list order on background/switch persist. */
  listSortSavedAtUnixMs?: number;
  runtime?: DesktopRuntime;
  /** Fingerprint of host config used when `runtime` was last built for this bundle. */
  runtimeActivationSignature?: string;
  runtimeTransport?: SpiritLlmTransport;
  toolExecutor?: DesktopToolExecutor;
  toolExecutorWorkspaceRoot?: string;
  toolExecutorTodoSessionKey?: string;
  /** Isolated TODO storage key until the session is saved to a real chat file. */
  todoSessionScopeKey?: string;
  cachedTodoSnapshot?: import('../types.js').ConversationTodoSnapshot;
  /** Bumped on rewind restore; exposed as `conversation.revision` in snapshots. */
  conversationRevision: number;
  /** Last successful create_plan absolute path for this session. */
  activePlanPath?: string;
  /** Tracks whether the sidebar title is seed-truncated or LLM-generated. */
  sessionTitleSource?: SessionTitleSource;
}

export function createEmptySessionBundle(workspaceRoot: string, id = '__draft__'): SessionBundle {
  const messages: ConversationMessageSnapshot[] = [];
  return {
    id,
    workspaceRoot,
    messages,
    messageTimeline: TimelineCtor.fromMessages(messages, {
      allocateMessageId: () => 1,
      reserveMessageId: () => {},
    }),
    archiveHistory: [],
    archiveSubagentSessions: [],
    loopEnabled: false,
    approvalLevel: 'default',
    workLocation: 'local',
    rewind: createDesktopRewindMetadata(),
    rewindWarnings: [],
    messageIdCounter: 1,
    currentTurnSkills: [],
    pendingUnboundFileChangeIds: [],
    nextTimelineAssistantSegmentKind: 'initial',
    deferredRuntimeRefreshWhileBusy: false,
    deferredRuntimeHostEvents: [],
    responsesBuiltInPreviewSeenCallIds: new Set(),
    todoSessionScopeKey: createTodoSessionScopeKey(),
    conversationRevision: 0,
  };
}

export function sessionBundleFromRestored(
  workspaceRoot: string,
  restored: RestoredSessionState,
  createTimeline: (
    messages: ConversationMessageSnapshot[],
    timelineSnapshot?: import('./message-timeline.js').DesktopTimelineTurnSnapshot[],
  ) => DesktopMessageTimeline,
): SessionBundle {
  const id = restored.activeSession.filePath;
  const messageTimeline = createTimeline(
    restored.messages,
    restored.desktopMessageTimeline,
  );
  const messages = rehydrateFinishTaskNoticesForRestoredSession({
    messages: restored.messages,
    messageTimeline,
    archiveHistory: restored.archiveHistory,
  });
  return {
    id,
    workspaceRoot,
    activeSession: restored.activeSession,
    messages,
    messageTimeline,
    archiveHistory: restored.archiveHistory,
    archiveSubagentSessions: restored.archiveSubagentSessions,
    loopEnabled: restored.loopEnabled,
    approvalLevel: restored.approvalLevel,
    workLocation: 'local',
    rewind: restored.rewind,
    rewindWarnings: [],
    messageIdCounter: nextMessageIdFromMessages(restored.messages),
    currentTurnSkills: [],
    pendingUnboundFileChangeIds: [],
    nextTimelineAssistantSegmentKind: 'initial',
    deferredRuntimeRefreshWhileBusy: false,
    deferredRuntimeHostEvents: [],
    responsesBuiltInPreviewSeenCallIds: new Set(),
    conversationRevision: 0,
    ...(restored.activePlanPath ? { activePlanPath: restored.activePlanPath } : {}),
    ...(restored.sessionTitleSource ? { sessionTitleSource: restored.sessionTitleSource } : {}),
  };
}

export function resetSessionBundleInPlace(bundle: SessionBundle): void {
  bundle.activeSession = undefined;
  bundle.messages = [];
  bundle.messageTimeline = TimelineCtor.fromMessages([], {
    allocateMessageId: () => 1,
    reserveMessageId: () => {},
  });
  bundle.archiveHistory = [];
  bundle.archiveSubagentSessions = [];
  bundle.loopEnabled = false;
  bundle.approvalLevel = 'default';
  bundle.pendingGitBranch = undefined;
  bundle.workLocation = 'local';
  bundle.rewind = createDesktopRewindMetadata();
  bundle.rewindWarnings = [];
  bundle.messageIdCounter = 1;
  bundle.currentTurnSkills = [];
  bundle.pendingUnboundFileChangeIds = [];
  bundle.nextTimelineAssistantSegmentKind = 'initial';
  bundle.deferredRuntimeRefreshWhileBusy = false;
  bundle.deferredRuntimeHostEvents = [];
  bundle.responsesBuiltInPreviewSeenCallIds = new Set();
  bundle.cachedTodoSnapshot = undefined;
  bundle.todoSessionScopeKey = createTodoSessionScopeKey();
  bundle.conversationRevision = 0;
  bundle.activePlanPath = undefined;
  bundle.sessionTitleSource = undefined;
}
