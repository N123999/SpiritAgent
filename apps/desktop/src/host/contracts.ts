import type { ChatArchive } from '@spirit-agent/agent-core';

import type {
  AskQuestionsQuestionSpec,
  ConversationMessageSnapshot,
} from '../types.js';

export type HostCommandName =
  | 'bootstrap'
  | 'updateConfig'
  | 'submitUserTurn'
  | 'poll'
  | 'replyPendingApproval'
  | 'replyPendingQuestions'
  | 'resetSession'
  | 'listSessions'
  | 'openSession';

export type DesktopToolRequest =
  | { name: 'list_dir'; path: string }
  | {
      name: 'read_file';
      filePath: string;
      startLine?: number;
      endLine?: number;
    }
  | {
      name: 'grep_search';
      query: string;
      isRegexp?: boolean;
      includePattern?: string;
      maxResults?: number;
    }
  | {
      name: 'run_in_terminal';
      command: string;
      explanation?: string;
      goal?: string;
      timeoutMs?: number;
    }
  | { name: 'create_directory'; dirPath: string }
  | { name: 'create_file'; filePath: string; content: string }
  | { name: 'write_file'; filePath: string; content: string }
  | { name: 'delete_path'; path: string }
  | { name: 'fetch_webpage'; url: string; query?: string }
  | {
      name: 'ask_questions';
      title?: string;
      questions: AskQuestionsQuestionSpec[];
    };

export interface StoredDesktopSession extends ChatArchive {
  savedAtUnixMs: number;
  sessionDisplayName?: string;
  desktopMessages?: ConversationMessageSnapshot[];
}