import { stdin, stdout } from 'node:process';

import {
  appendOpenAiToolResultMessage,
  appendOpenAiUserMessage,
  extractLastOpenAiAssistantText,
  OpenAiTransport,
  rebuildOpenAiToolAgentStateAfterCompaction,
  startOpenAiToolAgentState,
  truncateOpenAiHistoryForCompaction,
  truncateOpenAiToolAgentStateForContextRetry,
  type OpenAiToolAgentState,
  type OpenAiTransportConfig,
} from './openai/transport.js';
import type {
  JsonValue,
  LlmMessage,
  McpStatusSnapshot,
} from './ports.js';
import {
  AgentRuntime,
  pendingWorkspaceFilesFromInput,
  type PendingAssistantAux,
  type PendingMcpResource,
  type RuntimeApprovalDecision,
  type RuntimeEvent,
  type RuntimePendingApproval,
} from './runtime.js';
import { JsonRpcPeer } from './host-bridge/framing.js';
import { HostToolExecutorProxy } from './host-bridge/host-tool-executor.js';
import type {
  BridgeRuntimeSnapshot,
  DrainEventsResult,
  RuntimeAddPendingImageParams,
  RuntimeApplyMcpPromptParams,
  RuntimeAttachMcpResourceParams,
  RuntimeInitParams,
  RuntimeReplaceConfigParams,
  RuntimeRespondToPendingApprovalParams,
  RuntimeStartManualToolCommandParams,
  RuntimeSubmitUserTurnParams,
} from './host-bridge/protocol.js';

type HostRuntime = AgentRuntime<OpenAiTransportConfig, OpenAiToolAgentState, JsonValue, JsonValue>;

interface ToolExecutionMetadata {
  backgroundExecution: boolean;
  backgroundStatusText?: string;
}

const peer = new JsonRpcPeer(stdin, stdout);
const toolExecutor = new HostToolExecutorProxy(peer);
let runtime: HostRuntime | undefined;
let transportConfig: OpenAiTransportConfig | undefined;
const llmTransport = new OpenAiTransport();

function requireRuntime(): HostRuntime {
  if (!runtime) {
    throw new Error('runtime 尚未初始化，请先调用 runtime.init');
  }

  return runtime;
}

async function createRuntime(config: OpenAiTransportConfig, history: LlmMessage[] = []): Promise<HostRuntime> {
  const workspaceRoot = config.workspaceRoot ?? process.cwd();
  await toolExecutor.refreshCaches();
  const createToolAgentState = (messages: LlmMessage[], userInput: string) =>
    startOpenAiToolAgentState(messages, userInput, workspaceRoot);

  return new AgentRuntime({
    config,
    llmTransport,
    toolExecutor,
    createToolAgentState,
    appendToolResultMessage: appendOpenAiToolResultMessage,
    appendUserMessage: appendOpenAiUserMessage,
    extractAssistantText: extractLastOpenAiAssistantText,
    truncateStateForContextRetry: truncateOpenAiToolAgentStateForContextRetry,
    truncateHistoryForCompaction: truncateOpenAiHistoryForCompaction,
    rebuildRetryStateAfterCompaction: (messages, userInput, retryState) =>
      rebuildOpenAiToolAgentStateAfterCompaction(messages, userInput, retryState, workspaceRoot),
    resolveWorkspaceFilesFromInput: (text) => pendingWorkspaceFilesFromInput(workspaceRoot, text),
  }, history);
}

function buildSnapshot(target: HostRuntime): BridgeRuntimeSnapshot {
  const pendingUserTurn = target.pendingUserTurn();
  const pendingAuxState = target.pendingAuxState();
  const currentPendingApproval = target.currentPendingApproval();
  const backgroundToolStatus = target.backgroundToolStatus();

  return {
    history: target.history().map((message) => ({
      role: message.role,
      content: message.content,
      imagePaths: [...(message.imagePaths ?? [])],
    })),
    requestTrace: [...target.requestTrace()],
    ...(pendingUserTurn !== undefined ? { pendingUserTurn } : {}),
    pendingImagePaths: [...target.pendingImagePaths()],
    pendingMcpResources: target.pendingMcpResources().map((resource) => ({
      server: resource.server,
      displayName: resource.displayName,
      uri: resource.uri,
      ...(resource.mimeType !== undefined ? { mimeType: resource.mimeType } : {}),
      readAtUnixMs: resource.readAtUnixMs,
      content: resource.content,
    })),
    ...(pendingAuxState !== undefined ? { pendingAuxState } : {}),
    hasPendingApproval: target.hasPendingApproval(),
    hasPendingManualApproval: target.hasPendingManualApproval(),
    ...(currentPendingApproval !== undefined ? { currentPendingApproval } : {}),
    isBusy: target.isBusy(),
    ...(backgroundToolStatus !== undefined ? { backgroundToolStatus } : {}),
  };
}

async function drainEvents(): Promise<DrainEventsResult> {
  const target = requireRuntime();
  return {
    events: target.drainEvents(),
    snapshot: buildSnapshot(target),
  };
}

peer.on('runtime.init', async (rawParams) => {
  const params = rawParams as RuntimeInitParams;
  transportConfig = params.transportConfig;
  runtime = await createRuntime(params.transportConfig, params.history ?? []);
  return buildSnapshot(runtime);
});

peer.on('runtime.replaceConfig', async (rawParams) => {
  const params = rawParams as RuntimeReplaceConfigParams;
  transportConfig = params.transportConfig;
  const target = requireRuntime();
  runtime = await createRuntime(params.transportConfig, [...target.history()]);
  return buildSnapshot(runtime);
});

peer.on('runtime.replaceHistory', async (rawParams) => {
  const history = rawParams as LlmMessage[];
  requireRuntime().replaceHistory(history);
  return buildSnapshot(requireRuntime());
});

peer.on('runtime.replaceFromArchive', async (archive) => {
  requireRuntime().replaceFromArchive(archive as never);
  return buildSnapshot(requireRuntime());
});

peer.on('runtime.submitUserTurn', async (rawParams) => {
  const params = rawParams as RuntimeSubmitUserTurnParams;
  await requireRuntime().startUserTurn(params.text, params.explicitImages ?? []);
  return null;
});

peer.on('runtime.startUserTurnStreaming', async (rawParams) => {
  const params = rawParams as RuntimeSubmitUserTurnParams;
  await requireRuntime().startUserTurnStreaming(params.text, params.explicitImages ?? []);
  return null;
});

peer.on('runtime.poll', async () => {
  await requireRuntime().poll();
  return null;
});

peer.on('runtime.drainEvents', async () => drainEvents());
peer.on('runtime.snapshot', async () => buildSnapshot(requireRuntime()));

peer.on('runtime.respondToPendingApproval', async (rawParams) => {
  const params = rawParams as RuntimeRespondToPendingApprovalParams;
  await requireRuntime().continuePendingApproval(params.decision);
  return null;
});

peer.on('runtime.startManualToolCommand', async (rawParams) => {
  const params = rawParams as RuntimeStartManualToolCommandParams;
  const result = await requireRuntime().startManualToolCommand(params.message);
  return {
    result,
    snapshot: buildSnapshot(requireRuntime()),
  };
});

peer.on('runtime.continuePendingManualToolApproval', async (rawParams) => {
  const params = rawParams as RuntimeRespondToPendingApprovalParams;
  const result = await requireRuntime().continuePendingManualToolApproval(params.decision);
  return {
    result,
    snapshot: buildSnapshot(requireRuntime()),
  };
});

peer.on('runtime.startManualHistoryCompaction', async () => {
  await requireRuntime().startManualHistoryCompaction();
  return null;
});

peer.on('runtime.addPendingImage', async (rawParams) => {
  const params = rawParams as RuntimeAddPendingImageParams;
  requireRuntime().addPendingImage(params.path);
  return buildSnapshot(requireRuntime());
});

peer.on('runtime.clearPendingImages', async () => requireRuntime().clearPendingImages());

peer.on('runtime.attachMcpResource', async (rawParams) => {
  const params = rawParams as RuntimeAttachMcpResourceParams;
  const label = await requireRuntime().attachMcpResource(params.server, params.uri);
  return {
    label,
    snapshot: buildSnapshot(requireRuntime()),
  };
});

peer.on('runtime.clearPendingMcpResources', async () => requireRuntime().clearPendingMcpResources());

peer.on('runtime.applyMcpPrompt', async (rawParams) => {
  const params = rawParams as RuntimeApplyMcpPromptParams;
  const notice = await requireRuntime().startApplyMcpPrompt(
    params.server,
    params.prompt,
    params.argsJson,
  );
  return { notice };
});

peer.on('runtime.handleStreamStallTimeout', async () => {
  requireRuntime().handleStreamStallTimeout();
  return null;
});

peer.on('runtime.tickThinkingSpinner', async () => {
  requireRuntime().tickThinkingSpinner();
  return buildSnapshot(requireRuntime());
});

peer.on('runtime.exportState', async () => {
  const target = requireRuntime();
  const config = transportConfig;
  if (!config) {
    throw new Error('transportConfig 尚未初始化。');
  }

  return {
    apiMessages: llmTransport.llmHistoryAsApiMessages([...target.history()]),
    systemPrompts: llmTransport.llmSystemPromptsForExport(),
  };
});

peer.start();