import { release as osRelease } from 'node:os';

import {
  AgentRuntime,
  createLlmTransport,
  pendingWorkspaceFilesFromInput,
  type LlmTransportConfig,
  type LlmMessage,
  type JsonValue,
  type RuntimeEvent,
  type GeneratedImageSaveRequest,
} from '@spirit-agent/core';
import {
  startLlmToolAgentState,
  continueLlmToolAgentState,
  appendLlmToolResultMessage,
  appendLlmUserMessage,
  appendLlmUserLlmMessage,
  extractLastLlmAssistantText,
  assistantToolCallMessageFromLlmState,
  truncateLlmToolAgentStateForContextRetry,
  truncateLlmHistoryForCompaction,
  rebuildLlmToolAgentStateAfterCompaction,
  type LlmToolAgentState,
  type LlmToolAgentBasicInfo,
  type LlmActiveSkill,
  type LlmEnabledRule,
  type LlmEnabledSkillCatalogEntry,
  type LlmPlanMetadata,
} from '@spirit-agent/core';
import { buildApplyPatchFileToolsPromptSection } from '@spirit-agent/core';
import { buildProviderWebSearchPromptSection } from '@spirit-agent/core';
import type { SpiritAgentMode } from '@spirit-agent/core';
import type { LocalHostToolService } from '@spirit-agent/core/host-bridge';
import { HostToolExecutorProxy } from '@spirit-agent/core/host-bridge';

import {
  NodeHostToolService,
  createNoopMcpAdapter,
  ensureBuiltinAuthoringSkills,
  loadHostInstructionMetadata,
  persistPreCompactionHistoryArchive,
} from '@spirit-agent/host-internal';

import { createNoopPeer } from './noop-peer.js';
import { toLlmTransportConfig, type AcpServerConfig } from './types.js';

export type AcpHostRuntime = AgentRuntime<LlmTransportConfig, LlmToolAgentState, JsonValue, JsonValue>;

export interface AcpRuntimeResult {
  runtime: AcpHostRuntime;
  toolExecutor: HostToolExecutorProxy;
  enabledRules: LlmEnabledRule[];
  enabledSkillCatalog: LlmEnabledSkillCatalogEntry[];
  planMetadata: LlmPlanMetadata | undefined;
  /** Mutable array reference — mutations are seen by state factory closures */
  activeSkills: LlmActiveSkill[];
  /** Switch agent mode: updates tool exposure + planMetadata seen by closures */
  setAgentMode: (mode: SpiritAgentMode) => Promise<void>;
}

/**
 * Creates a fully assembled AgentRuntime for ACP server mode.
 *
 * Key differences from the CLI host-bridge pattern:
 * - No JSON-RPC peer over stdio (ACP uses ndJSON on stdio)
 * - host-internal is loaded directly as a dependency (not via env-var dynamic import)
 * - No LSP, extensions, todos, or image/video generation for MVP
 */
export async function createAcpRuntime(
  config: AcpServerConfig,
  onEvent: (event: RuntimeEvent<JsonValue>) => void,
  initialMode: SpiritAgentMode = 'agent',
): Promise<AcpRuntimeResult> {
  const transportConfig = toLlmTransportConfig(config);
  const workspaceRoot = config.workspaceRoot;
  const spiritDataDir = config.spiritDataDir;

  // 1. Create noop peer + tool executor (ACP doesn't use JSON-RPC peer)
  const noopPeer = createNoopPeer();
  const toolExecutor = new HostToolExecutorProxy(noopPeer);

  // 2. Create NodeHostToolService with noop MCP adapter
  await ensureBuiltinAuthoringSkills(spiritDataDir);
  const service = new NodeHostToolService(
    { workspaceRoot, spiritDataDir },
    {
      mcp: createNoopMcpAdapter(),
    },
  );
  toolExecutor.setLocalHostService(service as unknown as LocalHostToolService);
  toolExecutor.setTransportConfigForToolDefinitions(transportConfig);
  await toolExecutor.refreshCaches();

  // 3. Load rules/skills via host-internal discovery
  const metadata = await loadHostInstructionMetadata(
    { workspaceRoot, spiritDataDir },
    { planMode: initialMode === 'plan', agentMode: initialMode },
  );
  const enabledRules: LlmEnabledRule[] = [...metadata.rules.enabledRules];
  const enabledSkillCatalog: LlmEnabledSkillCatalogEntry[] = [...metadata.skills.enabledSkillCatalog];
  // Mutable: closures capture the binding, setAgentMode() reassigns it
  let currentPlanMetadata: LlmPlanMetadata | undefined = metadata.planMetadata;

  // 4. Set mode tool exposure
  toolExecutor.setAgentModeToolExposure(initialMode);

  // 5. Build runtime basic info
  const shell = service.toolDefinitionEnvironment();
  const basicInfo: LlmToolAgentBasicInfo = {
    workspaceRoot,
    ...(shell?.shellDisplayName ? { terminal: shell.shellDisplayName } : {}),
    system: service.operatingSystemInfo?.() ?? {
      name: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : process.platform === 'linux' ? 'Linux' : process.platform,
      version: osRelease(),
    },
  };

  // 6. Build prompt sections
  const applyPatchPromptSection = transportConfig.transportKind === 'open-responses'
    ? buildApplyPatchFileToolsPromptSection()
    : undefined;
  const providerWebSearchPromptSection = buildProviderWebSearchPromptSection(transportConfig);

  // 7. Mutable active skills array — closures capture the reference, not the value
  const activeSkills: LlmActiveSkill[] = [];

  // 8. State factory functions
  const createToolAgentState = (messages: LlmMessage[], userInput: string) =>
    startLlmToolAgentState(
      messages,
      userInput,
      workspaceRoot,
      enabledRules,
      enabledSkillCatalog,
      activeSkills,
      transportConfig.model,
      currentPlanMetadata,
      [], // extensionSystemPrompts
      undefined, // dreamSystemMessage
      undefined, // todosContextText
      basicInfo,
      applyPatchPromptSection,
      providerWebSearchPromptSection,
      false, // loopEnabled
    );

  const createContinuationState = (messages: LlmMessage[]) =>
    continueLlmToolAgentState(
      messages,
      workspaceRoot,
      enabledRules,
      enabledSkillCatalog,
      activeSkills,
      transportConfig.model,
      currentPlanMetadata,
      [], // extensionSystemPrompts
      undefined, // dreamSystemMessage
      undefined, // todosContextText
      basicInfo,
      applyPatchPromptSection,
      providerWebSearchPromptSection,
      false, // loopEnabled
    );

  // 8. Create LLM transport
  const llmTransport = createLlmTransport(transportConfig);

  // 9. Assemble AgentRuntime
  const runtime = new AgentRuntime<LlmTransportConfig, LlmToolAgentState, JsonValue, JsonValue>({
    config: transportConfig,
    llmTransport,
    toolExecutor,
    createToolAgentState,
    createContinuationState,
    appendToolResultMessage: appendLlmToolResultMessage,
    assistantToolCallMessageFromState: assistantToolCallMessageFromLlmState,
    appendUserMessage: appendLlmUserMessage,
    appendUserLlmMessage: (state, message) => appendLlmUserLlmMessage(state, message, workspaceRoot),
    extractAssistantText: extractLastLlmAssistantText,
    truncateStateForContextRetry: truncateLlmToolAgentStateForContextRetry,
    truncateHistoryForCompaction: truncateLlmHistoryForCompaction,
    rebuildRetryStateAfterCompaction: (messages, userInput, retryState) =>
      rebuildLlmToolAgentStateAfterCompaction(
        messages,
        userInput,
        retryState,
        workspaceRoot,
        enabledRules,
        enabledSkillCatalog,
        activeSkills,
        transportConfig.model,
        currentPlanMetadata,
        [], // extensionSystemPrompts
        undefined, // dreamSystemMessage
        undefined, // todosContextText
        basicInfo,
        applyPatchPromptSection,
        providerWebSearchPromptSection,
        false, // loopEnabled
      ),
    generateImage: (request) =>
      llmTransport.generateImage(transportConfig, request, async (saveRequest: GeneratedImageSaveRequest) => {
        const saveGeneratedImage = service.saveGeneratedImage;
        if (!saveGeneratedImage) {
          throw new Error('ACP host: image generation not supported');
        }
        return saveGeneratedImage.call(service, saveRequest);
      }),
    generateVideo: (request) =>
      llmTransport.generateVideo(transportConfig, request, async (saveRequest) => {
        const saveGeneratedVideo = service.saveGeneratedVideo;
        if (!saveGeneratedVideo) {
          throw new Error('ACP host: video generation not supported');
        }
        return saveGeneratedVideo.call(service, saveRequest);
      }),
    resolveWorkspaceFilesFromInput: (text) => pendingWorkspaceFilesFromInput(workspaceRoot, text),
    persistPreCompactionHistory: async ({ archive, sessionId }) =>
      persistPreCompactionHistoryArchive(spiritDataDir, archive, {
        ...(sessionId !== undefined ? { sessionId } : {}),
      }),
    onEvent,
  });

  // 10. Mode switching: update planMetadata binding seen by closures + tool exposure
  const setAgentMode = async (mode: SpiritAgentMode): Promise<void> => {
    toolExecutor.setAgentModeToolExposure(mode);
    const refreshed = await loadHostInstructionMetadata(
      { workspaceRoot, spiritDataDir },
      { planMode: mode === 'plan', agentMode: mode },
    );
    currentPlanMetadata = refreshed.planMetadata;
  };

  return {
    runtime,
    toolExecutor,
    enabledRules,
    enabledSkillCatalog,
    planMetadata: currentPlanMetadata,
    activeSkills,
    setAgentMode,
  };
}
