import type { LlmMessageContent, LlmToolCall, StoredLlmMessageArchiveEntry } from '@spirit-agent/core';
import { llmMessageTextContent } from '@spirit-agent/core';

export type SubagentViewerSessionStatus = 'running' | 'completed' | 'failed' | 'blocked';

export type SubagentViewerToolPhase =
  | 'preview'
  | 'pending-approval'
  | 'running'
  | 'succeeded'
  | 'failed';

export interface SubagentViewerToolBlock {
  toolCallId?: string;
  toolName: string;
  phase: SubagentViewerToolPhase;
  headline: string;
  headlineDetail?: string;
  detailLines: string[];
  argsExcerpt?: string;
  outputExcerpt?: string;
}

export interface SubagentViewerMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  tool?: SubagentViewerToolBlock;
  aux?: { thinking?: string };
  pending: boolean;
}

export type SubagentLlmHistoryEntry = StoredLlmMessageArchiveEntry | {
  role: string;
  content: unknown;
  toolCallId?: string;
  toolCalls?: LlmToolCall[];
};

export interface BuildSubagentConversationSnapshotsOptions {
  sessionStatus: SubagentViewerSessionStatus;
  enrichToolBlock?: (input: {
    toolName: string;
    phase: SubagentViewerToolPhase;
    request: unknown;
    tool: SubagentViewerToolBlock;
  }) => SubagentViewerToolBlock;
}

function historyText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return llmMessageTextContent(content);
  }
  return '';
}

function truncateExcerpt(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars)}…`;
}

function inferToolPhase(
  sessionStatus: SubagentViewerSessionStatus,
  hasOutput: boolean,
  isLastUnresolvedTool: boolean,
): SubagentViewerToolPhase {
  if (hasOutput) {
    return sessionStatus === 'failed' ? 'failed' : 'succeeded';
  }
  if (sessionStatus === 'failed') {
    return 'failed';
  }
  if (sessionStatus === 'blocked' && isLastUnresolvedTool) {
    return 'pending-approval';
  }
  if (sessionStatus === 'running' || sessionStatus === 'blocked') {
    return 'running';
  }
  return 'succeeded';
}

function parseToolRequest(argumentsJson: string): unknown {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

export function buildSubagentConversationSnapshots(
  llmHistory: ReadonlyArray<SubagentLlmHistoryEntry>,
  options: BuildSubagentConversationSnapshotsOptions,
): SubagentViewerMessage[] {
  const toolOutputs = new Map<string, string>();
  for (const entry of llmHistory) {
    if (entry.role !== 'tool') {
      continue;
    }
    const toolCallId = entry.toolCallId?.trim();
    if (!toolCallId) {
      continue;
    }
    toolOutputs.set(toolCallId, historyText(entry.content));
  }

  const unresolvedToolCallIds = new Set<string>();
  for (const entry of llmHistory) {
    if (entry.role !== 'assistant') {
      continue;
    }
    for (const toolCall of entry.toolCalls ?? []) {
      const id = toolCall.id?.trim();
      if (!id) {
        continue;
      }
      if (!toolOutputs.get(id)?.trim()) {
        unresolvedToolCallIds.add(id);
      }
    }
  }

  let lastUnresolvedToolCallId: string | undefined;
  for (let index = llmHistory.length - 1; index >= 0; index -= 1) {
    const entry = llmHistory[index];
    if (entry?.role !== 'assistant') {
      continue;
    }
    const toolCalls = entry.toolCalls ?? [];
    for (let toolIndex = toolCalls.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const id = toolCalls[toolIndex]?.id?.trim();
      if (id && unresolvedToolCallIds.has(id)) {
        lastUnresolvedToolCallId = id;
        break;
      }
    }
    if (lastUnresolvedToolCallId) {
      break;
    }
  }

  const messages: SubagentViewerMessage[] = [];
  let nextId = 1;

  for (const entry of llmHistory) {
    if (entry.role === 'tool') {
      continue;
    }

    if (entry.role === 'user') {
      const content = historyText(entry.content).trim();
      if (!content) {
        continue;
      }
      messages.push({
        id: nextId,
        role: 'user',
        content,
        pending: false,
      });
      nextId += 1;
      continue;
    }

    if (entry.role !== 'assistant') {
      continue;
    }

    const toolCalls = entry.toolCalls ?? [];
    const text = historyText(entry.content).trim();

    if (toolCalls.length > 0) {
      if (text) {
        messages.push({
          id: nextId,
          role: 'assistant',
          content: text,
          pending: false,
        });
        nextId += 1;
      }

      for (const toolCall of toolCalls) {
        const toolCallId = toolCall.id?.trim();
        const output = toolCallId ? toolOutputs.get(toolCallId) : undefined;
        const hasOutput = Boolean(output?.trim());
        const isLastUnresolvedTool = Boolean(
          toolCallId && toolCallId === lastUnresolvedToolCallId,
        );
        const phase = inferToolPhase(options.sessionStatus, hasOutput, isLastUnresolvedTool);
        const request = parseToolRequest(toolCall.argumentsJson);
        let tool: SubagentViewerToolBlock = {
          toolCallId,
          toolName: toolCall.name,
          phase,
          headline: toolCall.name,
          detailLines: [],
          argsExcerpt: truncateExcerpt(toolCall.argumentsJson, 500),
          ...(output ? { outputExcerpt: truncateExcerpt(output, 4_000) } : {}),
        };
        if (options.enrichToolBlock) {
          tool = options.enrichToolBlock({
            toolName: toolCall.name,
            phase,
            request,
            tool,
          });
        }
        messages.push({
          id: nextId,
          role: 'assistant',
          content: '',
          tool,
          pending: phase === 'running' || phase === 'preview' || phase === 'pending-approval',
        });
        nextId += 1;
      }
      continue;
    }

    if (text) {
      messages.push({
        id: nextId,
        role: 'assistant',
        content: text,
        pending: false,
      });
      nextId += 1;
    }
  }

  return messages;
}

export function resolveSubagentPromptFromTaskFields(input: {
  task?: string;
  contextSummary?: string;
  title?: string;
}): string {
  const task = input.task?.trim();
  if (task) {
    return task;
  }
  const contextSummary = input.contextSummary?.trim();
  if (contextSummary) {
    return contextSummary;
  }
  return input.title?.trim() ?? '';
}
