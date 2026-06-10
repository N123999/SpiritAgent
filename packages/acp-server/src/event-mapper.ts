import type { JsonValue, RuntimeEvent } from '@spirit-agent/core';
import type * as schema from '@agentclientprotocol/sdk';
import { mapToolNameToKind, buildToolCallTitle, extractToolCallLocations } from './tool-call-mapper.js';

/**
 * Per-session state for tracking streaming deltas.
 *
 * The `update-pending-assistant-thinking` event carries the full accumulated
 * thinking text (not a delta). We must compute the delta ourselves to avoid
 * the ACP client concatenating full-text chunks into garbled output.
 */
export interface EventMapperState {
  /** Length of thinking text already sent to the client */
  sentThinkingLength: number;
}

/**
 * Creates a fresh per-session mapper state.
 */
export function createEventMapperState(): EventMapperState {
  return { sentThinkingLength: 0 };
}

/**
 * Maps a RuntimeEvent to an ACP session/update notification payload.
 * Returns undefined for events that should not be forwarded (e.g. approval-requested).
 *
 * @param state - Mutable per-session state used to compute streaming deltas.
 */
export function mapRuntimeEventToUpdate(
  event: RuntimeEvent<JsonValue>,
  sessionId: string,
  state: EventMapperState,
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

    case 'update-pending-assistant-thinking': {
      // event.text is the full accumulated thinking text, not a delta.
      // Extract only the new portion since last emission.
      const fullText = event.text;
      const delta = fullText.slice(state.sentThinkingLength);
      state.sentThinkingLength = fullText.length;
      if (delta.length === 0) return undefined;
      return {
        sessionId,
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: {
            type: 'text',
            text: delta,
          },
        },
      } as schema.SessionNotification;
    }

    case 'assistant-thinking-segment-finalized':
      // A thinking segment ended — reset the sent length tracker
      // so the next thinking segment starts fresh.
      state.sentThinkingLength = 0;
      return undefined;

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
