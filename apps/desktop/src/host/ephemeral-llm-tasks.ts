import {
  appendLlmToolResultMessages,
  buildDreamReadHostToolDefinitions,
  createLlmTransport,
  extractLastLlmAssistantText,
  startLlmToolAgentState,
  type LlmExtensionSystemPrompt,
  type LlmToolAgentBasicInfo,
  type LlmTransportConfig,
} from '@spirit-agent/agent-core';

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
  parseGeneratedWorktreeNamingResponse,
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
  activeProfile?: ModelProfileSnapshot;
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
    const assistantText = await runEphemeralToolAgentRounds({
      context,
      transportConfig,
      prompt,
      failurePrefixKey: 'error.autoWorktreeNameFailed',
      noBodyKey: 'error.autoWorktreeNameFailedNoBody',
      interactiveToolKey: 'error.autoWorktreeNameFailedInteractiveTool',
      incompleteKey: 'error.autoWorktreeNameFailedIncomplete',
    });
    const names = parseGeneratedWorktreeNamingResponse(assistantText);
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
    model: context.config.activeModel,
    baseUrl: currentApiBase(context.config),
    workspaceRoot: context.workspaceRoot,
    profile: context.activeProfile,
    agentMode: resolveDesktopAgentMode(context.config),
  });
}

async function runEphemeralToolAgentRounds(input: {
  context: EphemeralLlmTaskContext;
  transportConfig: LlmTransportConfig;
  prompt: string;
  failurePrefixKey: string;
  noBodyKey: string;
  interactiveToolKey: string;
  incompleteKey: string;
}): Promise<string> {
  const { context, transportConfig } = input;
  const llmTransport = createLlmTransport(transportConfig);
  context.toolExecutor.setActiveTransportConfig(transportConfig);
  const dreamContextText = await buildDreamContextText({
    workspaceRoot: context.workspaceRoot,
    gitBranch: context.gitBranch,
  });
  const dreamToolDefinitions = context.gitBranch ? buildDreamReadHostToolDefinitions() : [];
  let toolState = startLlmToolAgentState(
    [],
    input.prompt,
    context.workspaceRoot,
    context.metadata.rules.enabledRules,
    context.metadata.skills.enabledSkillCatalog,
    [],
    transportConfig.model,
    context.metadata.planMetadata,
    context.extensionSystemPrompts,
    dreamContextText || undefined,
    undefined,
    context.runtimeBasicInfo,
  );

  for (let round = 0; round < 6; round += 1) {
    const completion = await llmTransport.startToolAgentRound(
      transportConfig,
      toolState,
      dreamToolDefinitions,
    );

    if (completion.kind !== 'success') {
      throw new Error(i18n.t(input.failurePrefixKey, { error: completion.error }));
    }

    toolState = completion.result.state;

    if (completion.result.step.kind === 'final-response-ready') {
      const assistantText = extractLastLlmAssistantText(toolState)?.trim();
      if (!assistantText) {
        throw new Error(i18n.t(input.noBodyKey));
      }
      return assistantText;
    }

    const toolResults = [];
    for (const call of completion.result.step.calls) {
      const request = await context.toolExecutor.requestFromFunctionCall(call.name, call.argumentsJson);
      const requestWithMetadata = context.toolExecutor.attachRequestMetadata
        ? context.toolExecutor.attachRequestMetadata(request, {
            toolCallId: call.id,
            toolName: call.name,
          })
        : request;
      const authorization = await context.toolExecutor.authorize(requestWithMetadata);
      if (authorization.kind !== 'allowed') {
        throw new Error(i18n.t(input.interactiveToolKey, { name: call.name }));
      }
      const output = await context.toolExecutor.execute(requestWithMetadata);
      toolResults.push({
        toolCallId: call.id,
        content: output.summaryText,
      });
    }

    toolState = appendLlmToolResultMessages(toolState, toolResults);
  }

  throw new Error(i18n.t(input.incompleteKey));
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
