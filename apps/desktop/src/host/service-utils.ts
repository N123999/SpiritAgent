import type {
  AskQuestionsResult as RuntimeAskQuestionsResult,
  ChatArchive,
  RuntimeApprovalDecision,
  RuntimePendingQuestions,
} from '@spirit-agent/agent-core';

import type {
  AskQuestionsResult,
  DesktopDreamCollectorSnapshot,
  DesktopModelProvider,
  DesktopWebHostSnapshot,
  PendingQuestionsSnapshot,
} from '../types.js';
import type { DesktopToolRequest } from './contracts.js';
import {
  type DesktopConfigFile,
  type DesktopWebHostConfigFile,
  mergeRecentWorkspaceRoots,
} from './storage.js';
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

export function deriveWorkspaceLabel(workspaceRoot: string): string {
  const normalized = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/g, '');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) || normalized : normalized;
}

export function buildAvailableWorkspaces(currentWorkspaceRoot: string, recentWorkspaces?: string[]) {
  return mergeRecentWorkspaceRoots(recentWorkspaces, currentWorkspaceRoot).map((workspaceRoot) => ({
    path: workspaceRoot,
    label: deriveWorkspaceLabel(workspaceRoot),
  }));
}

export function cloneDesktopConfig(config: DesktopConfigFile): DesktopConfigFile {
  return JSON.parse(JSON.stringify(config)) as DesktopConfigFile;
}

export function normalizeGeneratedCommitMessage(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('自动生成提交信息失败：模型未返回 message 字段。');
  }

  const normalized = value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  if (!normalized) {
    throw new Error('自动生成提交信息失败：模型返回了空 message。');
  }

  return normalized;
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
  return (
    config.models.find((model) => model.name === config.activeModel)?.apiBase ||
    config.models[0]?.apiBase ||
    ''
  );
}

export function cloneChatArchive(archive: ChatArchive): ChatArchive {
  return {
    messages: archive.messages.map((message) => ({ ...message })),
    assistantAux: archive.assistantAux.map((entry) => ({ ...entry })),
    llmHistory: archive.llmHistory.map((message) => ({
      role: message.role,
      content: message.content,
      imagePaths: [...message.imagePaths],
    })),
    subagentSessions: (archive.subagentSessions ?? []).map((entry) => ({
      summary: { ...entry.summary },
      llmHistory: entry.llmHistory.map((message) => ({
        role: message.role,
        content: message.content,
        imagePaths: [...message.imagePaths],
      })),
    })),
  };
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

export function parseApprovalDecision(message: string): RuntimeApprovalDecision {
  const trimmed = message.trim().toLowerCase();
  if (!trimmed || trimmed === 'y' || trimmed === 'yes' || trimmed === 'approve') {
    return { kind: 'allow' };
  }
  if (trimmed === 't' || trimmed === 'trust') {
    return { kind: 'allow', persistTrust: true };
  }
  if (trimmed === 'n' || trimmed === 'no' || trimmed === 'deny') {
    return { kind: 'deny' };
  }
  return {
    kind: 'guidance',
    userMessage: message,
  };
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
  const flat = value.replace(/\r?\n/g, ' ').trim() || '说明';
  return `"${flat.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

export function parseAddModelProvider(value: unknown): DesktopModelProvider | undefined {
  if (value === 'deepseek' || value === 'kimi' || value === 'minimax' || value === 'custom') {
    return value;
  }
  return undefined;
}
