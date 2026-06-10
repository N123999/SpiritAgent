import type { JsonValue, RuntimeEvent } from '@spirit-agent/core';
import type * as schema from '@agentclientprotocol/sdk';
import { mapToolNameToKind, buildToolCallTitle, extractToolCallLocations } from './tool-call-mapper.js';

/**
 * Maps a RuntimeEvent to an ACP session/update notification payload.
 * Returns undefined for events that should not be forwarded (e.g. approval-requested).
 */
export function mapRuntimeEventToUpdate(
  event: RuntimeEvent<JsonValue>,
  sessionId: string,
): schema.SessionNotification | undefined {
  switch (event.kind) {
    case 'assistant-chunk':
      return {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: event.text,
          },
        },
      } as schema.SessionNotification;

    case 'update-pending-assistant-thinking':
      return {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: event.text,
          },
        },
      } as schema.SessionNotification;

    case 'streaming-tool-preview': {
      const kind = mapToolNameToKind(event.toolName);
      const title = buildToolCallTitle(event.toolName, event.argumentsJson);
      const locations = extractToolCallLocations(event.argumentsJson);
      return {
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: event.toolCallId,
          title,
          kind,
          status: 'pending',
          ...(locations.length > 0 ? { locations } : {}),
        },
      } as schema.SessionNotification;
    }

    case 'tool-call-started':
      return {
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: event.toolCallId,
          status: 'in_progress',
        },
      } as schema.SessionNotification;

    case 'tool-execution-finished': {
      const ex = event.execution;
      const content = formatToolExecutionOutput(ex.output);
      return {
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: ex.toolCallId,
          status: ex.failed ? 'failed' : 'completed',
          ...(content !== undefined ? { content } : {}),
        },
      } as schema.SessionNotification;
    }

    case 'context-usage-updated':
      return {
        sessionId,
        update: {
          sessionUpdate: 'usage_update',
          used: event.usage.totalTokens ?? 0,
          size: event.usage.totalTokens ?? 0,
        },
      } as schema.SessionNotification;

    case 'replace-pending-assistant':
      return {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: event.text,
          },
        },
      } as schema.SessionNotification;

    case 'background-tool-status':
      return {
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: `bg_${event.toolName}`,
          status: event.phase === 'finished' ? (event.failed ? 'failed' : 'completed') : 'in_progress',
          ...(event.statusText ? { content: [{ type: 'content', content: { type: 'text', text: event.statusText } }] } : {}),
        },
      } as schema.SessionNotification;

    // Events handled elsewhere or ignored
    case 'approval-requested':
    case 'questions-requested':
    case 'begin-assistant-response':
    case 'assistant-response-completed':
    case 'remove-pending-assistant':
    case 'assistant-thinking-segment-finalized':
    case 'update-pending-assistant-compaction':
    case 'approval-resolved':
    case 'history-compacted':
      return undefined;
  }
}

/**
 * Formats tool execution output into ACP ToolCallContent array.
 */
function formatToolExecutionOutput(
  output: string | import('@spirit-agent/core').ToolExecutionOutput,
): schema.ToolCallContent[] | undefined {
  if (typeof output === 'string') {
    if (output.length === 0) return undefined;
    return [{ type: 'content', content: { type: 'text', text: truncateOutput(output) } }];
  }

  // ToolExecutionOutput with content parts
  if (typeof output === 'object' && output !== null && 'content' in output) {
    const execOutput = output as { content?: Array<{ type: string; text?: string }> };
    if (!execOutput.content || execOutput.content.length === 0) return undefined;

    return execOutput.content
      .filter((part) => part.type === 'text' && part.text)
      .map((part) => ({
        type: 'content' as const,
        content: { type: 'text' as const, text: truncateOutput(part.text ?? '') },
      }));
  }

  return undefined;
}

/**
 * Truncates long tool output to prevent excessive ACP messages.
 */
function truncateOutput(text: string, maxLen = 4000): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n… [truncated ${text.length - maxLen} chars]`;
}
