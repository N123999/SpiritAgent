import type { ChatArchive } from '@spirit-agent/agent-core';
import type { HostToolRequest, ApprovalLevel } from '@spirit-agent/host-internal';
import type { DesktopTimelineTurnSnapshot } from './message-timeline.js';
import type { StoredDesktopRewindMetadata } from './rewind.js';

import type {
  CommitChangesRequest,
  AskQuestionsQuestionSpec,
  ConversationMessageSnapshot,
} from '../types.js';

export type HostCommandName =
  | 'bootstrap'
  | 'rememberWorkspaceRoot'
  | 'commitChanges'
  | 'updateConfig'
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
  | 'listWorkspaceFileReferenceSuggestions'
  | 'listWorkspaceExplorerChildren'
  | 'readWorkspaceTextFile'
  | 'writeWorkspaceTextFile'
  | 'rewindAndSubmitMessage';

/** 与 `apps/cli/src/tool_runtime.rs` 中 `ToolRequest` 对齐的宿主工具请求。 */
export type DesktopToolRequest = HostToolRequest<AskQuestionsQuestionSpec>;

export interface StoredDesktopSession extends ChatArchive {
  savedAtUnixMs: number;
  sessionDisplayName?: string;
  workspaceRoot?: string;
  gitBranch?: string;
  activePlanPath?: string;
  desktopMessages?: ConversationMessageSnapshot[];
  desktopMessageTimeline?: DesktopTimelineTurnSnapshot[];
  rewind?: StoredDesktopRewindMetadata;
  approvalLevel?: ApprovalLevel;
}

export type DesktopHostCommitRequest = CommitChangesRequest;
