import { formatScheduleLabel, normalizeAutomationSchedule } from '@spirit-agent/host-internal';

import i18n from '../lib/i18n-host.js';
import type {
  LlmMessageContent,
  RuntimePendingApproval,
  RuntimePendingQuestions,
} from '@spirit-agent/core';
import {
  finishTaskNoticeFromSummary,
  isGenericProviderWebSearchQuery,
  llmMessageTextContent,
} from '@spirit-agent/core';

import { isStandaloneThinkingMessage } from '../lib/conversation-thinking-ui.js';
import { listDirectoryToolDisplayPath } from '@spirit-agent/host-internal/skill-paths';

import {
  isSkillMarkdownPath,
  parseReadFilePathFromRequest,
  readFileVerbKey,
  skillFolderBasename,
} from '../lib/read-file-skill-display.js';
import { phaseToVerbContext } from '../lib/tool-verb-context.js';
import {
  hasActiveRunSubagentToolInMessages,
  hasInFlightSubagentDelegationInMessages,
  hasRunSubagentToolInCurrentTurn,
  isLivePendingReasoningAux,
  isSubagentStatusSurfaceMessage,
  isSubagentStatusSurfaceText,
  parsePendingSubagentStatusText,
} from '../lib/subagent-display.js';
import type {
  ConversationMessageSnapshot,
  MessageAuxSnapshot,
  PendingAssistantAux,
  ToolBlockSnapshot,
} from '../types.js';
import type { DesktopToolRequest, StoredDesktopSession } from './contracts.js';

export {
  hasActiveRunSubagentToolInMessages,
  hasInFlightSubagentDelegationInMessages,
  hasRunSubagentToolInCurrentTurn,
  isSubagentStatusSurfaceMessage,
  isSubagentStatusSurfaceText,
  parsePendingSubagentStatusText,
};

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

const SHELL_REASON_PREFIX = i18n.t('tool.reasonPrefix');

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

export interface ToolCallSummaryCopy {
  headline: string;
  headlineDetail?: string;
}

export type ToolCallSummaryOptions = {
  workspaceRoot?: string;
};

const SUMMARY_DETAIL_MAX = 80;
const SUBAGENT_TASK_PREVIEW_MAX = 48;

/** Parsed host request uses `plan_name`; streaming preview JSON uses tool arg `name`. */
function planSlugFromCreatePlanRequest(record: Record<string, unknown>): string {
  const planName = typeof record.plan_name === 'string' ? record.plan_name.trim() : '';
  if (planName) {
    return planName;
  }
  const streamedName = typeof record.name === 'string' ? record.name.trim() : '';
  return streamedName === 'create_plan' ? '' : streamedName;
}

export function toolCallSummaryCopyForRequest(
  toolName: string,
  request: unknown,
  phase?: ToolBlockSnapshot['phase'],
  options?: ToolCallSummaryOptions,
): ToolCallSummaryCopy | undefined {
  if (!request || typeof request !== 'object') {
    return undefined;
  }

  const record = request as Record<string, unknown>;
  const ctx = phase ? phaseToVerbContext(phase) : undefined;
  const tOpts = ctx ? { context: ctx } : {};

  switch (toolName) {
    case 'run_shell_command': {
      const reason = reasonForShellTool(toolName, request);
      const command = typeof record.command === 'string' ? record.command.trim() : '';
      if (!reason && !command) {
        return undefined;
      }
      return {
        headline: reason ?? i18n.t('tool.runCommand', tOpts),
        ...(command ? { headlineDetail: truncateSummaryDetail(command) } : {}),
      };
    }
    case 'create_file':
    case 'edit_file':
    case 'delete_file': {
      const rawPath = typeof record.path === 'string' ? record.path : '';
      const basename = displayBasename(rawPath);
      const verb =
        toolName === 'create_file' ? i18n.t('tool.create', tOpts) : toolName === 'edit_file' ? i18n.t('tool.edit', tOpts) : i18n.t('tool.delete', tOpts);
      return {
        headline: verb,
        headlineDetail: truncateSummaryDetail(basename),
      };
    }
    case 'create_plan': {
      const planSlug = planSlugFromCreatePlanRequest(record);
      const label = planSlug
        ? `plans/${planSlug.endsWith('.md') ? planSlug : `${planSlug}.md`}`
        : 'plans/';
      return {
        headline: i18n.t('tool.create', tOpts),
        headlineDetail: truncateSummaryDetail(displayBasename(label)),
      };
    }
    case 'create_automation': {
      const title = typeof record.title === 'string' ? record.title.trim() : '';
      const schedule = normalizeAutomationSchedule(record.schedule);
      const scheduleLabel = schedule ? formatScheduleLabel(schedule) : '';
      const detail = [title, scheduleLabel].filter((part) => part.length > 0).join(' · ');
      return {
        headline: i18n.t('automations.create', tOpts),
        headlineDetail: truncateSummaryDetail(detail || 'automation'),
      };
    }
    case 'apply_patch': {
      const operation =
        record.operation && typeof record.operation === 'object'
          ? (record.operation as Record<string, unknown>)
          : undefined;
      const rawPath = typeof operation?.path === 'string' ? operation.path : '';
      const basename = displayBasename(rawPath);
      const opType = typeof operation?.type === 'string' ? operation.type : '';
      const verb =
        opType === 'create_file'
          ? i18n.t('tool.create', tOpts)
          : opType === 'update_file'
            ? i18n.t('tool.edit', tOpts)
            : opType === 'delete_file'
              ? i18n.t('tool.delete', tOpts)
              : 'Patch';
      return {
        headline: verb,
        headlineDetail: truncateSummaryDetail(basename),
      };
    }
    case 'grep': {
      const query = typeof record.query === 'string' ? record.query.trim() : '';
      const prefix = record.is_regexp === true ? i18n.t('tool.regexPrefix') : '';
      return {
        headline: i18n.t('tool.search', tOpts),
        ...(query ? { headlineDetail: truncateSummaryDetail(`${prefix}${query}`) } : {}),
      };
    }
    case 'glob': {
      const pattern = typeof record.pattern === 'string' ? record.pattern.trim() : '';
      return {
        headline: i18n.t('tool.match', tOpts),
        ...(pattern ? { headlineDetail: truncateSummaryDetail(pattern) } : {}),
      };
    }
    case 'web_fetch': {
      const url = typeof record.url === 'string' ? record.url.trim() : '';
      return {
        headline: i18n.t('tool.fetch', tOpts),
        ...(url ? { headlineDetail: truncateSummaryDetail(url) } : {}),
      };
    }
    case 'web_search': {
      const query = webSearchQueryFromArguments(record);
      return {
        headline: i18n.t('tool.webSearch', tOpts),
        ...(query && !isGenericProviderWebSearchQuery(query)
          ? { headlineDetail: truncateSummaryDetail(query) }
          : {}),
      };
    }
    case 'code_interpreter': {
      const code = typeof record.code === 'string' ? record.code.trim() : '';
      const firstLine = code.split(/\r?\n/u).find((line) => line.trim().length > 0)?.trim() ?? '';
      return {
        headline: i18n.t('tool.codeInterpreter', tOpts),
        ...(firstLine ? { headlineDetail: truncateSummaryDetail(firstLine) } : {}),
      };
    }
    case 'list_directory_files': {
      const rawPath = typeof record.path === 'string' ? record.path.trim() : '';
      return {
        headline: i18n.t('tool.listDirectory', tOpts),
        ...(rawPath
          ? {
              headlineDetail: truncateSummaryDetail(
                displayPathForListDirectory(rawPath, options?.workspaceRoot),
              ),
            }
          : {}),
      };
    }
    case 'get_diagnostics': {
      const rawPath = typeof record.path === 'string' ? record.path.trim() : '';
      const basename = rawPath ? displayBasename(rawPath) : '';
      return {
        headline: i18n.t('tool.diagnosticsChecking'),
        ...(basename ? { headlineDetail: truncateSummaryDetail(basename) } : {}),
      };
    }
    case 'ask_questions': {
      const questions = Array.isArray(record.questions) ? record.questions : [];
      return {
        headline: i18n.t('tool.askQuestions', tOpts),
        headlineDetail: questions.length > 0 ? i18n.t('tool.nQuestions', { count: questions.length }) : i18n.t('tool.question'),
      };
    }
    case 'run_subagent': {
      const task = typeof record.task === 'string' ? record.task.trim() : '';
      const contextSummary =
        typeof record.context_summary === 'string' ? record.context_summary.trim() : '';
      const previewSource = task || contextSummary;
      return {
        headline: i18n.t('tool.subagent', tOpts),
        headlineDetail: previewSource
          ? truncateSummaryDetail(previewSource, SUBAGENT_TASK_PREVIEW_MAX)
          : i18n.t('tool.unspecifiedTask'),
      };
    }
    case 'dream_list':
      return { headline: i18n.t('tool.dreamList', tOpts) };
    case 'dream_read':
      return dreamIdSummaryCopy(i18n.t('tool.dreamRead', tOpts), record);
    case 'dream_update':
      return dreamIdSummaryCopy(i18n.t('tool.dreamUpdate', tOpts), record);
    case 'dream_delete':
      return dreamIdSummaryCopy(i18n.t('tool.dreamDelete', tOpts), record);
    case 'dream_record': {
      const title = typeof record.title === 'string' ? record.title.trim() : '';
      const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
      const detail = title || summary;
      return {
        headline: i18n.t('tool.dreamRecord', tOpts),
        ...(detail ? { headlineDetail: truncateSummaryDetail(detail) } : {}),
      };
    }
    case 'todo_create': {
      const items = Array.isArray(record.items) ? record.items : [];
      const firstTitle =
        items.length > 0 && typeof items[0] === 'object' && items[0] !== null
          ? String((items[0] as Record<string, unknown>).title ?? '').trim()
          : '';
      return {
        headline: i18n.t('tool.todoCreate', tOpts),
        headlineDetail: truncateSummaryDetail(
          items.length > 1
            ? i18n.t('tool.nItems', { count: items.length, firstTitle: firstTitle || '' })
            : firstTitle || i18n.t('tool.oneItem'),
        ),
      };
    }
    case 'todo_update': {
      const title = typeof record.title === 'string' ? record.title.trim() : '';
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      return {
        headline: i18n.t('tool.todoUpdate', tOpts),
        headlineDetail: truncateSummaryDetail(title || id || ''),
      };
    }
    case 'todo_complete': {
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      return {
        headline: i18n.t('tool.todoComplete', tOpts),
        ...(id ? { headlineDetail: truncateSummaryDetail(id) } : {}),
      };
    }
    case 'todo_list':
      return { headline: i18n.t('tool.todoList', tOpts) };
    case 'extension_tool': {
      const extensionToolName =
        typeof record.tool_name === 'string' ? record.tool_name.trim() : '';
      if (!extensionToolName) {
        return undefined;
      }
      return { headline: extensionToolName };
    }
    default:
      return undefined;
  }
}

function dreamIdSummaryCopy(
  headline: string,
  record: Record<string, unknown>,
): ToolCallSummaryCopy {
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  return {
    headline,
    ...(id ? { headlineDetail: truncateSummaryDetail(id) } : {}),
  };
}

export function toolCallSummaryForPhase(
  phase: ToolBlockSnapshot['phase'],
  toolName: string,
  request: unknown,
  options?: ToolCallSummaryOptions,
): ToolCallSummaryCopy {
  if (toolName === 'read_file') {
    return readFileSummaryCopy(request, phase);
  }

  const custom = toolCallSummaryCopyForRequest(toolName, request, phase, options);
  if (custom) {
    return custom;
  }

  return { headline: defaultToolHeadline(phase, toolName) };
}

export function headlineForToolPhase(
  phase: ToolBlockSnapshot['phase'],
  toolName: string,
  request: unknown,
  options?: ToolCallSummaryOptions,
): string {
  return toolCallSummaryForPhase(phase, toolName, request, options).headline;
}

export function applyToolCallSummaryCopy(
  tool: ToolBlockSnapshot,
  summary: ToolCallSummaryCopy,
): ToolBlockSnapshot {
  const headlineDetail = summary.headlineDetail?.trim();
  const { headlineDetail: _previousDetail, ...rest } = tool;
  return {
    ...rest,
    headline: summary.headline,
    ...(headlineDetail ? { headlineDetail } : {}),
  };
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

/** Drop reasoning aux that duplicates visible body text or leaked subagent status. */
export function stripRedundantThinkingFromMessageAux(
  content: string,
  aux: MessageAuxSnapshot | undefined,
): MessageAuxSnapshot | undefined {
  const normalizedContent = content.trim();
  const normalizedAux = normalizeMessageAuxSnapshot(aux);
  if (!normalizedContent || !normalizedAux?.thinking?.trim()) {
    return normalizedAux;
  }

  const thinking = normalizedAux.thinking.trim();
  if (
    thinking === normalizedContent ||
    normalizedContent.startsWith(thinking) ||
    isSubagentStatusSurfaceText(thinking)
  ) {
    return stripThinkingFromAux(normalizedAux);
  }

  return normalizedAux;
}

export { isStandaloneThinkingMessage };

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
  const headlineDetail = tool.headlineDetail?.trim() ? tool.headlineDetail.trim() : undefined;
  const detailLines = tool.detailLines.filter((line) => line.trim().length > 0);
  const argsExcerpt = tool.argsExcerpt?.trim() ? tool.argsExcerpt : undefined;
  const outputExcerpt = tool.outputExcerpt?.trim() ? tool.outputExcerpt : undefined;
  const imagePaths = tool.imagePaths?.map((entry) => entry.trim()).filter(Boolean);
  const videoPaths = tool.videoPaths?.map((entry) => entry.trim()).filter(Boolean);
  const lspWriteDiagnostics = normalizeLspWriteDiagnosticsSnapshot(tool.lspWriteDiagnostics);

  return {
    ...tool,
    toolName,
    headline,
    detailLines,
    ...(headlineDetail ? { headlineDetail } : {}),
    ...(argsExcerpt ? { argsExcerpt } : {}),
    ...(outputExcerpt ? { outputExcerpt } : {}),
    ...(imagePaths && imagePaths.length > 0 ? { imagePaths } : {}),
    ...(videoPaths && videoPaths.length > 0 ? { videoPaths } : {}),
    ...(lspWriteDiagnostics ? { lspWriteDiagnostics } : {}),
  };
}

function normalizeLspWriteDiagnosticsSnapshot(
  value: ToolBlockSnapshot['lspWriteDiagnostics'],
): ToolBlockSnapshot['lspWriteDiagnostics'] | undefined {
  if (!value || typeof value.relativePath !== 'string' || !Array.isArray(value.items)) {
    return undefined;
  }
  const relativePath = value.relativePath.trim();
  if (!relativePath) {
    return undefined;
  }
  const items = value.items
    .filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        (item.severity === 'error' || item.severity === 'warning') &&
        typeof item.line === 'number' &&
        typeof item.column === 'number' &&
        typeof item.message === 'string' &&
        item.message.trim().length > 0,
    )
    .map((item) => ({
      severity: item.severity,
      line: item.line,
      column: item.column,
      message: item.message.trim(),
      ...(item.code !== undefined ? { code: item.code } : {}),
      ...(item.source?.trim() ? { source: item.source.trim() } : {}),
    }));
  if (items.length === 0) {
    return undefined;
  }
  return { relativePath, items };
}

export function normalizeMessageAuxSnapshot(
  aux: MessageAuxSnapshot | undefined,
): MessageAuxSnapshot | undefined {
  if (!aux) {
    return undefined;
  }

  const thinking = aux.thinking?.trim() ? aux.thinking : undefined;
  const compaction = aux.compaction?.trim() ? aux.compaction : undefined;
  const finishTaskNotice = aux.finishTaskNotice?.trim()
    ? aux.finishTaskNotice
    : undefined;
  if (!thinking && !compaction && !finishTaskNotice) {
    return undefined;
  }

  return {
    ...(thinking ? { thinking } : {}),
    ...(compaction ? { compaction } : {}),
    ...(finishTaskNotice ? { finishTaskNotice } : {}),
  };
}

const FINISH_TASK_DEFAULT_OUTPUT = 'Task marked complete.';

export {
  finishTaskArgumentsJsonComplete,
  finishTaskNoticeFromSummary,
  finishTaskNoticePreviewFromArguments,
  finishTaskSummaryFromStreamingArguments,
} from '@spirit-agent/core';

export function finishTaskSummaryFromExecution(input: {
  request: unknown;
  output?: string;
}): string {
  if (input.request && typeof input.request === 'object') {
    const request = input.request as { name?: unknown; summary?: unknown };
    if (request.name === 'finish_task' && typeof request.summary === 'string') {
      const summary = request.summary.trim();
      if (summary) {
        return summary;
      }
    }
  }

  const output = (input.output ?? '').trim();
  if (output && output !== FINISH_TASK_DEFAULT_OUTPUT) {
    return output;
  }

  return '';
}

export function finishTaskNoticeFromExecution(input: {
  request: unknown;
  output?: string;
}): string {
  return finishTaskNoticeFromSummary(finishTaskSummaryFromExecution(input));
}

export function assistantContentDuplicatesFinishTaskSummary(
  content: string,
  summary: string,
  rawCompletionText: string,
): boolean {
  const normalizedContent = content.trim();
  if (!normalizedContent) {
    return false;
  }
  const normalizedSummary = summary.trim();
  const normalizedRaw = rawCompletionText.trim();
  return (
    (normalizedSummary.length > 0 && normalizedContent === normalizedSummary) ||
    (normalizedRaw.length > 0 && normalizedContent === normalizedRaw)
  );
}

export function isFinishTaskToolName(toolName: string): boolean {
  return toolName === 'finish_task';
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

export function shouldHideEmptyPendingAssistantSnapshot(
  message: ConversationMessageSnapshot,
  livePendingAux?: PendingAssistantAux,
): boolean {
  const isEmptyPending =
    message.role === 'assistant' &&
    message.pending &&
    !message.content.trim() &&
    !message.tool &&
    !normalizeMessageAuxSnapshot(message.aux);

  if (!isEmptyPending) {
    return false;
  }

  // Keep the pending row visible while runtime reports thinking/compressing so the
  // conversation UI can show the Thinking label before detailText is synced.
  if (isLivePendingReasoningAux(livePendingAux)) {
    return false;
  }

  return true;
}

function defaultToolHeadline(
  phase: ToolBlockSnapshot['phase'],
  toolName: string,
): string {
  switch (phase) {
    case 'preview':
      return i18n.t('tool.previewing', { toolName });
    case 'pending-approval':
      return i18n.t('tool.pendingApproval', { toolName });
    case 'running':
      return i18n.t('tool.running', { toolName });
    case 'failed':
      return i18n.t('tool.failed', { toolName });
    case 'succeeded':
    default:
      return i18n.t('tool.succeeded', { toolName });
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
    if (p === 'preview' || p === 'pending-approval' || p === 'running') {
      return true;
    }
  }
  return false;
}

export function toolCallSummaryCopyForResponsesBuiltInTool(
  toolName: string,
  phase: ToolBlockSnapshot['phase'],
  previewSummary: ToolCallSummaryCopy,
  providerUi?: { headlineDetail?: string; sourceCount?: number },
): ToolCallSummaryCopy {
  if (toolName === 'web_search') {
    if (phase === 'succeeded' && providerUi?.sourceCount && providerUi.sourceCount > 0) {
      return {
        headline: previewSummary.headline,
        headlineDetail: i18n.t('tool.webSearchSourceCount', { count: providerUi.sourceCount }),
      };
    }
    return { headline: previewSummary.headline };
  }
  if (providerUi?.headlineDetail) {
    return {
      headline: previewSummary.headline,
      headlineDetail: providerUi.headlineDetail,
    };
  }
  return previewSummary;
}

export function toolCallSummaryForStreamingPreview(
  messages: ConversationMessageSnapshot[],
  toolCallId: string,
  toolName: string,
  request?: unknown,
  options?: ToolCallSummaryOptions,
): ToolCallSummaryCopy {
  if (toolName === 'read_file') {
    return readFileSummaryCopy(request, 'running');
  }

  const custom =
    request !== undefined
      ? toolCallSummaryCopyForRequest(toolName, request, 'running', options)
      : undefined;
  if (custom) {
    return custom;
  }

  if (toolName === 'get_diagnostics' && request && typeof request === 'object') {
    const rawPath = typeof (request as Record<string, unknown>).path === 'string'
      ? (request as Record<string, unknown>).path as string
      : '';
    return {
      headline: i18n.t('tool.diagnosticsChecking'),
      ...(rawPath.trim() ? { headlineDetail: truncateSummaryDetail(displayBasename(rawPath.trim())) } : {}),
    };
  }

  return {
    headline: hasBlockingToolAheadOfSameTurnPreview(messages, toolCallId)
      ? i18n.t('tool.queued', { toolName })
      : i18n.t('tool.running', { toolName }),
  };
}

export function headlineForStreamingToolPreview(
  messages: ConversationMessageSnapshot[],
  toolCallId: string,
  toolName: string,
  request?: unknown,
  options?: ToolCallSummaryOptions,
): string {
  return toolCallSummaryForStreamingPreview(messages, toolCallId, toolName, request, options).headline;
}

function readFileSummaryCopy(request: unknown, phase?: ToolBlockSnapshot['phase']): ToolCallSummaryCopy {
  const ctx = phase ? phaseToVerbContext(phase) : undefined;
  const tOpts = ctx ? { context: ctx } : {};
  if (!request || typeof request !== 'object') {
    return { headline: i18n.t('tool.read', tOpts), headlineDetail: i18n.t('tool.file') };
  }

  const record = request as Record<string, unknown>;
  const rawPath = parseReadFilePathFromRequest(request);
  const displayPath = isSkillMarkdownPath(rawPath)
    ? skillFolderBasename(rawPath)
    : displayPathForReadFile(rawPath);
  const lineRange = lineRangeForReadFile(record.start_line, record.end_line);
  const detail = `${displayPath}${lineRange}`.trim();

  return {
    headline: i18n.t(readFileVerbKey(rawPath), tOpts),
    ...(detail ? { headlineDetail: truncateSummaryDetail(detail) } : {}),
  };
}

function webSearchQueryFromArguments(record: Record<string, unknown>): string {
  for (const key of ['query', 'search_query', 'q', 'keywords']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  const action = record.action;
  if (action && typeof action === 'object' && !Array.isArray(action)) {
    return webSearchQueryFromArguments(action as Record<string, unknown>);
  }
  return '';
}

function truncateSummaryDetail(value: string, max = SUMMARY_DETAIL_MAX): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}…`;
}

function displayBasename(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return i18n.t('tool.file');
  }

  const normalized = trimmed.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function displayPathForListDirectory(path: string, workspaceRoot?: string): string {
  const displayed = listDirectoryToolDisplayPath(path, workspaceRoot, i18n.t('tool.directory'));
  if (displayed.length <= SUMMARY_DETAIL_MAX) {
    return displayed;
  }
  return displayPathForReadFile(displayed);
}

function displayPathForReadFile(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return i18n.t('tool.file');
  }

  const normalized = trimmed.replace(/\\/g, '/');
  const absolute = normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized);
  if (!absolute) {
    return normalized;
  }

  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function lineRangeForReadFile(startLine: unknown, endLine: unknown): string {
  const start = positiveLineNumber(startLine);
  const end = positiveLineNumber(endLine);
  if (start !== undefined && end !== undefined) {
    return ` ${start} - ${end}`;
  }
  if (start !== undefined) {
    return ` ${start} -`;
  }
  if (end !== undefined) {
    return ` 1 - ${end}`;
  }
  return '';
}

function positiveLineNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

export function restoreMessagesFromArchive(
  archive: StoredDesktopSession,
): ConversationMessageSnapshot[] {
  const auxByIndex = new Map<number, MessageAuxSnapshot>();
  for (const entry of archive.assistantAux) {
    auxByIndex.set(entry.messageIndex, {
      ...(entry.thinking ? { thinking: entry.thinking } : {}),
      ...(entry.compaction ? { compaction: entry.compaction } : {}),
      ...(entry.finishTaskNotice ? { finishTaskNotice: entry.finishTaskNotice } : {}),
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
