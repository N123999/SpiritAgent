import type { ChatArchive } from '@spirit-agent/core';
import type { HostToolRequest, ApprovalLevel } from '@spirit-agent/host-internal';
import type { PersistedDesktopTimelineTurnSnapshot } from './chat-schema.js';
import type { StoredDesktopRewindMetadata } from './rewind.js';

import type {
  CommitChangesRequest,
  AskQuestionsQuestionSpec,
  ConversationContextUsageSnapshot,
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
  | 'readGitCommitMessage'
  | 'getGitHubAuthStatus'
  | 'beginGitHubDeviceLogin'
  | 'completeGitHubDeviceLogin'
  | 'cancelGitHubDeviceLogin'
  | 'disconnectGitHub'
  | 'getGitHubPullRequestForCurrentBranch'
  | 'listGitHubPullRequests'
  | 'listGitHubAutomationRepositories'
  | 'searchGitHubAutomationRepositories'
  | 'getGitHubPullRequestTabCounts'
  | 'getGitHubPullRequestDetail'
  | 'getGitHubPullRequestConversation'
  | 'getGitHubPullRequestFiles'
  | 'getGitHubPullRequestCommits'
  | 'getGitHubPullRequestChecks'
  | 'mergeGitHubPullRequest'
  | 'markGitHubPullRequestReady'
  | 'abortConversation'
  | 'abortShell'
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
  | 'requestCodeCompletion'
  | 'abortCodeCompletion'
  | 'recordCodeCompletionFileState'
  | 'resetCodeCompletionJournal'
  | 'primeWorkspaceFileReferenceIndex'
  | 'getWorkspaceFileReferenceIndex'
  | 'listWorkspaceExplorerChildren'
  | 'readWorkspaceTextFile'
  | 'searchWorkspaceContent'
  | 'writeWorkspaceTextFile'
  | 'revealWorkspaceEntry'
  | 'renameWorkspaceEntry'
  | 'createWorkspaceEntry'
  | 'moveWorkspaceEntry'
  | 'trashWorkspaceEntry'
  | 'forceDeleteWorkspaceEntry'
  | 'readHostTextFile'
  | 'writeHostTextFile'
  | 'statHostTextFile'
  | 'classifyLocalFileComposerRoute'
  | 'rewindAndSubmitMessage'
  | 'forkSession'
  | 'reorderQueuedUserTurn'
  | 'sendQueuedUserTurnNow'
  | 'removeQueuedUserTurn'
  | 'setSubagentViewerTarget';

/** 与 `apps/cli/src/tool_runtime.rs` 中 `ToolRequest` 对齐的宿主工具请求。 */
export type DesktopToolRequest = HostToolRequest<AskQuestionsQuestionSpec>;

export type SessionTitleSource = 'seed' | 'llm';

export interface StoredDesktopSession {
  chatSchemaVersion: 2;
  llmHistory: ChatArchive['llmHistory'];
  subagentSessions?: ChatArchive['subagentSessions'];
  loopEnabled?: boolean;
  approvalLevel?: ApprovalLevel;
  desktopMessageTimeline: PersistedDesktopTimelineTurnSnapshot[];
  savedAtUnixMs: number;
  sessionDisplayName?: string;
  sessionTitleSource?: SessionTitleSource;
  workspaceRoot?: string;
  gitBranch?: string;
  activePlanPath?: string;
  rewind?: StoredDesktopRewindMetadata;
  contextUsage?: ConversationContextUsageSnapshot;
  subagentDesktopTimelines?: Record<string, PersistedDesktopTimelineTurnSnapshot[]>;
  queuedUserTurns?: import('./message-queue.js').QueuedUserTurn[];
  automationId?: string;
  automationRunId?: string;
}

export type DesktopHostCommitRequest = CommitChangesRequest;
