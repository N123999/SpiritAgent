import {
  cloneLlmMessageContent,
  cloneLlmProviderState,
  createLlmMessageContentFromText,
  llmMessageTextContent,
  type LlmMessage,
} from './ports.js';
import {
  buildContextRetryExcerpt,
  cloneJsonValue,
  isJsonObject,
  type ToolAgentState,
} from './tool-agent.js';

export type PersistToolOutputArchiveInput = {
  sessionId?: string;
  toolCallId?: string;
  content: string;
  messageIndex?: number;
};

export type PersistToolOutputArchiveFn = (
  input: PersistToolOutputArchiveInput,
) => Promise<string | undefined>;

export type PrepareToolOutputTruncationOptions = {
  sessionId?: string;
  persistArchive?: PersistToolOutputArchiveFn;
};

async function truncateToolMessageContent(
  content: string,
  options: PrepareToolOutputTruncationOptions & {
    toolCallId?: string;
    messageIndex?: number;
  },
): Promise<string | undefined> {
  let archivePath: string | undefined;
  if (options.persistArchive) {
    try {
      archivePath = await options.persistArchive({
        content,
        ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
        ...(options.toolCallId !== undefined ? { toolCallId: options.toolCallId } : {}),
        ...(options.messageIndex !== undefined ? { messageIndex: options.messageIndex } : {}),
      });
    } catch {
      // Best-effort archive persist; truncation still proceeds without a path hint.
    }
  }

  return buildContextRetryExcerpt(content, archivePath);
}

export async function prepareToolOutputForAppend(input: {
  content: string;
  sessionId?: string;
  toolCallId?: string;
  persistArchive?: PersistToolOutputArchiveFn;
}): Promise<string> {
  const replacement = await truncateToolMessageContent(input.content, {
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.toolCallId !== undefined ? { toolCallId: input.toolCallId } : {}),
    ...(input.persistArchive !== undefined ? { persistArchive: input.persistArchive } : {}),
  });
  return replacement ?? input.content;
}

function readToolCallIdFromToolAgentMessage(message: Record<string, unknown>): string | undefined {
  if (typeof message.tool_call_id === 'string' && message.tool_call_id.length > 0) {
    return message.tool_call_id;
  }
  if (typeof message.toolCallId === 'string' && message.toolCallId.length > 0) {
    return message.toolCallId;
  }
  return undefined;
}

export async function prepareToolOutputTruncationForHistory(
  history: LlmMessage[],
  options: PrepareToolOutputTruncationOptions = {},
): Promise<{ history: LlmMessage[]; changed: boolean }> {
  let changed = false;
  const nextHistory = await Promise.all(
    history.map(async (message, messageIndex) => {
      const contentText = llmMessageTextContent(message.content);
      if (message.role !== 'tool') {
        return {
          role: message.role,
          content: cloneLlmMessageContent(message.content),
          ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
          ...(message.toolCalls !== undefined
            ? {
                toolCalls: message.toolCalls.map((toolCall) => ({
                  id: toolCall.id,
                  name: toolCall.name,
                  argumentsJson: toolCall.argumentsJson,
                })),
              }
            : {}),
          ...(message.providerState !== undefined
            ? { providerState: cloneLlmProviderState(message.providerState) }
            : {}),
        };
      }

      const replacement = await truncateToolMessageContent(contentText, {
        ...options,
        ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
        messageIndex,
      });
      if (replacement === undefined) {
        return {
          role: message.role,
          content: cloneLlmMessageContent(message.content),
          ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
          ...(message.toolCalls !== undefined
            ? {
                toolCalls: message.toolCalls.map((toolCall) => ({
                  id: toolCall.id,
                  name: toolCall.name,
                  argumentsJson: toolCall.argumentsJson,
                })),
              }
            : {}),
        };
      }

      changed = true;
      return {
        role: message.role,
        content: createLlmMessageContentFromText(replacement),
        ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
        ...(message.toolCalls !== undefined
          ? {
              toolCalls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                name: toolCall.name,
                argumentsJson: toolCall.argumentsJson,
              })),
            }
          : {}),
        ...(message.providerState !== undefined
          ? { providerState: cloneLlmProviderState(message.providerState) }
          : {}),
      };
    }),
  );

  return {
    history: nextHistory,
    changed,
  };
}

export async function prepareToolOutputTruncationForToolAgentState(
  state: ToolAgentState,
  options: PrepareToolOutputTruncationOptions = {},
): Promise<{ state: ToolAgentState; changed: boolean }> {
  let changed = false;
  const messages = await Promise.all(
    state.messages.map(async (message, messageIndex) => {
      if (!isJsonObject(message) || typeof message.content !== 'string' || message.role !== 'tool') {
        return cloneJsonValue(message);
      }

      const toolCallId = readToolCallIdFromToolAgentMessage(message);
      const replacement = await truncateToolMessageContent(message.content, {
        ...options,
        ...(toolCallId !== undefined ? { toolCallId } : {}),
        messageIndex,
      });
      if (replacement === undefined) {
        return { ...message };
      }

      changed = true;
      return {
        ...message,
        content: replacement,
      };
    }),
  );

  return {
    state: {
      messages,
      steps: state.steps,
    },
    changed,
  };
}
