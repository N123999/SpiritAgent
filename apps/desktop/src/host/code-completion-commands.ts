import { createJsonSchemaTransport } from '@spirit-agent/core';
import { CodeCompletionService } from '@spirit-agent/host-internal';
import type { CodeCompletionResult } from '@spirit-agent/core';

import { resolveDesktopAgentMode } from '../lib/agent-mode.js';
import { resolveLightweightChatModelProfile } from './lightweight-chat-model.js';
import { buildCodeCompletionTransportConfig } from './model-config.js';
import { currentApiBase } from './service-utils.js';
import type { DesktopConfigFile } from './storage.js';
import { resolveApiKeyForConfigModel } from './storage.js';
import type {
  RecordCodeCompletionFileStateRequest,
  RequestCodeCompletionRequest,
} from '../types.js';

const servicesByWorkspaceRoot = new Map<string, CodeCompletionService>();
const abortControllersByWorkspaceRoot = new Map<string, AbortController>();

export interface CodeCompletionCommandContext {
  workspaceRoot: string;
  config: DesktopConfigFile;
}

function codeCompletionEnabled(config: DesktopConfigFile): boolean {
  return config.agents.codeCompletion.enabled;
}

function getService(workspaceRoot: string): CodeCompletionService {
  const existing = servicesByWorkspaceRoot.get(workspaceRoot);
  if (existing) {
    return existing;
  }
  const created = new CodeCompletionService();
  servicesByWorkspaceRoot.set(workspaceRoot, created);
  return created;
}

export function clearCodeCompletionStateForWorkspace(workspaceRoot: string): void {
  servicesByWorkspaceRoot.delete(workspaceRoot);
  abortControllersByWorkspaceRoot.get(workspaceRoot)?.abort();
  abortControllersByWorkspaceRoot.delete(workspaceRoot);
}

function beginCompletionRequest(workspaceRoot: string): AbortSignal {
  abortControllersByWorkspaceRoot.get(workspaceRoot)?.abort();
  const controller = new AbortController();
  abortControllersByWorkspaceRoot.set(workspaceRoot, controller);
  return controller.signal;
}

function endCompletionRequest(workspaceRoot: string, signal: AbortSignal): void {
  const active = abortControllersByWorkspaceRoot.get(workspaceRoot);
  if (active?.signal === signal) {
    abortControllersByWorkspaceRoot.delete(workspaceRoot);
  }
}

export function abortCodeCompletionCommand(workspaceRoot: string): void {
  abortControllersByWorkspaceRoot.get(workspaceRoot)?.abort();
  abortControllersByWorkspaceRoot.delete(workspaceRoot);
}

export async function requestCodeCompletionCommand(
  context: CodeCompletionCommandContext,
  request: RequestCodeCompletionRequest,
): Promise<CodeCompletionResult> {
  if (!codeCompletionEnabled(context.config)) {
    return { operations: [] };
  }

  const signal = beginCompletionRequest(context.workspaceRoot);
  try {
    const resolved = resolveLightweightChatModelProfile(context.config);
    if (!resolved) {
      return { operations: [] };
    }

    const apiKey = await resolveApiKeyForConfigModel(context.config, resolved.name);
    if (!apiKey) {
      return { operations: [] };
    }

    const transportConfig = buildCodeCompletionTransportConfig({
      apiKey,
      model: resolved.name,
      baseUrl: resolved.profile.apiBase ?? currentApiBase(context.config),
      workspaceRoot: context.workspaceRoot,
      profile: resolved.profile,
      agentMode: resolveDesktopAgentMode(context.config),
    });
    const transport = createJsonSchemaTransport(transportConfig);
    const service = getService(context.workspaceRoot);

    const result = await service.request(
      {
        workspaceRoot: context.workspaceRoot,
        relativePath: request.relativePath,
        languageId: request.languageId,
        documentText: request.documentText,
        cursorLine: request.cursorLine,
        cursorColumn: request.cursorColumn,
        signal,
      },
      {
        transport,
        transportConfig,
        modelName: resolved.name,
      },
    );

    return result ?? { operations: [] };
  } catch (error) {
    if (signal.aborted) {
      return { operations: [] };
    }
    console.debug('[code-completion] request failed:', error);
    return { operations: [] };
  } finally {
    endCompletionRequest(context.workspaceRoot, signal);
  }
}

export function recordCodeCompletionFileStateCommand(
  context: CodeCompletionCommandContext,
  request: RecordCodeCompletionFileStateRequest,
): void {
  if (!codeCompletionEnabled(context.config)) {
    return;
  }
  getService(context.workspaceRoot).recordFileState({
    relativePath: request.relativePath,
    baselineText: request.baselineText,
    currentText: request.currentText,
  });
}

export function resetCodeCompletionJournalCommand(context: CodeCompletionCommandContext): void {
  getService(context.workspaceRoot).clearJournal();
}
