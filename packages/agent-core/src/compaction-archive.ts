import {
  cloneLlmMessageContent,
  type LlmMessage,
  type LlmMessageContent,
  type LlmToolCall,
} from './ports.js';

export const PRE_COMPACTION_HISTORY_EXPORT_VERSION = 1;

export interface PreCompactionHistoryArchiveMessage {
  role: 'user' | 'assistant';
  content: LlmMessageContent;
  toolCalls?: LlmToolCall[];
}

export interface PreCompactionHistoryArchive {
  export_version: typeof PRE_COMPACTION_HISTORY_EXPORT_VERSION;
  kind: 'pre_compaction_history';
  exported_at_unix_ms: number;
  message_count: number;
  messages: PreCompactionHistoryArchiveMessage[];
}

export function buildPreCompactionHistoryArchive(
  history: readonly LlmMessage[],
  exportedAtUnixMs: number = Date.now(),
): PreCompactionHistoryArchive {
  const messages = history.flatMap((message): PreCompactionHistoryArchiveMessage[] => {
    if (message.role !== 'user' && message.role !== 'assistant') {
      return [];
    }

    const entry: PreCompactionHistoryArchiveMessage = {
      role: message.role,
      content: cloneLlmMessageContent(message.content),
    };

    if (message.role === 'assistant' && message.toolCalls !== undefined && message.toolCalls.length > 0) {
      entry.toolCalls = message.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        argumentsJson: toolCall.argumentsJson,
      }));
    }

    return [entry];
  });

  return {
    export_version: PRE_COMPACTION_HISTORY_EXPORT_VERSION,
    kind: 'pre_compaction_history',
    exported_at_unix_ms: exportedAtUnixMs,
    message_count: messages.length,
    messages,
  };
}
