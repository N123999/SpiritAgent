import type { LlmMessageContent, LlmToolCall, StoredLlmMessageArchiveEntry } from '@spirit-agent/core';
import { llmMessageTextContent } from '@spirit-agent/core';

export type SubagentViewerSessionStatus = 'bootstrapping' | 'running' | 'completed' | 'failed' | 'blocked';

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
  if (sessionStatus === 'running' || sessionStatus === 'blocked' || sessionStatus === 'bootstrapping') {
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

function extractAssistantReasoningFromHistoryEntry(entry: SubagentLlmHistoryEntry): string {
  if (entry.role !== 'assistant') {
    return '';
  }

  const providerState =
    'providerState' in entry &&
    entry.providerState &&
    typeof entry.providerState === 'object' &&
    !Array.isArray(entry.providerState)
      ? (entry.providerState as Record<string, unknown>)
      : undefined;
  if (providerState) {
    for (const key of ['reasoning_content', 'reasoningContent', 'reasoning', 'thinking'] as const) {
      const value = providerState[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  }

  if (Array.isArray(entry.content)) {
    const reasoningParts: string[] = [];
    for (const part of entry.content) {
      if (!part || typeof part !== 'object') {
        continue;
      }
      const record = part as Record<string, unknown>;
      if (record.type === 'reasoning' && typeof record.text === 'string' && record.text.trim()) {
        reasoningParts.push(record.text.trim());
      }
    }
    if (reasoningParts.length > 0) {
      return reasoningParts.join('\n\n');
    }
  }

  return '';
}

function pushAssistantThinkingMessage(
  messages: SubagentViewerMessage[],
  nextIdRef: { value: number },
  thinking: string,
): void {
  const trimmed = thinking.trim();
  if (!trimmed) {
    return;
  }
  messages.push({
    id: nextIdRef.value,
    role: 'assistant',
    content: '',
    aux: { thinking: trimmed },
    pending: false,
  });
  nextIdRef.value += 1;
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
  const nextIdRef = { value: 1 };

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
        id: nextIdRef.value,
        role: 'user',
        content,
        pending: false,
      });
      nextIdRef.value += 1;
      continue;
    }

    if (entry.role !== 'assistant') {
      continue;
    }

    const toolCalls = entry.toolCalls ?? [];
    const text = historyText(entry.content).trim();
    const reasoning = extractAssistantReasoningFromHistoryEntry(entry);

    if (toolCalls.length > 0) {
      if (reasoning && reasoning !== text) {
        pushAssistantThinkingMessage(messages, nextIdRef, reasoning);
      }
      if (text) {
        messages.push({
          id: nextIdRef.value,
          role: 'assistant',
          content: text,
          pending: false,
        });
        nextIdRef.value += 1;
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
          id: nextIdRef.value,
          role: 'assistant',
          content: '',
          tool,
          pending: phase === 'running' || phase === 'preview' || phase === 'pending-approval',
        });
        nextIdRef.value += 1;
      }
      continue;
    }

    if (text) {
      if (reasoning && reasoning !== text) {
        pushAssistantThinkingMessage(messages, nextIdRef, reasoning);
      }
      messages.push({
        id: nextIdRef.value,
        role: 'assistant',
        content: text,
        pending: false,
      });
      nextIdRef.value += 1;
    } else if (reasoning) {
      pushAssistantThinkingMessage(messages, nextIdRef, reasoning);
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
