import type {
  AskQuestionsResult as RuntimeAskQuestionsResult,
  ChatArchive,
  RuntimePendingQuestions,
} from '@spirit-agent/core';
import {
  cloneLlmMessageContent,
  cloneLlmProviderState,
} from '@spirit-agent/core';

import i18n from '../lib/i18n-host.js';
import type {
  AskQuestionsResult,
  DesktopDreamCollectorSnapshot,
  DesktopWebHostSnapshot,
  PendingQuestionsSnapshot,
} from '../types.js';
import type { DesktopToolRequest } from './contracts.js';
import {
  normalizeGeneratedWorktreeNames as normalizeGeneratedWorktreeNamesInternal,
  parseGeneratedWorktreeNamingResponse as parseGeneratedWorktreeNamingResponseInternal,
  resolveWorkspaceGroupingRoot,
} from '@spirit-agent/host-internal';
import type { GeneratedWorktreeNames } from './worktree-naming.js';
import {
  type DesktopConfigFile,
  type DesktopWebHostConfigFile,
  type DesktopWorkspaceBinding,
  mergeRecentWorkspaceRoots,
  resolveDesktopHomeDirectory,
} from './storage.js';
import { resolveProfileApiBase } from './model-config.js';
import {
  DESKTOP_WEB_HOST_POLICY,
  getDesktopWebHostRuntimeStatus,
} from './web-host-state.js';

export function normalizeWorkspaceRootKey(workspaceRoot: string): string {
  return workspaceRoot.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
}

export function sameWorkspaceRoot(left: string, right: string): boolean {
  return normalizeWorkspaceRootKey(left) === normalizeWorkspaceRootKey(right);
}

/** Sessions whose cwd is the user home directory are "unbound" (no project workspace). */
export function isNoWorkspaceSessionRoot(workspaceRoot: string): boolean {
  return sameWorkspaceRoot(workspaceRoot, resolveDesktopHomeDirectory());
}

export function resolveWorkspaceBindingForRequestedRoot(input: {
  requestedWorkspaceRoot?: string;
  explicitBinding?: DesktopWorkspaceBinding;
  previousBinding: DesktopWorkspaceBinding;
  persistedBinding: DesktopWorkspaceBinding;
}): DesktopWorkspaceBinding {
  if (input.explicitBinding === 'none') {
    return 'none';
  }
  if (input.explicitBinding === 'project') {
    return 'project';
  }
  if (!input.requestedWorkspaceRoot?.trim()) {
    return input.previousBinding;
  }
  if (isNoWorkspaceSessionRoot(input.requestedWorkspaceRoot)) {
    return 'none';
  }
  return 'project';
}

export function deriveWorkspaceLabel(workspaceRoot: string): string {
  const normalized = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/g, '');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) || normalized : normalized;
}

export function buildAvailableWorkspaces(
  currentWorkspaceRoot: string,
  recentWorkspaces?: string[],
  workspaceBinding: DesktopWorkspaceBinding = 'project',
) {
  const homeKey = normalizeWorkspaceRootKey(resolveDesktopHomeDirectory());
  const merged =
    workspaceBinding === 'none'
      ? (recentWorkspaces ?? [])
      : mergeRecentWorkspaceRoots(
          recentWorkspaces,
          resolveWorkspaceGroupingRoot(currentWorkspaceRoot),
        );
  const seen = new Set<string>();
  const items: Array<{ path: string; label: string }> = [];
  for (const workspaceRoot of merged) {
    const groupingRoot = resolveWorkspaceGroupingRoot(workspaceRoot);
    const key = normalizeWorkspaceRootKey(groupingRoot);
    if (key === homeKey) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push({
      path: groupingRoot,
      label: deriveWorkspaceLabel(groupingRoot),
    });
  }
  return items;
}

export function cloneDesktopConfig(config: DesktopConfigFile): DesktopConfigFile {
  return JSON.parse(JSON.stringify(config)) as DesktopConfigFile;
}

export function normalizeGeneratedWorktreeNames(value: {
  worktreeName?: unknown;
  branchName?: unknown;
}): GeneratedWorktreeNames {
  try {
    return normalizeGeneratedWorktreeNamesInternal(value);
  } catch (error) {
    throw mapWorktreeNamingValidationError(error);
  }
}

export function parseGeneratedWorktreeNamingResponse(rawText: string): GeneratedWorktreeNames {
  try {
    return parseGeneratedWorktreeNamingResponseInternal(rawText);
  } catch (error) {
    throw mapWorktreeNamingValidationError(error);
  }
}

function mapWorktreeNamingValidationError(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(i18n.t('error.autoWorktreeNameFailedInvalidJson'));
  }

  const message = error.message;
  if (message.includes('missing worktreeName or branchName')) {
    return new Error(i18n.t('error.autoWorktreeNameFailedMissingFields'));
  }
  if (message.includes('empty worktreeName or branchName')) {
    return new Error(i18n.t('error.autoWorktreeNameFailedEmpty'));
  }
  if (message.includes('Invalid worktreeName format:')) {
    const worktreeName = message.replace(/^Invalid worktreeName format:\s*/u, '').trim();
    return new Error(i18n.t('error.autoWorktreeNameFailedInvalidWorktreeName', { worktreeName }));
  }
  if (message.includes('Invalid branchName format:')) {
    const branchName = message.replace(/^Invalid branchName format:\s*/u, '').trim();
    return new Error(i18n.t('error.autoWorktreeNameFailedInvalidBranchName', { branchName }));
  }
  if (message.includes('no assistant text')) {
    return new Error(i18n.t('error.autoWorktreeNameFailedNoBody'));
  }
  if (message.includes('not valid JSON')) {
    return new Error(i18n.t('error.autoWorktreeNameFailedInvalidJson'));
  }
  if (message.includes('must be a JSON object')) {
    return new Error(i18n.t('error.autoWorktreeNameFailedNotObject'));
  }
  return error;
}

export function sameDreamCollectorSnapshot(
  left: DesktopDreamCollectorSnapshot,
  right: DesktopDreamCollectorSnapshot,
): boolean {
  return left.state === right.state &&
    left.lastRunAtUnixMs === right.lastRunAtUnixMs &&
    left.lastSuccessAtUnixMs === right.lastSuccessAtUnixMs &&
    left.lastError === right.lastError &&
    left.pendingCount === right.pendingCount &&
    left.processedCount === right.processedCount &&
    left.backoffUntilUnixMs === right.backoffUntilUnixMs;
}

export function buildWebHostSnapshot(config: DesktopWebHostConfigFile): DesktopWebHostSnapshot {
  const runtimeStatus = getDesktopWebHostRuntimeStatus();
  const status = config.enabled
    ? {
        ...runtimeStatus,
        host: runtimeStatus.host || config.host,
        port: runtimeStatus.port || config.port,
        ...(config.authTokenHash ? { pairingCode: undefined } : {}),
      }
    : {
        state: 'disabled' as const,
        host: config.host,
        port: config.port,
      };

  return {
    config: {
      enabled: config.enabled,
      host: config.host,
      port: config.port,
      paired: Boolean(config.authTokenHash),
      authMode: 'pairing',
    },
    status,
    policy: DESKTOP_WEB_HOST_POLICY,
  };
}

export function currentApiBase(config: DesktopConfigFile): string {
  const profile =
    config.models.find((model) => model.name === config.activeModel) ?? config.models[0];
  if (!profile) {
    return '';
  }
  return resolveProfileApiBase(profile);
}

export function cloneChatArchive(archive: ChatArchive): ChatArchive {
  return {
    messages: archive.messages.map((message) => ({ ...message })),
    assistantAux: archive.assistantAux.map((entry) => ({ ...entry })),
    llmHistory: cloneArchiveHistory(archive.llmHistory),
    subagentSessions: cloneArchiveSubagentSessions(archive.subagentSessions ?? []),
  };
}

export function cloneArchiveHistory(history: ChatArchive['llmHistory']): ChatArchive['llmHistory'] {
  return history.map((message) => {
    if (Array.isArray(message.content)) {
      return {
        role: message.role,
        content: cloneLlmMessageContent(message.content),
        ...('toolCallId' in message && typeof message.toolCallId === 'string'
          ? { toolCallId: message.toolCallId }
          : {}),
        ...('toolCalls' in message && Array.isArray(message.toolCalls)
          ? {
              toolCalls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                name: toolCall.name,
                argumentsJson: toolCall.argumentsJson,
              })),
            }
          : {}),
        ...('providerState' in message
          && typeof message.providerState === 'object'
          && message.providerState !== null
          ? { providerState: cloneLlmProviderState(message.providerState) }
          : {}),
      };
    }

    return {
      role: message.role,
      content: message.content,
      imagePaths: [...(('imagePaths' in message ? message.imagePaths : []) ?? [])],
      videoPaths: [
        ...((('videoPaths' in message && Array.isArray(message.videoPaths))
          ? message.videoPaths
          : []) ?? []),
      ],
      ...('toolCallId' in message && typeof message.toolCallId === 'string'
        ? { toolCallId: message.toolCallId }
        : {}),
      ...('toolCalls' in message && Array.isArray(message.toolCalls)
        ? {
            toolCalls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              name: toolCall.name,
              argumentsJson: toolCall.argumentsJson,
            })),
          }
        : {}),
      ...('providerState' in message
        && typeof message.providerState === 'object'
        && message.providerState !== null
        ? { providerState: cloneLlmProviderState(message.providerState) }
        : {}),
    };
  });
}

export function cloneArchiveSubagentSessions(
  sessions: NonNullable<ChatArchive['subagentSessions']>,
): NonNullable<ChatArchive['subagentSessions']> {
  return sessions.map((entry) => ({
    summary: { ...entry.summary },
    llmHistory: cloneArchiveHistory(entry.llmHistory),
  }));
}

export function archiveBeforeLastUser(archive: ChatArchive): ChatArchive {
  const cloned = cloneChatArchive(archive);
  const messageIndex = findLastIndex(cloned.messages, (message) => message.role === 'user');
  const historyIndex = findLastIndex(cloned.llmHistory, (message) => message.role === 'user');
  return {
    ...cloned,
    messages: messageIndex >= 0 ? cloned.messages.slice(0, messageIndex) : cloned.messages,
    assistantAux:
      messageIndex >= 0
        ? cloned.assistantAux.filter((entry) => entry.messageIndex < messageIndex)
        : cloned.assistantAux,
    llmHistory: historyIndex >= 0 ? cloned.llmHistory.slice(0, historyIndex) : cloned.llmHistory,
  };
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index]!)) {
      return index;
    }
  }
  return -1;
}

export function toRuntimeAskQuestionsResult(
  result: AskQuestionsResult,
): RuntimeAskQuestionsResult {
  if (result.status === 'skipped') {
    return { status: 'skipped' };
  }

  return {
    status: 'answered',
    answers: result.answers ?? [],
  };
}

export function mapPendingQuestions(
  pending: RuntimePendingQuestions<DesktopToolRequest>,
): PendingQuestionsSnapshot {
  return {
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    request: {
      ...(pending.questions.title ? { title: pending.questions.title } : {}),
      questions: pending.questions.questions.map((question) => ({
        id: question.id,
        title: question.title,
        kind: question.kind,
        required: question.required === true,
        options: (question.options ?? []).map((option) => ({
          label: option.label,
          ...(option.summary ? { summary: option.summary } : {}),
        })),
        allowCustomInput: question.allowCustomInput === true,
        ...(question.customInputPlaceholder
          ? { customInputPlaceholder: question.customInputPlaceholder }
          : {}),
        ...(question.customInputLabel
          ? { customInputLabel: question.customInputLabel }
          : {}),
      })),
    },
  };
}

export function formatYamlScalarForSkillFrontmatter(value: string): string {
  const flat = value.replace(/\r?\n/g, ' ').trim() || i18n.t('common.description');
  return `"${flat.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

