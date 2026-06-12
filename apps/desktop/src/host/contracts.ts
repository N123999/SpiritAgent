import type { ChatArchive } from '@spirit-agent/core';
import type { HostToolRequest, ApprovalLevel } from '@spirit-agent/host-internal';
import type { DesktopTimelineTurnSnapshot } from './message-timeline.js';
import type { StoredDesktopRewindMetadata } from './rewind.js';

import type {
  CommitChangesRequest,
  AskQuestionsQuestionSpec,
  ConversationContextUsageSnapshot,
  ConversationMessageSnapshot,
} from '../types.js';

export type HostCommandName =
  | 'bootstrap'
  | 'rememberWorkspaceRoot'
  | 'forgetWorkspace'
  | 'commitChanges'
  | 'updateConfig'
  | 'installLspProvider'
  | 'setWebHostAuthTokenHash'
  | 'addModel'
  | 'addProviderModels'
  | 'previewModels'
  | 'removeModel'
  | 'removeProviderModels'
  | 'addMcpServer'
  | 'deleteMcpServer'
  | 'saveHookEntry'
  | 'deleteHookEntry'
  | 'inspectMcpServer'
  | 'importExtension'
  | 'listMarketplaceExtensions'
  | 'getMarketplaceExtensionDetail'
  | 'getMarketplaceExtensionReadme'
  | 'prepareMarketplaceExtensionInstall'
  | 'installMarketplaceExtension'
  | 'deleteExtension'
  | 'runExtension'
  | 'updateExtensionSettings'
  | 'updateExtensionSecret'
  | 'createRule'
  | 'createSkill'
  | 'deleteRule'
  | 'deleteSkill'
  | 'submitSkillSlash'
  | 'submitGitChip'
  | 'submitStartImplementing'
  | 'exportSessionLog'
  | 'compactHistory'
  | 'submitUserTurn'
  | 'setLoopEnabled'
  | 'setApprovalLevel'
  | 'setPendingGitBranch'
  | 'setWorkLocation'
  | 'checkoutGitBranch'
  | 'mergeWorktreeToMain'
  | 'pushGitBranch'
  | 'refreshGitSnapshot'
  | 'readGitWorkingTree'
  | 'readGitHistory'
  | 'getGitHubAuthStatus'
  | 'beginGitHubDeviceLogin'
  | 'completeGitHubDeviceLogin'
  | 'cancelGitHubDeviceLogin'
  | 'disconnectGitHub'
  | 'getGitHubPullRequestForCurrentBranch'
  | 'getGitHubPullRequestDetail'
  | 'getGitHubPullRequestConversation'
  | 'abortConversation'
  | 'abortShellCommand'
  | 'continueAssistantCompletion'
  | 'poll'
  | 'listDreamsOverview'
  | 'listAutomations'
  | 'getAutomation'
  | 'createAutomation'
  | 'updateAutomation'
  | 'deleteAutomation'
  | 'setAutomationEnabled'
  | 'replyPendingApproval'
  | 'replyPendingQuestions'
  | 'resetSession'
  | 'listSessions'
  | 'openSession'
  | 'deleteSession'
  | 'listWorkspaceFileReferenceSuggestions'
  | 'primeWorkspaceFileReferenceIndex'
  | 'getWorkspaceFileReferenceIndex'
  | 'listWorkspaceExplorerChildren'
  | 'readWorkspaceTextFile'
  | 'writeWorkspaceTextFile'
  | 'readHostTextFile'
  | 'writeHostTextFile'
  | 'statHostTextFile'
  | 'rewindAndSubmitMessage'
  | 'forkSession'
  | 'reorderQueuedUserTurn'
  | 'sendQueuedUserTurnNow'
  | 'removeQueuedUserTurn'
  | 'setSubagentViewerTarget';

/** 与 `apps/cli/src/tool_runtime.rs` 中 `ToolRequest` 对齐的宿主工具请求。 */
export type DesktopToolRequest = HostToolRequest<AskQuestionsQuestionSpec>;

export type SessionTitleSource = 'seed' | 'llm';

export interface StoredDesktopSession extends ChatArchive {
  savedAtUnixMs: number;
  sessionDisplayName?: string;
  sessionTitleSource?: SessionTitleSource;
  workspaceRoot?: string;
  gitBranch?: string;
  activePlanPath?: string;
  desktopMessages?: ConversationMessageSnapshot[];
  desktopMessageTimeline?: DesktopTimelineTurnSnapshot[];
  rewind?: StoredDesktopRewindMetadata;
  approvalLevel?: ApprovalLevel;
  contextUsage?: ConversationContextUsageSnapshot;
  subagentDesktopMessages?: Record<string, ConversationMessageSnapshot[]>;
  queuedUserTurns?: import('./message-queue.js').QueuedUserTurn[];
  automationId?: string;
  automationRunId?: string;
}

export type DesktopHostCommitRequest = CommitChangesRequest;
