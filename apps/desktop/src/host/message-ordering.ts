import type {
  LlmMessageContent,
  RuntimePendingApproval,
  RuntimePendingQuestions,
} from '@spirit-agent/agent-core';
import { llmMessageTextContent } from '@spirit-agent/agent-core';

import type {
  ConversationMessageSnapshot,
  MessageAuxSnapshot,
  PendingAssistantAux,
  ToolBlockSnapshot,
} from '../types.js';
import type { DesktopToolRequest, StoredDesktopSession } from './contracts.js';

/** 环境变量 `SPIRIT_DESKTOP_MESSAGE_ORDER_DEBUG`：不设为关；`1`/compact/on 紧凑；`2`/verbose 更详并节流纯 preview；`0`/off 显式关闭。 */
export type MessageOrderDebugLevel = 'off' | 'compact' | 'verbose';

export function messageOrderDebugLevel(): MessageOrderDebugLevel {
  const raw = process.env.SPIRIT_DESKTOP_MESSAGE_ORDER_DEBUG?.trim().toLowerCase() ?? '';
  if (raw === '') {
    return 'off';
  }
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on' || raw === 'compact') {
    return 'compact';
  }
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') {
    return 'off';
  }
  if (raw === '2' || raw === 'verbose' || raw === 'debug' || raw === 'all') {
    return 'verbose';
  }
  return 'off';
}

export function summarizeMessagesTailForOrderDebug(
  messages: ConversationMessageSnapshot[],
  max: number,
): string {
  if (messages.length === 0) {
    return '∅';
  }
  const slice = messages.slice(Math.max(0, messages.length - max));
  return slice.map(formatMessageOrderToken).join('«');
}

export function summarizeToolRowsForDebug(
  messages: ReadonlyArray<ConversationMessageSnapshot>,
  max = 8,
): string {
  const tools = messages.filter(
    (message) => message.role === 'assistant' && Boolean(message.tool),
  );
  if (tools.length === 0) {
    return '∅';
  }
  return tools.slice(Math.max(0, tools.length - max)).map(formatToolRowForDebug).join(',');
}

function formatMessageOrderToken(m: ConversationMessageSnapshot): string {
  if (m.role === 'user') {
    return 'U';
  }
  const toolName = m.tool?.toolName;
  if (toolName) {
    const phase = m.tool?.phase ?? '?';
    const p =
      phase === 'running' ? '~' : phase === 'succeeded' ? '=' : phase === 'failed' ? '!' : phase === 'pending-approval' ? '?' : '.';
    return `${p}${truncateOneLineForDebug(toolName, 20)}`;
  }
  if (m.aux?.thinking && !m.content.trim()) {
    return `H#${m.id}`;
  }
  if (m.aux?.compaction && !m.content.trim()) {
    return `C#${m.id}`;
  }
  const c = m.content.trim();
  if (!c) {
    return 'Aε';
  }
  const hasThinking = Boolean(m.aux?.thinking?.trim());
  const hasCompaction = Boolean(m.aux?.compaction?.trim());
  const prefix = hasThinking ? (hasCompaction ? 'aTC' : 'aT') : hasCompaction ? 'aC' : 'a';
  return `${prefix}#${m.id}:${truncateOneLineForDebug(c, 18)}`;
}

function formatToolRowForDebug(message: ConversationMessageSnapshot): string {
  const tool = message.tool;
  if (!tool) {
    return `${message.id}:∅`;
  }
  const toolCallId = tool.toolCallId?.trim() || `tool:${tool.toolName}`;
  const phase =
    tool.phase === 'running'
      ? '~'
      : tool.phase === 'succeeded'
        ? '='
        : tool.phase === 'failed'
          ? '!'
          : tool.phase === 'pending-approval'
            ? '?'
            : '.';
  return `${message.id}:${phase}${truncateOneLineForDebug(tool.toolName, 18)}:${truncateOneLineForDebug(toolCallId, 20)}`;
}

export function truncateOneLineForDebug(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max)}…`;
}

const SHELL_REASON_PREFIX = '理由:';

export function reasonForShellTool(toolName: string, request: unknown): string | undefined {
  if (toolName !== 'run_shell_command' || !request || typeof request !== 'object') {
    return undefined;
  }

  const reason = (request as { reason?: unknown }).reason;
  if (typeof reason !== 'string') {
    return undefined;
  }

  const trimmed = reason.trim();
  return trimmed || undefined;
}

export function displayTitleForTool(toolName: string, request: unknown): string {
  return reasonForShellTool(toolName, request) ?? toolName;
}

export function stripReasonLineFromShellPrompt(toolName: string, prompt: string): string {
  if (toolName !== 'run_shell_command') {
    return prompt;
  }

  const lines = prompt.split(/\r?\n/);
  if (!lines[0]?.trim().startsWith(SHELL_REASON_PREFIX)) {
    return prompt;
  }

  return lines.slice(1).join('\n').trim();
}

export function headlineForToolPhase(
  phase: ToolBlockSnapshot['phase'],
  toolName: string,
  request: unknown,
): string {
  const shellReason = reasonForShellTool(toolName, request);
  if (shellReason) {
    return shellReason;
  }

  return defaultToolHeadline(phase, toolName);
}

/** 自 history 尾部向前找**最后一条**非空 `assistant` 正文（OpenAI 路径下 `historyStore` 常无 `role: tool`，需用此作待审批时的兜底）。 */
export function lastAssistantPlainTextInHistory(
  hist: ReadonlyArray<{ role: string; content: string | LlmMessageContent }>,
): string | undefined {
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    const m = hist[i];
    const text = m ? historyMessageText(m.content).trim() : '';
    if (m?.role === 'assistant' && text) {
      return text;
    }
  }
  return undefined;
}

/**
 * 自「最后一条 user」起至首条 `tool` 前，取**第一个**非空 assistant 正文。
 * OpenAI 路径下 tool 结果通常不在 `history()` 的 LlmMessage 里，若仍用「最后一个」assistant
 * 会误取工具执行后的终稿，从而覆盖/错配流式阶段已显示的前缀（如「好的，我来查看…」）。
 */
export function assistantPrefixBeforeFirstToolInCurrentTurn(
  hist: ReadonlyArray<{ role: string; content: string | LlmMessageContent }>,
): string | undefined {
  let lastUserIdx = -1;
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    if (hist[i]?.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  let firstToolIdx = -1;
  for (let i = lastUserIdx + 1; i < hist.length; i += 1) {
    if (hist[i]?.role === 'tool') {
      firstToolIdx = i;
      break;
    }
  }

  const end = firstToolIdx >= 0 ? firstToolIdx : hist.length;
  for (let i = lastUserIdx + 1; i < end; i += 1) {
    const m = hist[i];
    if (!m) {
      continue;
    }
    const text = historyMessageText(m.content).trim();
    if (m.role === 'assistant' && text) {
      return text;
    }
  }

  return undefined;
}

export function latestUnsyncedAssistantTextInCurrentTurn(
  hist: ReadonlyArray<{ role: string; content: string | LlmMessageContent }>,
  messages: ReadonlyArray<ConversationMessageSnapshot>,
): string | undefined {
  const historyTexts = assistantPlainTextsInCurrentTurnHistory(hist);
  if (historyTexts.length === 0) {
    return undefined;
  }

  const existing = new Set(assistantPlainTextsInCurrentTurnMessages(messages));
  for (let i = historyTexts.length - 1; i >= 0; i -= 1) {
    const text = historyTexts[i]!;
    if (!existing.has(text)) {
      return text;
    }
  }

  return undefined;
}

function assistantPlainTextsInCurrentTurnHistory(
  hist: ReadonlyArray<{ role: string; content: string | LlmMessageContent }>,
): string[] {
  let lastUserIdx = -1;
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    if (hist[i]?.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  const texts: string[] = [];
  for (let i = lastUserIdx + 1; i < hist.length; i += 1) {
    const item = hist[i];
    if (!item || item.role !== 'assistant') {
      continue;
    }
    const text = historyMessageText(item.content).trim();
    if (text) {
      texts.push(text);
    }
  }
  return texts;
}

function historyMessageText(content: string | LlmMessageContent): string {
  return typeof content === 'string' ? content : llmMessageTextContent(content);
}

function assistantPlainTextsInCurrentTurnMessages(
  messages: ReadonlyArray<ConversationMessageSnapshot>,
): string[] {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  const texts: string[] = [];
  for (let i = lastUserIdx + 1; i < messages.length; i += 1) {
    const item = messages[i];
    if (!item || item.role !== 'assistant' || item.tool) {
      continue;
    }
    const text = item.content.trim();
    if (text) {
      texts.push(text);
    }
  }
  return texts;
}

export function stripPendingThinkingMatchingFinalized(
  aux: MessageAuxSnapshot | undefined,
  finalizedText: string,
): MessageAuxSnapshot | undefined {
  if (!aux?.thinking) {
    return aux;
  }
  if (aux.thinking.trim() !== finalizedText.trim()) {
    return aux;
  }
  const { thinking: _t, ...rest } = aux;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

export function stripThinkingFromAux(aux: MessageAuxSnapshot | undefined): MessageAuxSnapshot | undefined {
  if (!aux?.thinking) {
    return normalizeMessageAuxSnapshot(aux);
  }
  const { thinking: _thinking, ...rest } = aux;
  return normalizeMessageAuxSnapshot(rest);
}

export function isStandaloneThinkingMessage(
  message: ConversationMessageSnapshot | undefined,
): boolean {
  return Boolean(
    message?.role === 'assistant' &&
      !message.tool &&
      !message.content.trim() &&
      message.aux?.thinking?.trim(),
  );
}

export function rewindStandalonePendingAuxInsertIndexForThinking(
  messages: ReadonlyArray<ConversationMessageSnapshot>,
  anchorIndex: number,
): number {
  let index = anchorIndex;
  while (index > 0 && isStandaloneThinkingMessage(messages[index - 1])) {
    index -= 1;
  }
  return index;
}

export function parsePendingSubagentStatusText(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }

  const status = text
    .trim()
    .replace(/^[|/\\-]\s*/, '')
    .trim();

  if (!status || status === 'Thinking...' || status === 'Compressing...') {
    return undefined;
  }

  return status;
}

export function isStandaloneSubagentStatusAux(
  pendingAux: PendingAssistantAux | undefined,
): boolean {
  return Boolean(pendingAux && parsePendingSubagentStatusText(pendingAux.statusText));
}

export function shouldHidePendingAssistantThinkingForLiveStandaloneSubagentStatus(
  message: ConversationMessageSnapshot,
  livePendingAux: PendingAssistantAux | undefined,
): boolean {
  return Boolean(
    isStandaloneSubagentStatusAux(livePendingAux) &&
      message.role === 'assistant' &&
      message.pending &&
      !message.tool &&
      !message.content.trim(),
  );
}

export function shouldReanchorPersistedStandaloneSubagentStatusOnBeginAssistantResponse(
  lastMessage: ConversationMessageSnapshot | undefined,
  persistedStandalonePendingAux: PendingAssistantAux | undefined,
): boolean {
  return Boolean(
    lastMessage?.role === 'assistant' &&
      isStandaloneSubagentStatusAux(persistedStandalonePendingAux),
  );
}

export function messageIndexIsInCurrentTurn(
  messages: ReadonlyArray<ConversationMessageSnapshot>,
  index: number,
): boolean {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  return index > lastUserIdx;
}

export function hasStandaloneThinkingMessageInCurrentTurn(
  messages: ReadonlyArray<ConversationMessageSnapshot>,
): boolean {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  for (let i = lastUserIdx + 1; i < messages.length; i += 1) {
    const message = messages[i];
    if (
      message?.role === 'assistant' &&
      !message.tool &&
      !message.content.trim() &&
      Boolean(message.aux?.thinking?.trim())
    ) {
      return true;
    }
  }

  return false;
}

export function describeAuxForDebug(aux: MessageAuxSnapshot): string {
  const parts: string[] = [];
  if (aux.thinking?.trim()) {
    parts.push(`T≈${truncateOneLineForDebug(aux.thinking, 28)}`);
  }
  if (aux.compaction?.trim()) {
    parts.push(`C≈${truncateOneLineForDebug(aux.compaction, 28)}`);
  }
  return parts.join('+') || 'none';
}

export function describeOptionalAuxForDebug(aux: MessageAuxSnapshot | undefined): string {
  return aux ? describeAuxForDebug(aux) : 'none';
}

export function normalizeToolBlockSnapshot(
  tool: ToolBlockSnapshot | undefined,
): ToolBlockSnapshot | undefined {
  if (!tool) {
    return undefined;
  }

  const toolName = tool.toolName.trim() || 'unknown-tool';
  const headline = tool.headline.trim() || defaultToolHeadline(tool.phase, toolName);
  const detailLines = tool.detailLines.filter((line) => line.trim().length > 0);
  const argsExcerpt = tool.argsExcerpt?.trim() ? tool.argsExcerpt : undefined;
  const outputExcerpt = tool.outputExcerpt?.trim() ? tool.outputExcerpt : undefined;
  const imagePaths = tool.imagePaths?.map((entry) => entry.trim()).filter(Boolean);

  return {
    ...tool,
    toolName,
    headline,
    detailLines,
    ...(argsExcerpt ? { argsExcerpt } : {}),
    ...(outputExcerpt ? { outputExcerpt } : {}),
    ...(imagePaths && imagePaths.length > 0 ? { imagePaths } : {}),
  };
}

export function normalizeMessageAuxSnapshot(
  aux: MessageAuxSnapshot | undefined,
): MessageAuxSnapshot | undefined {
  if (!aux) {
    return undefined;
  }

  const thinking = aux.thinking?.trim() ? aux.thinking : undefined;
  const compaction = aux.compaction?.trim() ? aux.compaction : undefined;
  if (!thinking && !compaction) {
    return undefined;
  }

  return {
    ...(thinking ? { thinking } : {}),
    ...(compaction ? { compaction } : {}),
  };
}

export function shouldDropEmptyAssistantMessage(
  message: ConversationMessageSnapshot,
  tool: ToolBlockSnapshot | undefined,
  aux: MessageAuxSnapshot | undefined,
): boolean {
  return (
    message.role === 'assistant' &&
    !message.pending &&
    !message.content.trim() &&
    !tool &&
    !aux
  );
}

export function shouldHideEmptyPendingAssistantSnapshot(message: ConversationMessageSnapshot): boolean {
  return (
    message.role === 'assistant' &&
    message.pending &&
    !message.content.trim() &&
    !message.tool &&
    !normalizeMessageAuxSnapshot(message.aux)
  );
}

function defaultToolHeadline(
  phase: ToolBlockSnapshot['phase'],
  toolName: string,
): string {
  switch (phase) {
    case 'pending-approval':
      return `等待确认: ${toolName}`;
    case 'running':
      return `调用中: ${toolName}`;
    case 'failed':
      return `工具执行失败: ${toolName}`;
    case 'succeeded':
    default:
      return `工具执行完成: ${toolName}`;
  }
}

/** 末条 user 之后是否已有其它工具卡为「待审批」或「执行中」（不含当前 toolCallId）。 */
function hasBlockingToolAheadOfSameTurnPreview(
  messages: ConversationMessageSnapshot[],
  thisToolCallId: string,
): boolean {
  let lastUser = -1;
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i]?.role === 'user') {
      lastUser = i;
    }
  }
  for (let i = lastUser + 1; i < messages.length; i += 1) {
    const m = messages[i];
    if (m?.role !== 'assistant' || !m.tool) {
      continue;
    }
    if (m.tool.toolCallId === thisToolCallId) {
      continue;
    }
    const p = m.tool.phase;
    if (p === 'pending-approval' || p === 'running') {
      return true;
    }
  }
  return false;
}

export function headlineForStreamingToolPreview(
  messages: ConversationMessageSnapshot[],
  toolCallId: string,
  toolName: string,
  request?: unknown,
): string {
  const shellReason = reasonForShellTool(toolName, request);
  if (shellReason) {
    return shellReason;
  }

  return hasBlockingToolAheadOfSameTurnPreview(messages, toolCallId)
    ? `排队中: ${toolName}`
    : `调用中: ${toolName}`;
}

export function restoreMessagesFromArchive(
  archive: StoredDesktopSession,
): ConversationMessageSnapshot[] {
  const auxByIndex = new Map<number, MessageAuxSnapshot>();
  for (const entry of archive.assistantAux) {
    auxByIndex.set(entry.messageIndex, {
      ...(entry.thinking ? { thinking: entry.thinking } : {}),
      ...(entry.compaction ? { compaction: entry.compaction } : {}),
    });
  }

  return archive.messages.map((message, index) => ({
    id: index + 1,
    role: message.role,
    content: message.content,
    ...(auxByIndex.get(index) ? { aux: auxByIndex.get(index) } : {}),
    pending: false,
  }));
}

export function toolMessageKey(
  pending:
    | RuntimePendingApproval<DesktopToolRequest, string>
    | RuntimePendingQuestions<DesktopToolRequest>,
): string {
  return 'toolCallId' in pending && pending.toolCallId
    ? pending.toolCallId
    : `pending:${pending.toolName}`;
}
