import {
  buildDreamReadHostToolDefinitions,
  type LlmExtensionSystemPrompt,
  type LlmToolAgentBasicInfo,
  type LlmTransportConfig,
} from '@spirit-agent/core';
import { generateWorktreeNamesFromTask } from '@spirit-agent/host-internal';

import i18n from '../lib/i18n-host.js';
import { resolveDesktopAgentMode } from '../lib/agent-mode.js';
import type {
  ConversationMessageSnapshot,
  ModelProfileSnapshot,
} from '../types.js';
import {
  buildWorktreeEphemeralSessionRecord,
  createEphemeralWorktreeSessionPath,
  type EphemeralSessionRecord,
} from './sessions.js';
import {
  currentApiBase,
} from './service-utils.js';
import type {
  DesktopConfigFile,
  HostMetadataSummary,
} from './storage.js';
import { buildPrimaryTransportConfig } from './model-config.js';
import { buildDreamContextText } from './dreams.js';
import type { DesktopToolExecutor } from './tool-executor.js';
import { buildWorktreeNamingPrompt, type GeneratedWorktreeNames } from './worktree-naming.js';

interface EphemeralLlmTaskContext {
  workspaceRoot: string;
  gitBranch?: string;
  config: DesktopConfigFile;
  taskModel: string;
  taskProfile?: ModelProfileSnapshot;
  apiKey: string;
  metadata: HostMetadataSummary;
  extensionSystemPrompts: LlmExtensionSystemPrompt[];
  toolExecutor: DesktopToolExecutor;
  runtimeBasicInfo: LlmToolAgentBasicInfo;
  rememberEphemeralSession(record: EphemeralSessionRecord): void;
}

export async function generateWorktreeNamesFromModelTask(
  context: EphemeralLlmTaskContext & {
    userPrompt: string;
    baseBranch: string;
    repoRoot: string;
  },
): Promise<GeneratedWorktreeNames> {
  const prompt = buildWorktreeNamingPrompt({
    userPrompt: context.userPrompt,
    baseBranch: context.baseBranch,
    repoRoot: context.repoRoot,
  });
  const transportConfig = buildTaskTransportConfig(context);
  const sessionPath = createEphemeralWorktreeSessionPath();
  const baseMessages = buildBaseMessages(prompt);

  try {
    const dreamContextText = await buildDreamContextText({
      workspaceRoot: context.workspaceRoot,
      gitBranch: context.gitBranch,
    });
    const names = await generateWorktreeNamesFromTask({
      transport: transportConfig,
      task: context.userPrompt,
      baseBranch: context.baseBranch,
      repoRoot: context.repoRoot,
      workspaceRoot: context.workspaceRoot,
      toolExecutor: context.toolExecutor,
      enabledRules: context.metadata.rules.enabledRules,
      enabledSkillCatalog: context.metadata.skills.enabledSkillCatalog,
      extensionSystemPrompts: context.extensionSystemPrompts,
      planMetadata: context.metadata.planMetadata,
      runtimeBasicInfo: context.runtimeBasicInfo,
      ...(dreamContextText ? { dreamContextText } : {}),
      extraToolDefinitions: context.gitBranch ? buildDreamReadHostToolDefinitions() : [],
      errorMessages: {
        failurePrefix: (error) => i18n.t('error.autoWorktreeNameFailed', { error }),
        noBody: i18n.t('error.autoWorktreeNameFailedNoBody'),
        interactiveTool: (name) => i18n.t('error.autoWorktreeNameFailedInteractiveTool', { name }),
        incomplete: i18n.t('error.autoWorktreeNameFailedIncomplete'),
      },
    });
    context.rememberEphemeralSession(buildWorktreeEphemeralSessionRecord({
      path: sessionPath,
      displayName: `[Worktree] ${names.worktreeName}`,
      workspaceRoot: context.workspaceRoot,
      messages: [
        ...baseMessages,
        buildAssistantMessage(JSON.stringify(names)),
      ],
    }));
    return names;
  } catch (error) {
    context.rememberEphemeralSession(buildWorktreeEphemeralSessionRecord({
      path: sessionPath,
      displayName: i18n.t('error.worktreeAutoGenFailed'),
      workspaceRoot: context.workspaceRoot,
      messages: [
        ...baseMessages,
        buildAssistantMessage(generationFailureMessage(error)),
      ],
    }));
    throw error;
  }
}

function buildTaskTransportConfig(context: EphemeralLlmTaskContext): LlmTransportConfig {
  return buildPrimaryTransportConfig({
    apiKey: context.apiKey,
    model: context.taskModel,
    baseUrl: currentApiBase(context.config),
    workspaceRoot: context.workspaceRoot,
    profile: context.taskProfile,
    agentMode: resolveDesktopAgentMode(context.config),
  });
}

function buildBaseMessages(prompt: string): ConversationMessageSnapshot[] {
  return [
    {
      id: 1,
      role: 'user',
      content: prompt,
      pending: false,
    },
  ];
}

function buildAssistantMessage(content: string): ConversationMessageSnapshot {
  return {
    id: 2,
    role: 'assistant',
    content,
    pending: false,
  };
}

function generationFailureMessage(error: unknown): string {
  return i18n.t('error.generationFailed', {
    message: error instanceof Error ? error.message : String(error),
  });
}
