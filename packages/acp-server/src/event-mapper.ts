import type { JsonValue, RuntimeEvent } from '@spirit-agent/core';
import type * as schema from '@agentclientprotocol/sdk';

/**
 * Maps a RuntimeEvent to an ACP session/update notification payload.
 * Returns undefined for events that should not be forwarded (e.g. approval-requested).
 *
 * Stub: to be fully implemented in Phase 4.
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

    case 'streaming-tool-preview':
      return {
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: event.toolCallId,
          title: `${event.toolName}`,
          kind: 'other',
          status: 'pending',
        },
      } as schema.SessionNotification;

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
      return {
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: ex.toolCallId,
          status: ex.failed ? 'failed' : 'completed',
          content: typeof ex.output === 'string'
            ? [{ type: 'content', content: { type: 'text', text: ex.output } }]
            : undefined,
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

    // Events handled elsewhere or ignored
    case 'approval-requested':
    case 'questions-requested':
    case 'begin-assistant-response':
    case 'assistant-response-completed':
    case 'remove-pending-assistant':
    case 'replace-pending-assistant':
    case 'assistant-thinking-segment-finalized':
    case 'update-pending-assistant-compaction':
    case 'approval-resolved':
    case 'background-tool-status':
    case 'history-compacted':
      return undefined;
  }
}
