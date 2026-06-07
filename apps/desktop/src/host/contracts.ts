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
  | 'createSkill'
  | 'deleteSkill'
  | 'submitCreateSkillSlash'
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
  | 'abortConversation'
  | 'continueAssistantCompletion'
  | 'poll'
  | 'listDreamsOverview'
  | 'replyPendingApproval'
  | 'replyPendingQuestions'
  | 'resetSession'
  | 'listSessions'
  | 'openSession'
  | 'deleteSession'
  | 'listWorkspaceFileReferenceSuggestions'
  | 'listWorkspaceExplorerChildren'
  | 'readWorkspaceTextFile'
  | 'writeWorkspaceTextFile'
  | 'rewindAndSubmitMessage'
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
}

export type DesktopHostCommitRequest = CommitChangesRequest;
