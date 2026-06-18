import { isSubagentStatusSurfaceText } from '../lib/subagent-display.js';
import type { ConversationMessageSnapshot, ToolBlockSnapshot } from '../types.js';

/** Minimal shape of persisted subagent session rows (host-only; no agent-core import). */
export interface SubagentSessionArchiveSnapshot {
  summary: {
    parentToolCallId?: string;
    status: 'bootstrapping' | 'running' | 'completed' | 'failed' | 'blocked';
    latestMessage?: string;
    finalOutput?: string;
  };
  llmHistory: ReadonlyArray<{
    role: string;
    content: unknown;
  }>;
}

function archiveHistoryMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!content || typeof content !== 'object') {
    return '';
  }
  const record = content as Record<string, unknown>;
  if (typeof record.text === 'string') {
    return record.text;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (part && typeof part === 'object') {
        const text = (part as { text?: unknown }).text;
        if (typeof text === 'string') {
          parts.push(text);
        }
      }
    }
    return parts.join('');
  }
  return '';
}

export function extractSubagentSessionStreamingText(
  session: SubagentSessionArchiveSnapshot,
): string | undefined {
  for (let index = session.llmHistory.length - 1; index >= 0; index -= 1) {
    const message = session.llmHistory[index];
    if (message?.role !== 'assistant') {
      continue;
    }
    const text = archiveHistoryMessageText(message.content).trim();
    if (text && !isSubagentStatusSurfaceText(text)) {
      return text;
    }
  }

  const latest = session.summary.latestMessage?.trim();
  if (latest && !isSubagentStatusSurfaceText(latest)) {
    return latest;
  }

  const finalOutput = session.summary.finalOutput?.trim();
  if (finalOutput && !isSubagentStatusSurfaceText(finalOutput)) {
    return finalOutput;
  }

  return undefined;
}

export function findRunSubagentToolPhase(
  messages: ReadonlyArray<ConversationMessageSnapshot>,
  toolCallId: string,
): ToolBlockSnapshot['phase'] | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.tool?.toolCallId === toolCallId) {
      return message.tool.phase;
    }
  }
  return undefined;
}

export function isRunSubagentToolCallPending(
  messages: ReadonlyArray<ConversationMessageSnapshot>,
  toolCallId: string,
): boolean {
  const phase = findRunSubagentToolPhase(messages, toolCallId);
  return phase === 'preview' || phase === 'running' || phase === 'pending-approval';
}
