import type { ChatArchive } from '@spirit-agent/agent-core';

import type {
  AskQuestionsQuestionSpec,
  ConversationMessageSnapshot,
} from '../types.js';

export type HostCommandName =
  | 'bootstrap'
  | 'updateConfig'
  | 'addModel'
  | 'removeModel'
  | 'submitUserTurn'
  | 'poll'
  | 'replyPendingApproval'
  | 'replyPendingQuestions'
  | 'resetSession'
  | 'listSessions'
  | 'openSession';

/** 与 `apps/cli/src/tool_runtime.rs` 中 `ToolRequest` 对齐的宿主工具请求。 */
export type DesktopToolRequest =
  | { name: 'run_shell_command'; command: string }
  | { name: 'web_fetch'; url: string }
  | { name: 'list_directory_files'; path: string }
  | {
      name: 'read_file';
      path: string;
      start_line?: number;
      end_line?: number;
    }
  | { name: 'search_files'; query: string }
  | {
      name: 'run_subagent';
      task: string;
      success_criteria?: string;
      context_summary?: string;
      files_to_inspect: string[];
      expected_output?: string;
    }
  | {
      name: 'ask_questions';
      title?: string;
      questions: AskQuestionsQuestionSpec[];
    }
  | { name: 'create_file'; path: string; content: string }
  | { name: 'edit_file'; path: string; old_text: string; new_text: string }
  | { name: 'delete_file'; path: string };

export interface StoredDesktopSession extends ChatArchive {
  savedAtUnixMs: number;
  sessionDisplayName?: string;
  desktopMessages?: ConversationMessageSnapshot[];
}
