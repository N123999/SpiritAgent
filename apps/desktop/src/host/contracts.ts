import type { ChatArchive } from '@spirit-agent/agent-core';
import type { HostToolRequest } from '@spirit-agent/host-internal';
import type { StoredDesktopRewindMetadata } from './rewind.js';

import type {
  AskQuestionsQuestionSpec,
  ConversationMessageSnapshot,
} from '../types.js';

export type HostCommandName =
  | 'bootstrap'
  | 'updateConfig'
  | 'addModel'
  | 'removeModel'
  | 'createSkill'
  | 'deleteSkill'
  | 'submitUserTurn'
  | 'poll'
  | 'replyPendingApproval'
  | 'replyPendingQuestions'
  | 'resetSession'
  | 'listSessions'
  | 'openSession'
  | 'rewindAndSubmitMessage';

/** 与 `apps/cli/src/tool_runtime.rs` 中 `ToolRequest` 对齐的宿主工具请求。 */
export type DesktopToolRequest = HostToolRequest<AskQuestionsQuestionSpec>;

export interface StoredDesktopSession extends ChatArchive {
  savedAtUnixMs: number;
  sessionDisplayName?: string;
  desktopMessages?: ConversationMessageSnapshot[];
  rewind?: StoredDesktopRewindMetadata;
}
