import { stdin, stdout } from 'node:process';

import {
  appendOpenAiToolResultMessage,
  appendOpenAiUserMessage,
  buildRulesSystemMessage,
  extractLastOpenAiAssistantText,
  OpenAiTransport,
  rebuildOpenAiToolAgentStateAfterCompaction,
  startOpenAiToolAgentState,
  truncateOpenAiHistoryForCompaction,
  truncateOpenAiToolAgentStateForContextRetry,
  type OpenAiEnabledRule,
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
  RuntimeExportArchiveParams,
  RuntimeAddPendingImageParams,
  RuntimeApplyMcpPromptParams,
  RuntimeAttachMcpResourceParams,
  RuntimeInitParams,
  RuntimeNamedMcpServerParams,
  RuntimeReplaceConfigParams,
  RuntimeReplaceRulesParams,
  RuntimeRespondToPendingApprovalParams,
  RuntimeStartManualMcpToolParams,
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
let enabledRules: OpenAiEnabledRule[] = [];
const llmTransport = new OpenAiTransport();

function logBridge(message: string, extra?: unknown): void {
  if (extra === undefined) {
    console.error(`[host-bridge] ${message}`);
    return;
  }

  console.error(`[host-bridge] ${message}`, extra);
}

function requireRuntime(): HostRuntime {
  if (!runtime) {
    throw new Error('runtime 尚未初始化，请先调用 runtime.init');
  }

  return runtime;
}

async function createRuntime(
  config: OpenAiTransportConfig,
  history: LlmMessage[] = [],
): Promise<HostRuntime> {
  const workspaceRoot = config.workspaceRoot ?? process.cwd();
  await toolExecutor.refreshCaches();
  logBridge('createRuntime', {
    workspaceRoot,
    historyCount: history.length,
    mcpState: toolExecutor.mcpStatusSnapshot().state,
    configuredServers: toolExecutor.mcpStatusSnapshot().configuredServers,
    cachedTools: toolExecutor.mcpStatusSnapshot().cachedTools,
  });
  const createToolAgentState = (messages: LlmMessage[], userInput: string) =>
    startOpenAiToolAgentState(messages, userInput, workspaceRoot, enabledRules);

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
      rebuildOpenAiToolAgentStateAfterCompaction(
        messages,
        userInput,
        retryState,
        workspaceRoot,
        enabledRules,
      ),
    resolveWorkspaceFilesFromInput: (text) => pendingWorkspaceFilesFromInput(workspaceRoot, text),
  }, history);
}

function buildSnapshot(target: HostRuntime): BridgeRuntimeSnapshot {
  const pendingUserTurn = target.pendingUserTurn();
  const pendingAuxState = target.pendingAuxState();
  const currentPendingApproval = target.currentPendingApproval();
  const backgroundToolStatus = target.backgroundToolStatus();

  return {
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
  await toolExecutor.refreshCaches();
  const events = target.drainEvents();
  if (events.length > 0) {
    logBridge('drainEvents', {
      count: events.length,
      kinds: events.map((event) => event.kind),
    });
  }
  return {
    events,
    snapshot: buildSnapshot(target),
  };
}

peer.on('runtime.init', async (rawParams) => {
  const params = rawParams as RuntimeInitParams;
  logBridge('runtime.init', { historyCount: params.history?.length ?? 0 });
  transportConfig = params.transportConfig;
  enabledRules = [...(params.enabledRules ?? [])];
  runtime = await createRuntime(params.transportConfig, params.history ?? []);
  return buildSnapshot(runtime);
});

peer.on('runtime.replaceConfig', async (rawParams) => {
  const params = rawParams as RuntimeReplaceConfigParams;
  logBridge('runtime.replaceConfig', { model: params.transportConfig.model });
  transportConfig = params.transportConfig;
  const target = requireRuntime();
  runtime = await createRuntime(params.transportConfig, [...target.history()]);
  return buildSnapshot(runtime);
});

peer.on('runtime.replaceRules', async (rawParams) => {
  const params = rawParams as RuntimeReplaceRulesParams;
  enabledRules = [...params.enabledRules];
  return buildSnapshot(requireRuntime());
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
  await toolExecutor.refreshCaches();
  logBridge('runtime.submitUserTurn(streaming)', {
    chars: Array.from(params.text).length,
    explicitImages: params.explicitImages?.length ?? 0,
    mcpState: toolExecutor.mcpStatusSnapshot().state,
    cachedTools: toolExecutor.mcpStatusSnapshot().cachedTools,
  });
  await requireRuntime().startUserTurnStreaming(params.text, params.explicitImages ?? []);
  return null;
});

peer.on('runtime.startUserTurnStreaming', async (rawParams) => {
  const params = rawParams as RuntimeSubmitUserTurnParams;
  await toolExecutor.refreshCaches();
  logBridge('runtime.startUserTurnStreaming', {
    chars: Array.from(params.text).length,
    explicitImages: params.explicitImages?.length ?? 0,
  });
  await requireRuntime().startUserTurnStreaming(params.text, params.explicitImages ?? []);
  return null;
});

peer.on('runtime.poll', async () => {
  await toolExecutor.refreshCaches();
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

peer.on('runtime.startManualMcpTool', async (rawParams) => {
  const params = rawParams as RuntimeStartManualMcpToolParams;
  const request = await toolExecutor.createMcpToolRequest(params.server, params.tool, params.argsJson);
  const result = await requireRuntime().startManualToolRequestDirect(request, 'manual');
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

peer.on('runtime.listMcpServers', async () => toolExecutor.listMcpServers());

peer.on('runtime.inspectMcpServer', async (rawParams) => {
  const params = rawParams as RuntimeNamedMcpServerParams;
  return toolExecutor.inspectMcpServer(params.name);
});

peer.on('runtime.listMcpTools', async (rawParams) => {
  const params = rawParams as RuntimeNamedMcpServerParams;
  return toolExecutor.listMcpTools(params.name);
});

peer.on('runtime.listMcpResources', async (rawParams) => {
  const params = rawParams as RuntimeNamedMcpServerParams;
  return toolExecutor.listMcpResources(params.name);
});

peer.on('runtime.readMcpResource', async (rawParams) => {
  const params = rawParams as RuntimeAttachMcpResourceParams;
  return toolExecutor.readMcpResource(params.server, params.uri);
});

peer.on('runtime.listMcpPrompts', async (rawParams) => {
  const params = rawParams as RuntimeNamedMcpServerParams;
  return toolExecutor.listMcpPrompts(params.name);
});

peer.on('runtime.getMcpPrompt', async (rawParams) => {
  const params = rawParams as RuntimeApplyMcpPromptParams;
  return toolExecutor.getMcpPrompt(params.server, params.prompt, params.argsJson);
});

peer.on('runtime.callMcpTool', async (rawParams) => {
  const params = rawParams as RuntimeApplyMcpPromptParams & { tool: string };
  return toolExecutor.callMcpTool(params.server, params.tool, params.argsJson);
});

peer.on('runtime.mcpStatusSnapshot', async () => toolExecutor.mcpStatusSnapshot());

peer.on('runtime.startMcpBackgroundRefresh', async () => {
  toolExecutor.startMcpBackgroundRefresh();
  return toolExecutor.mcpStatusSnapshot();
});

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

  const baseSystemPrompts = llmTransport.llmSystemPromptsForExport() as Record<string, JsonValue>;
  const rulesSystemPrompt = buildRulesSystemMessage(enabledRules);

  return {
    apiMessages: llmTransport.llmHistoryAsApiMessages([...target.history()]),
    requestTrace: [...target.requestTrace()],
    systemPrompts: {
      ...baseSystemPrompts,
      ...(rulesSystemPrompt === undefined ? {} : { rules: rulesSystemPrompt }),
    },
  };
});

peer.on('runtime.exportArchive', async (rawParams) => {
  const params = rawParams as RuntimeExportArchiveParams;
  return requireRuntime().toArchive(params.messages, params.assistantAux);
});

peer.start();