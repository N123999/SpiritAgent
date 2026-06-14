import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  createLlmTransport,
  type AnthropicTransportConfig,
  type LlmModelCapabilities,
  type LlmPlanMetadata,
  type LlmTransportConfig,
} from '@spirit-agent/core';
import {
  resolveAnthropicTransportReasoningEffortForContext,
  resolveOpenAiTransportReasoningEffortForContext,
} from '@spirit-agent/core/reasoning-effort';
import {
  buildAutomationTriggerMessage,
  createHostAutomationStore,
  defaultAutomationRunTriggerContext,
  type AutomationRunTriggerContext,
  type HostAutomationDefinition,
  type HostAutomationRun,
} from '@spirit-agent/host-internal';
import {
  AutomationConversationProjection,
  runAutomationStreamingTurn,
} from './automation-conversation-projection.js';

import type { DesktopModelCapability } from '../types.js';
import { createDesktopRewindMetadata } from './rewind.js';
import { buildStoredDesktopSession } from './sessions.js';
import {
  chatsDirPath,
  loadHostMetadata,
  resolveApiKeyForConfigModel,
  saveStoredSession,
  spiritAgentDataDir,
  type DesktopConfigFile,
} from './storage.js';
import { DesktopToolExecutor } from './tool-executor.js';
import { buildDesktopRuntimeBasicInfo, createDesktopRuntime, type DesktopRuntime } from './runtime.js';
import { currentApiBase } from './service-utils.js';

export const AUTOMATION_SESSION_FILE_PREFIX = 'chat-automation-';
export const AUTOMATION_RUN_MAX_GUARD_ROUNDS = 200;

export interface RunDesktopAutomationOnceInput {
  definition: HostAutomationDefinition;
  config: DesktopConfigFile;
  triggerContext?: AutomationRunTriggerContext;
}

export interface RunDesktopAutomationOnceDeps {
  onRunUpdated?(automationId: string): void;
  notifySessionListUpdated?(): void;
  syncSessionFromDisk?(sessionPath: string): void | Promise<void>;
}

export async function runDesktopAutomationOnce(
  input: RunDesktopAutomationOnceInput,
  deps: RunDesktopAutomationOnceDeps,
): Promise<HostAutomationRun | undefined> {
  const store = createHostAutomationStore(spiritAgentDataDir());
  const activeRun = await store.getActiveRun(input.definition.id);
  if (activeRun) {
    return undefined;
  }

  const runId = randomUUID();
  const startedAtUnixMs = Date.now();
  const sessionPath = path.join(
    chatsDirPath(),
    `${AUTOMATION_SESSION_FILE_PREFIX}${input.definition.id.slice(0, 8)}-${startedAtUnixMs}.json`,
  );

  let run = await store.addRun(input.definition.id, {
    id: runId,
    automationId: input.definition.id,
    sessionPath,
    status: 'running',
    startedAtUnixMs,
  });
  deps.onRunUpdated?.(input.definition.id);

  try {
    const apiKey = await resolveApiKeyForConfigModel(input.config, input.definition.modelName);
    if (!apiKey) {
      throw new Error(`Missing API key for model: ${input.definition.modelName}`);
    }

    const profile = input.config.models.find((model) => model.name === input.definition.modelName);
    const gitSnapshot = await readGitWorkspaceSnapshot(input.definition.workspaceRoot);
    const metadata = await loadHostMetadata(input.definition.workspaceRoot, 'agent', {
      workspaceBinding: 'project',
    });
    const planMetadata: LlmPlanMetadata = {
      ...metadata.planMetadata,
      agentMode: 'agent',
      planMode: false,
    } as LlmPlanMetadata;

    const transportConfig = buildAutomationTransportConfig({
      apiKey,
      model: input.definition.modelName,
      baseUrl: profile?.apiBase ?? currentApiBase(input.config),
      workspaceRoot: input.definition.workspaceRoot,
      profile,
      reasoningEffort: input.definition.reasoningEffort ?? profile?.reasoningEffort,
    });

    const toolExecutor = new DesktopToolExecutor(input.definition.workspaceRoot);
    toolExecutor.setApprovalLevel(input.definition.approvalLevel);
    toolExecutor.setActiveTransportConfig(transportConfig);
    const runtime = createDesktopRuntime({
      transportConfig,
      history: [],
      enabledRules: metadata.rules.enabledRules,
      enabledSkillCatalog: metadata.skills.enabledSkillCatalog,
      planMetadata,
      extensionSystemPrompts: [],
      toolExecutor,
      llmTransport: createLlmTransport(transportConfig),
      activeSkills: [],
      workspaceRoot: input.definition.workspaceRoot,
      basicInfo: buildDesktopRuntimeBasicInfo(input.definition.workspaceRoot, toolExecutor),
    });
    const triggerContext = input.triggerContext ?? defaultAutomationRunTriggerContext(input.definition);
    const llmUserMessage = buildAutomationTriggerMessage({
      overview: input.definition.overview,
      trigger: input.definition.trigger,
      context: triggerContext,
    });

    const projection = AutomationConversationProjection.create();
    projection.bindRuntime(runtime);
    projection.beginUserTurn(input.definition.overview);

    await persistAutomationSession(deps, {
      sessionPath,
      definition: input.definition,
      runId,
      runtime,
      projection,
      workspaceRoot: input.definition.workspaceRoot,
      gitBranch: gitSnapshot.branch,
      sessionDisplayName: `${input.definition.title} · ${formatRunTimestamp(startedAtUnixMs)}`,
      approvalLevel: input.definition.approvalLevel,
    });
    deps.notifySessionListUpdated?.();

    let result = await runAutomationStreamingTurn(
      runtime,
      projection,
      async () => {
        await runtime.startUserTurnStreaming(llmUserMessage);
      },
    );

    for (let guard = 0; guard < AUTOMATION_RUN_MAX_GUARD_ROUNDS; guard += 1) {
      if (result.kind === 'requires-approval') {
        if (input.definition.approvalLevel === 'full-approval') {
          result = await runAutomationStreamingTurn(
            runtime,
            projection,
            async () => {
              await runtime.continuePendingApproval({ kind: 'allow' });
            },
          );
          continue;
        }
        run = await store.updateRun(input.definition.id, runId, { status: 'blocked' });
        await persistAutomationSession(deps, {
          sessionPath,
          definition: input.definition,
          runId,
          runtime,
          projection,
          workspaceRoot: input.definition.workspaceRoot,
          gitBranch: gitSnapshot.branch,
          sessionDisplayName: `${input.definition.title} · ${formatRunTimestamp(startedAtUnixMs)}`,
          approvalLevel: input.definition.approvalLevel,
        });
        deps.onRunUpdated?.(input.definition.id);
        deps.notifySessionListUpdated?.();
        return run;
      }
      if (result.kind === 'requires-questions') {
        if (input.definition.approvalLevel === 'full-approval') {
          result = await runAutomationStreamingTurn(
            runtime,
            projection,
            async () => {
              await runtime.continuePendingQuestions({ status: 'skipped' });
            },
          );
          continue;
        }
        run = await store.updateRun(input.definition.id, runId, { status: 'blocked' });
        await persistAutomationSession(deps, {
          sessionPath,
          definition: input.definition,
          runId,
          runtime,
          projection,
          workspaceRoot: input.definition.workspaceRoot,
          gitBranch: gitSnapshot.branch,
          sessionDisplayName: `${input.definition.title} · ${formatRunTimestamp(startedAtUnixMs)}`,
          approvalLevel: input.definition.approvalLevel,
        });
        deps.onRunUpdated?.(input.definition.id);
        deps.notifySessionListUpdated?.();
        return run;
      }
      if (result.kind === 'failed') {
        throw new Error(result.error);
      }
      break;
    }

    if (result.kind !== 'completed') {
      throw new Error(`Automation run did not complete: ${result.kind}`);
    }

    await persistAutomationSession(deps, {
      sessionPath,
      definition: input.definition,
      runId,
      runtime,
      projection,
      workspaceRoot: input.definition.workspaceRoot,
      gitBranch: gitSnapshot.branch,
      sessionDisplayName: `${input.definition.title} · ${formatRunTimestamp(startedAtUnixMs)}`,
      approvalLevel: input.definition.approvalLevel,
    });

    run = await store.updateRun(input.definition.id, runId, {
      status: 'completed',
      completedAtUnixMs: Date.now(),
    });
    deps.onRunUpdated?.(input.definition.id);
    deps.notifySessionListUpdated?.();
    return run;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    run = await store.updateRun(input.definition.id, runId, {
      status: 'failed',
      completedAtUnixMs: Date.now(),
      error: message,
    });
    deps.onRunUpdated?.(input.definition.id);
    deps.notifySessionListUpdated?.();
    return run;
  }
}

async function notifyAutomationSessionPersisted(
  deps: RunDesktopAutomationOnceDeps,
  sessionPath: string,
): Promise<void> {
  if (!deps.syncSessionFromDisk) {
    return;
  }
  await deps.syncSessionFromDisk(sessionPath);
}

async function persistAutomationSession(
  deps: RunDesktopAutomationOnceDeps,
  input: {
  sessionPath: string;
  definition: HostAutomationDefinition;
  runId: string;
  runtime: DesktopRuntime;
  projection: AutomationConversationProjection;
  workspaceRoot: string;
  gitBranch?: string;
  sessionDisplayName: string;
  approvalLevel: HostAutomationDefinition['approvalLevel'];
  },
): Promise<void> {
  const desktopMessages = input.projection.toMessages();
  const archivePayload = input.projection.buildArchivePayload();
  const archive = input.runtime.toArchive(archivePayload.messages, archivePayload.assistantAux);
  const timelineSnapshot = input.projection.timelineSnapshot();

  await saveStoredSession(
    input.sessionPath,
    buildStoredDesktopSession({
      archive,
      savedAtUnixMs: Date.now(),
      sessionDisplayName: input.sessionDisplayName,
      sessionTitleSource: 'seed',
      workspaceRoot: input.workspaceRoot,
      ...(input.gitBranch ? { gitBranch: input.gitBranch } : {}),
      desktopMessages,
      desktopMessageTimeline: timelineSnapshot,
      rewind: createDesktopRewindMetadata(),
      loopEnabled: archive.loopEnabled === true,
      approvalLevel: input.approvalLevel,
      automationId: input.definition.id,
      automationRunId: input.runId,
    }),
  );
  await notifyAutomationSessionPersisted(deps, input.sessionPath);
}

function buildAutomationTransportConfig(input: {
  apiKey: string;
  model: string;
  baseUrl: string;
  workspaceRoot: string;
  profile?: DesktopConfigFile['models'][number];
  reasoningEffort?: DesktopConfigFile['models'][number]['reasoningEffort'];
}): LlmTransportConfig {
  const transportKind = input.profile?.transportKind
    ?? (input.profile?.provider === 'anthropic' ? 'anthropic' : 'openai-compatible');
  if (transportKind === 'anthropic') {
    const supportedAnthropicEfforts = normalizeAnthropicSupportedEfforts(
      input.profile?.supportedReasoningEfforts,
    );
    const anthropicEffort = resolveAnthropicTransportReasoningEffortForContext(
      input.reasoningEffort ?? input.profile?.reasoningEffort,
      {
        ...(input.profile?.provider ? { provider: input.profile.provider } : {}),
        ...(input.profile?.transportKind ? { transportKind: input.profile.transportKind } : {}),
        ...(input.profile?.supportedReasoningEfforts !== undefined
          ? { supportedEfforts: input.profile.supportedReasoningEfforts }
          : {}),
        model: input.model,
      },
    );
    return {
      transportKind: 'anthropic',
      apiKey: input.apiKey,
      model: input.model,
      baseUrl: input.baseUrl,
      workspaceRoot: input.workspaceRoot,
      ...(input.profile?.capabilities
        ? { modelCapabilities: automationModelCapabilities(input.profile.capabilities) }
        : {}),
      ...(supportedAnthropicEfforts !== undefined
        ? { supportedEfforts: supportedAnthropicEfforts }
        : {}),
      ...(anthropicEffort ? { effort: anthropicEffort } : {}),
    };
  }

  const llmVendor = input.profile?.provider && input.profile.provider !== 'anthropic'
    ? input.profile.provider
    : undefined;
  const normalizedReasoningEffort = resolveOpenAiTransportReasoningEffortForContext(
    input.reasoningEffort ?? input.profile?.reasoningEffort,
    {
      ...(input.profile?.provider ? { provider: input.profile.provider } : {}),
      ...(input.profile?.transportKind ? { transportKind: input.profile.transportKind } : {}),
      ...(input.profile?.supportedReasoningEfforts !== undefined
        ? { supportedEfforts: input.profile.supportedReasoningEfforts }
        : {}),
      model: input.model,
    },
  );
  return {
    apiKey: input.apiKey,
    model: input.model,
    baseUrl: input.baseUrl,
    workspaceRoot: input.workspaceRoot,
    ...(llmVendor ? { llmVendor } : {}),
    ...(input.profile?.capabilities
      ? { modelCapabilities: automationModelCapabilities(input.profile.capabilities) }
      : {}),
    ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
  };
}

function normalizeAnthropicSupportedEfforts(
  efforts?: readonly string[],
): AnthropicTransportConfig['supportedEfforts'] {
  if (efforts === undefined) {
    return undefined;
  }
  return efforts.filter((effort): effort is NonNullable<AnthropicTransportConfig['supportedEfforts']>[number] => (
    effort === 'low'
    || effort === 'medium'
    || effort === 'high'
    || effort === 'xhigh'
    || effort === 'max'
  ));
}

function automationModelCapabilities(
  capabilities: readonly DesktopModelCapability[],
): LlmModelCapabilities {
  return {
    ...(capabilities.includes('chat') ? { chat: true } : {}),
    ...(capabilities.includes('image') ? { imageInput: true } : {}),
    ...(capabilities.includes('imageGeneration') ? { imageGeneration: true } : {}),
  };
}

function formatRunTimestamp(unixMs: number): string {
  const date = new Date(unixMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
