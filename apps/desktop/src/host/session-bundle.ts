import type { ChatArchive, LlmActiveSkill, SpiritLlmTransport } from '@spirit-agent/agent-core';
import type { ApprovalLevel } from '@spirit-agent/host-internal';

import type { DesktopRuntime } from './runtime.js';
import type { DesktopToolExecutor } from './tool-executor.js';

import type {
  ActiveSessionSnapshot,
  ConversationMessageSnapshot,
  FileRewindWarning,
} from '../types.js';
import type { DesktopTimelineSegmentKind, DesktopMessageTimeline } from './message-timeline.js';
import { createDesktopRewindMetadata, type StoredDesktopRewindMetadata } from './rewind.js';
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
  rewind: StoredDesktopRewindMetadata;
  rewindWarnings: FileRewindWarning[];
  messageIdCounter: number;
  currentTurnSkills: LlmActiveSkill[];
  pendingUnboundFileChangeIds: string[];
  nextTimelineAssistantSegmentKind: DesktopTimelineSegmentKind;
  deferredRuntimeRefreshWhileBusy: boolean;
  lastPersistedAtUnixMs?: number;
  /** `savedAtUnixMs` from disk; used to avoid bumping list order on background/switch persist. */
  listSortSavedAtUnixMs?: number;
  runtime?: DesktopRuntime;
  runtimeTransport?: SpiritLlmTransport;
  toolExecutor?: DesktopToolExecutor;
  toolExecutorWorkspaceRoot?: string;
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
    rewind: createDesktopRewindMetadata(),
    rewindWarnings: [],
    messageIdCounter: 1,
    currentTurnSkills: [],
    pendingUnboundFileChangeIds: [],
    nextTimelineAssistantSegmentKind: 'initial',
    deferredRuntimeRefreshWhileBusy: false,
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
  return {
    id,
    workspaceRoot,
    activeSession: restored.activeSession,
    messages: restored.messages,
    messageTimeline,
    archiveHistory: restored.archiveHistory,
    archiveSubagentSessions: restored.archiveSubagentSessions,
    loopEnabled: restored.loopEnabled,
    approvalLevel: restored.approvalLevel,
    rewind: restored.rewind,
    rewindWarnings: [],
    messageIdCounter: nextMessageIdFromMessages(restored.messages),
    currentTurnSkills: [],
    pendingUnboundFileChangeIds: [],
    nextTimelineAssistantSegmentKind: 'initial',
    deferredRuntimeRefreshWhileBusy: false,
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
  bundle.rewind = createDesktopRewindMetadata();
  bundle.rewindWarnings = [];
  bundle.messageIdCounter = 1;
  bundle.currentTurnSkills = [];
  bundle.pendingUnboundFileChangeIds = [];
  bundle.nextTimelineAssistantSegmentKind = 'initial';
  bundle.deferredRuntimeRefreshWhileBusy = false;
}
