import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  AgentRuntime,
  OpenAiPlanMetadata,
  OpenAiToolAgentState,
  OpenAiTransportConfig,
} from '@spirit-agent/agent-core';
import {
  createHostDreamStore,
  DREAM_RETENTION_MS as HOST_DREAM_RETENTION_MS,
  dreamLogsDirPath,
  type HostDreamSessionProgress,
} from '@spirit-agent/host-internal';

import type {
  ConversationMessageSnapshot,
  DesktopDreamCollectorSnapshot,
  SessionListItem,
} from '../types.js';
import type { DesktopToolRequest, StoredDesktopSession } from './contracts.js';
import {
  chatsDirPath,
  listStoredSessions,
  loadStoredSession,
  resolveApiKeyForModel,
  saveStoredSession,
  spiritAgentDataDir,
  type DesktopConfigFile,
} from './storage.js';
import { DesktopToolExecutor } from './tool-executor.js';
import {
  currentApiBase,
  sameWorkspaceRoot,
} from './service-utils.js';

export const DREAM_DEBUG_SESSION_FILE_PREFIX = 'dream-collector-';
export const DREAM_COLLECTOR_TICK_INTERVAL_MS = 30_000;
export const DREAM_COLLECTOR_MONITOR_INTERVAL_MS = 5_000;
export const DREAM_COLLECTOR_BACKOFF_MS = 60_000;

const DREAM_COLLECTOR_SOURCE_CONTEXT_MAX_CHARS = 16_000;
const DREAM_COLLECTOR_INCREMENTAL_CONTEXT_MAX_CHARS = 8_000;
const DREAM_COLLECTOR_ANCHOR_CONTEXT_MAX_CHARS = 4_000;
const DREAM_COLLECTOR_ANCHOR_MESSAGE_COUNT = 4;
const DREAM_COLLECTOR_SESSION_COOLDOWN_MS = 2 * 60 * 1000;
const DREAM_COMMIT_CONTEXT_MAX_CHARS = 6_000;

type DesktopRuntime = AgentRuntime<
  OpenAiTransportConfig,
  OpenAiToolAgentState,
  DesktopToolRequest,
  string
>;

export async function buildDreamCommitContext(input: {
  workspaceRoot: string;
  gitBranch?: string;
}): Promise<string> {
  const gitBranch = input.gitBranch?.trim();
  if (!gitBranch) {
    return '';
  }

  const dreamStore = createHostDreamStore({
    spiritDataDir: spiritAgentDataDir(),
    scope: {
      workspaceRoot: input.workspaceRoot,
      gitBranch,
    },
  });
  await dreamStore.pruneExpired();
  const dreams = await dreamStore.list({ includeDeleted: false, includeExpired: false });
  if (dreams.length === 0) {
    return '';
  }

  const rendered = dreams.map((dream, index) => {
    const lines = [
      `${index + 1}. ${dream.title}`,
      `summary: ${dream.summary}`,
      dream.details ? `details: ${dream.details}` : '',
      dream.tags?.length ? `tags: ${dream.tags.join(', ')}` : '',
      `updatedAtUnixMs: ${dream.updatedAtUnixMs}`,
    ].filter(Boolean);
    return lines.join('\n');
  }).join('\n\n');
  return truncateText(rendered, DREAM_COMMIT_CONTEXT_MAX_CHARS);
}

export function buildCommitMessageGenerationPrompt(input: {
  workspaceRoot: string;
  branch?: string;
  dreamContextText?: string;
  statusText: string;
  diffStatText: string;
  diffText: string;
}): string {
  const dreamSection = input.dreamContextText?.trim()
    ? [
        '',
        '[dream summaries] 当前工作动向摘要',
        input.dreamContextText.trim(),
      ]
    : [];
  return [
    '请为以下 Git 变更生成一条提交信息。',
    '必须遵守仓库约定：type / 可选 scope 使用英文；subject 使用中文。',
    '输出 JSON，由宿主解析。不要输出 Markdown、解释、代码块或额外字段。',
    'message 应该是一条可直接执行 git commit 的提交信息。若需要正文，可使用换行。',
    '如果提供了 dream summaries，请把它作为“为什么做这些变更”的语义背景；最终提交信息仍以 Git diff 为准。',
    '',
    `workspace: ${input.workspaceRoot}`,
    `branch: ${input.branch ?? '(unknown)'}`,
    ...dreamSection,
    '',
    '[git status --short --branch]',
    input.statusText || '(empty)',
    '',
    '[git diff --stat HEAD]',
    input.diffStatText || '(empty)',
    '',
    '[git diff HEAD]',
    input.diffText || '(empty)',
  ].join('\n');
}

export interface RunDesktopDreamCollectorOnceInput {
  workspaceRoot: string;
  gitBranch: string;
  collectorModel: string;
  config: DesktopConfigFile;
  planMetadata: OpenAiPlanMetadata;
}

export interface RunDesktopDreamCollectorOnceDeps {
  createRuntime(
    transportConfig: OpenAiTransportConfig,
    planMetadata: OpenAiPlanMetadata,
    toolExecutor: DesktopToolExecutor,
  ): DesktopRuntime;
  getStatus(): DesktopDreamCollectorSnapshot;
  setStatus(next: DesktopDreamCollectorSnapshot): void;
}

export async function runDesktopDreamCollectorOnce(
  input: RunDesktopDreamCollectorOnceInput,
  deps: RunDesktopDreamCollectorOnceDeps,
): Promise<void> {
  const runId = randomUUID();
  const startedAtUnixMs = Date.now();
  const scope = {
    workspaceRoot: input.workspaceRoot,
    gitBranch: input.gitBranch,
  };
  let sourceSession: SessionListItem | undefined;
  let sourceContextMode: DreamCollectorSourceContextMode | undefined;
  let pendingCount = 0;
  let toolCalls: DesktopDreamCollectorRunLog['toolCalls'] = [];
  let promptForDebug = '';
  let debugSessionPersisted = false;
  try {
    const cutoffUnixMs = Date.now() - HOST_DREAM_RETENTION_MS;
    const now = Date.now();
    const storedSessions = (await listStoredSessions())
      .filter((session) => sameWorkspaceRoot(session.workspaceRoot, input.workspaceRoot))
      .filter((session) => session.gitBranch === input.gitBranch)
      .filter((session) => !isDreamCollectorDebugSessionPath(session.path))
      .filter((session) => session.modifiedAtUnixMs >= cutoffUnixMs)
      .sort((left, right) => left.modifiedAtUnixMs - right.modifiedAtUnixMs);

    const dreamStore = createHostDreamStore({ spiritDataDir: spiritAgentDataDir(), scope });
    await dreamStore.pruneExpired(now);
    const sessionProgressList = await dreamStore.listSessionProgress();
    const sessionProgressMap = new Map(sessionProgressList.map((entry) => [entry.path, entry]));
    const pendingSessions = storedSessions.filter((session) =>
      shouldQueueDreamCollectorSession(session, sessionProgressMap.get(session.path), now),
    );
    pendingCount = pendingSessions.length;
    if (pendingSessions.length === 0) {
      deps.setStatus(clearDreamCollectorIssue({
        ...deps.getStatus(),
        state: 'idle',
        pendingCount: 0,
      }));
      return;
    }

    sourceSession = pendingSessions[0]!;
    deps.setStatus(clearDreamCollectorIssue({
      ...deps.getStatus(),
      state: 'running',
      pendingCount: pendingSessions.length,
    }));

    const apiKey = await resolveApiKeyForModel(input.collectorModel);
    if (!apiKey) {
      throw new Error('梦境收集模型未配置 API Key。');
    }

    const activeProfile = input.config.models.find((model) => model.name === input.collectorModel);
    const archive = await loadStoredSession(sourceSession.path);
    const sessionProgress = sessionProgressMap.get(sourceSession.path);
    const sourceContext = buildDreamCollectorSourceContext(archive, sessionProgress);
    sourceContextMode = sourceContext.mode;
    if (!sourceContext.shouldRunCollector) {
      await dreamStore.upsertSessionProgress({
        path: sourceSession.path,
        ...(sourceSession.displayName ? { displayName: sourceSession.displayName } : {}),
        lastProcessedSavedAtUnixMs: sourceSession.modifiedAtUnixMs,
        lastProcessedMessageCount: sourceContext.processedMessageCount,
        lastProcessedPrefixHash: sourceContext.prefixHash,
        lastRunAtUnixMs: Date.now(),
        cooldownUntilUnixMs: Date.now() + DREAM_COLLECTOR_SESSION_COOLDOWN_MS,
      });
      deps.setStatus(clearDreamCollectorIssue({
        ...deps.getStatus(),
        state: 'idle',
        pendingCount: Math.max(0, pendingSessions.length - 1),
      }));
      return;
    }
    const toolExecutor = new DesktopToolExecutor(input.workspaceRoot, {
      dreamScope: scope,
      dreamSourceSession: {
        path: sourceSession.path,
        displayName: sourceSession.displayName,
        savedAtUnixMs: sourceSession.modifiedAtUnixMs,
      },
    });
    const runtime = deps.createRuntime(
      {
        apiKey,
        model: input.collectorModel,
        baseUrl: activeProfile?.apiBase ?? currentApiBase(input.config),
        workspaceRoot: input.workspaceRoot,
        ...(activeProfile?.provider ? { llmVendor: activeProfile.provider } : {}),
      },
      input.planMetadata,
      toolExecutor,
    );
    promptForDebug = buildDreamCollectorPrompt({
      sourceSession,
      scope,
      sourceContext,
    });
    const result = await runtime.submitUserTurn(promptForDebug);
    toolCalls = result.toolExecutions.map((execution) => ({
      toolName: execution.toolName,
      failed: execution.failed,
    }));
    if (result.kind !== 'completed') {
      throw new Error(result.kind === 'failed' ? result.error : `梦境收集未完成: ${result.kind}`);
    }
    if (input.config.dreams.debugMode) {
      await persistDreamCollectorDebugSession({
        runId,
        workspaceRoot: input.workspaceRoot,
        gitBranch: input.gitBranch,
        collectorModel: input.collectorModel,
        sourceSession,
        prompt: promptForDebug,
        assistantText: result.assistantText,
        failed: false,
      });
      debugSessionPersisted = true;
    }

    await dreamStore.upsertSessionProgress({
      path: sourceSession.path,
      ...(sourceSession.displayName ? { displayName: sourceSession.displayName } : {}),
      lastProcessedSavedAtUnixMs: sourceSession.modifiedAtUnixMs,
      lastProcessedMessageCount: sourceContext.processedMessageCount,
      lastProcessedPrefixHash: sourceContext.prefixHash,
      lastRunAtUnixMs: Date.now(),
      cooldownUntilUnixMs: Date.now() + DREAM_COLLECTOR_SESSION_COOLDOWN_MS,
    });
    deps.setStatus(clearDreamCollectorIssue({
      ...deps.getStatus(),
      state: 'idle',
      lastSuccessAtUnixMs: Date.now(),
      pendingCount: Math.max(0, pendingSessions.length - 1),
      processedCount: deps.getStatus().processedCount + 1,
    }));
    await writeDreamCollectorRunLog({
      runId,
      startedAtUnixMs,
      finishedAtUnixMs: Date.now(),
      workspaceRoot: input.workspaceRoot,
      gitBranch: input.gitBranch,
      collectorModel: input.collectorModel,
      sourceSessionPath: sourceSession.path,
      decision: 'processed',
      ...(sourceContextMode ? { sourceContextMode } : {}),
      pendingCount,
      resultSummary: truncateText(result.assistantText, 1_000),
      toolCalls,
    });
  } catch (error) {
    if (input.config.dreams.debugMode && sourceSession && promptForDebug && !debugSessionPersisted) {
      await persistDreamCollectorDebugSession({
        runId,
        workspaceRoot: input.workspaceRoot,
        gitBranch: input.gitBranch,
        collectorModel: input.collectorModel,
        sourceSession,
        prompt: promptForDebug,
        assistantText: error instanceof Error ? error.message : String(error),
        failed: true,
      });
    }
    await writeDreamCollectorRunLog({
      runId,
      startedAtUnixMs,
      finishedAtUnixMs: Date.now(),
      workspaceRoot: input.workspaceRoot,
      gitBranch: input.gitBranch,
      collectorModel: input.collectorModel,
      ...(sourceSession ? { sourceSessionPath: sourceSession.path } : {}),
      decision: 'failed',
      ...(sourceContextMode ? { sourceContextMode } : {}),
      pendingCount,
      error: error instanceof Error ? error.message : String(error),
      toolCalls,
    });
    throw error;
  }
}

type DreamCollectorSourceContextMode = 'full' | 'incremental';

interface DreamCollectorNormalizedMessage {
  role: 'user' | 'assistant';
  rendered: string;
}

interface DreamCollectorSourceContext {
  mode: DreamCollectorSourceContextMode;
  rendered: string;
  prefixHash: string;
  processedMessageCount: number;
  shouldRunCollector: boolean;
}

function buildDreamCollectorSourceContext(
  archive: StoredDesktopSession,
  progress?: HostDreamSessionProgress,
): DreamCollectorSourceContext {
  const normalizedMessages = normalizeDreamCollectorMessages(archive);
  const processedMessageCount = normalizedMessages.length;
  const prefixHash = hashDreamCollectorMessages(normalizedMessages);
  if (!progress) {
    return {
      mode: 'full',
      rendered: renderDreamCollectorFullContext(normalizedMessages),
      prefixHash,
      processedMessageCount,
      shouldRunCollector: true,
    };
  }

  const needsFullRebuild =
    progress.lastProcessedMessageCount > processedMessageCount ||
    hashDreamCollectorMessages(
      normalizedMessages.slice(0, Math.min(progress.lastProcessedMessageCount, processedMessageCount)),
    ) !== progress.lastProcessedPrefixHash;
  if (needsFullRebuild) {
    return {
      mode: 'full',
      rendered: renderDreamCollectorFullContext(normalizedMessages),
      prefixHash,
      processedMessageCount,
      shouldRunCollector: true,
    };
  }

  const newMessages = normalizedMessages.slice(progress.lastProcessedMessageCount);
  if (newMessages.length === 0) {
    return {
      mode: 'incremental',
      rendered: '',
      prefixHash,
      processedMessageCount,
      shouldRunCollector: false,
    };
  }

  const anchorMessages = normalizedMessages.slice(
    Math.max(0, progress.lastProcessedMessageCount - DREAM_COLLECTOR_ANCHOR_MESSAGE_COUNT),
    progress.lastProcessedMessageCount,
  );
  return {
    mode: 'incremental',
    rendered: renderDreamCollectorIncrementalContext(anchorMessages, newMessages),
    prefixHash,
    processedMessageCount,
    shouldRunCollector: true,
  };
}

function normalizeDreamCollectorMessages(
  archive: StoredDesktopSession,
): DreamCollectorNormalizedMessage[] {
  const source = archive.llmHistory.length > 0
    ? archive.llmHistory
    : archive.messages.map((message) => ({
        role: message.role,
        content: message.content,
        imagePaths: [],
      }));
  return source
    .filter(
      (message): message is { role: 'user' | 'assistant'; content: string; imagePaths: string[] } =>
        message.role === 'user' || message.role === 'assistant',
    )
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      rendered: `${message.role.toUpperCase()}:\n${message.content.trim()}`,
    }));
}

function hashDreamCollectorMessages(
  messages: DreamCollectorNormalizedMessage[],
): string {
  return createHash('sha256')
    .update(messages.map((message) => message.rendered).join('\n\n'), 'utf8')
    .digest('hex')
    .slice(0, 32);
}

function renderDreamCollectorFullContext(
  messages: DreamCollectorNormalizedMessage[],
): string {
  return truncateText(
    messages.map((message) => message.rendered).join('\n\n') || '(empty session)',
    DREAM_COLLECTOR_SOURCE_CONTEXT_MAX_CHARS,
  );
}

function renderDreamCollectorIncrementalContext(
  anchorMessages: DreamCollectorNormalizedMessage[],
  newMessages: DreamCollectorNormalizedMessage[],
): string {
  const anchorText = truncateText(
    anchorMessages.map((message) => message.rendered).join('\n\n') || '(no prior anchor)',
    DREAM_COLLECTOR_ANCHOR_CONTEXT_MAX_CHARS,
  );
  const deltaText = truncateText(
    newMessages.map((message) => message.rendered).join('\n\n') || '(no delta)',
    DREAM_COLLECTOR_INCREMENTAL_CONTEXT_MAX_CHARS,
  );
  return [
    '[recent_anchor]',
    anchorText,
    '',
    '[new_delta]',
    deltaText,
  ].join('\n');
}

function shouldQueueDreamCollectorSession(
  session: SessionListItem,
  progress: HostDreamSessionProgress | undefined,
  nowUnixMs: number,
): boolean {
  if (!progress) {
    return true;
  }
  if (session.modifiedAtUnixMs <= progress.lastProcessedSavedAtUnixMs) {
    return false;
  }
  if (progress.cooldownUntilUnixMs !== undefined && nowUnixMs < progress.cooldownUntilUnixMs) {
    return false;
  }
  return true;
}

function buildDreamCollectorPrompt(input: {
  sourceSession: SessionListItem;
  scope: { workspaceRoot: string; gitBranch: string };
  sourceContext: DreamCollectorSourceContext;
}): string {
  const modeBlock = input.sourceContext.mode === 'incremental'
    ? [
        '这是同一会话在上次梦境收集后的新增内容。优先更新已有梦境，不要重复总结旧内容。',
        '[source_session_incremental_context]',
      ]
    : [
        '这是该会话当前可用的完整摘要上下文。',
        '[source_session_full_context]',
      ];
  return [
    '请收集这条源会话的梦境摘要。',
    '你必须先调用 dream_list 查看当前 scope 的已有梦境。',
    '如果源会话延续了已有动向，请调用 dream_update；如果是新动向，请调用 dream_record；如果已有梦境已经误导或过时，可调用 dream_delete。',
    '如果写 tags，只保留最关键的 2 到 4 个短标签；优先使用简短 lowercase/kebab-case 词，不要把所有子话题都枚举进去。',
    '如果源会话完全没有可沉淀的近期工作动向，可以不写入梦境，但不要执行任何非梦境维护操作。',
    '',
    `[scope] workspace=${input.scope.workspaceRoot}`,
    `[scope] branch=${input.scope.gitBranch}`,
    `[source_session] path=${input.sourceSession.path}`,
    `[source_session] title=${input.sourceSession.displayName}`,
    `[source_session] modifiedAtUnixMs=${input.sourceSession.modifiedAtUnixMs}`,
    `[source_session] mode=${input.sourceContext.mode}`,
    '',
    ...modeBlock,
    input.sourceContext.rendered,
  ].join('\n');
}

interface DesktopDreamCollectorRunLog {
  runId: string;
  startedAtUnixMs: number;
  finishedAtUnixMs: number;
  workspaceRoot: string;
  gitBranch: string;
  collectorModel: string;
  sourceSessionPath?: string;
  decision: 'no-pending' | 'processed' | 'failed';
  sourceContextMode?: DreamCollectorSourceContextMode;
  pendingCount: number;
  resultSummary?: string;
  error?: string;
  toolCalls: Array<{
    toolName: string;
    failed: boolean;
  }>;
}

async function writeDreamCollectorRunLog(log: DesktopDreamCollectorRunLog): Promise<void> {
  const logsDir = dreamLogsDirPath(spiritAgentDataDir());
  await mkdir(logsDir, { recursive: true });
  const fileName = `${log.startedAtUnixMs}-${log.runId}.json`;
  await writeFile(path.join(logsDir, fileName), `${JSON.stringify(log, null, 2)}\n`, 'utf8');
}

async function persistDreamCollectorDebugSession(input: {
  runId: string;
  workspaceRoot: string;
  gitBranch: string;
  collectorModel: string;
  sourceSession: SessionListItem;
  prompt: string;
  assistantText: string;
  failed: boolean;
}): Promise<void> {
  const now = Date.now();
  const messages: ConversationMessageSnapshot[] = [
    {
      id: 1,
      role: 'user',
      content: input.prompt,
      pending: false,
    },
    {
      id: 2,
      role: 'assistant',
      content: input.failed ? `生成失败：${input.assistantText}` : input.assistantText,
      pending: false,
    },
  ];
  const sessionFile = path.join(chatsDirPath(), `${DREAM_DEBUG_SESSION_FILE_PREFIX}${now}-${input.runId}.json`);
  await saveStoredSession(sessionFile, {
    messages,
    assistantAux: [],
    llmHistory: messages.map((message) => ({
      role: message.role,
      content: message.content,
      imagePaths: [],
    })),
    subagentSessions: [],
    savedAtUnixMs: now,
    sessionDisplayName: `[梦境] ${input.sourceSession.displayName}`,
    workspaceRoot: input.workspaceRoot,
    gitBranch: input.gitBranch,
    desktopMessages: messages,
  });
}

export function isDreamCollectorDebugSessionPath(filePath: string): boolean {
  return path.basename(filePath).startsWith(DREAM_DEBUG_SESSION_FILE_PREFIX);
}

export function emptyDreamCollectorSnapshot(
  state: DesktopDreamCollectorSnapshot['state'],
): DesktopDreamCollectorSnapshot {
  return {
    state,
    pendingCount: 0,
    processedCount: 0,
  };
}

export function clearDreamCollectorIssue(
  snapshot: DesktopDreamCollectorSnapshot,
): DesktopDreamCollectorSnapshot {
  const { lastError: _lastError, backoffUntilUnixMs: _backoffUntilUnixMs, ...clean } = snapshot;
  return clean;
}

function truncateText(value: string, maxChars: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxChars) {
    return value;
  }
  return `${chars.slice(0, maxChars).join('')}...<truncated>`;
}
