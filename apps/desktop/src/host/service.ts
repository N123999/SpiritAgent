import path from 'node:path';

import {
  AgentRuntime,
  buildDreamCollectorSystemMessage,
  buildExtensionsSystemMessage,
  buildPlanSystemMessage,
  buildRulesSystemMessage,
  buildSkillsCatalogSystemMessage,
  type OpenAiActiveSkill,
  type OpenAiExtensionSystemPrompt,
  appendOpenAiToolResultMessage,
  appendOpenAiUserMessage,
  extractLastOpenAiAssistantText,
  OpenAiTransport,
  pendingWorkspaceFilesFromInput,
  rebuildOpenAiToolAgentStateAfterCompaction,
  startOpenAiToolAgentState,
  truncateOpenAiHistoryForCompaction,
  truncateOpenAiToolAgentStateForContextRetry,
  type AssistantAuxArchiveEntry,
  type ChatArchive,
  type JsonObject,
  type OpenAiEnabledRule,
  type OpenAiEnabledSkillCatalogEntry,
  type OpenAiPlanMetadata,
  type OpenAiToolAgentState,
  type OpenAiTransportConfig,
  type RuntimeEvent,
  type RuntimeToolExecution,
} from '@spirit-agent/agent-core';
import {
  createHostExtensionMarketplace,
  createHostExtensionManager,
  createHostDreamStore,
  listOpenAiCompatibleModelIds,
  restoreHostFileChanges,
  type HostExtensionMarketplaceManager,
  type HostExtensionEvent,
  type HostRecordedFileChange,
} from '@spirit-agent/host-internal';

import type {
  ActiveSessionSnapshot,
  AddModelRequest,
  AddMcpServerRequest,
  AddProviderModelsRequest,
  PreviewModelsRequest,
  PreviewModelsResponse,
  AskQuestionsResult,
  BootstrapRequest,
  CommitChangesRequest,
  ConversationMessageSnapshot,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteMcpServerRequest,
  DesktopDreamOverviewItem,
  DesktopMcpServerInspection,
  DesktopExtensionListItem,
  DesktopExtensionCssLayer,
  DesktopMarketplaceCatalogItem,
  DesktopMarketplaceDetail,
  DesktopMarketplacePreparedInstall,
  DesktopGitSnapshot,
  DesktopDreamCollectorSnapshot,
  DesktopModelProvider,
  DeleteSkillRequest,
  DesktopModelCatalogHint,
  DesktopSnapshot,
  FileRewindWarning,
  RunExtensionRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  MessageAuxSnapshot,
  PendingAssistantAux,
  RewindAndSubmitMessageRequest,
  RememberWorkspaceRequest,
  RemoveModelRequest,
  SessionListItem,
  ImportExtensionRequest,
  InstallMarketplaceExtensionRequest,
  PrepareMarketplaceExtensionInstallRequest,
  SubmitCreateSkillSlashRequest,
  SubmitSkillSlashRequest,
  ToolBlockSnapshot,
  UpdateConfigRequest,
  WorkspaceExplorerListResult,
  WorkspaceReadTextFileResult,
  WriteWorkspaceTextFileRequest,
} from '../types.js';
import type { DesktopToolRequest, HostCommandName } from './contracts.js';
import {
  buildCommitEphemeralSessionRecord,
  buildStoredDesktopSession,
  createEphemeralCommitSessionPath,
  deriveDisplayNameFromSeed,
  ephemeralSessionsToListItems,
  type EphemeralSessionRecord,
  isEphemeralCommitSessionPath,
  nextMessageIdFromMessages,
  rememberEphemeralSessionRecord,
  restoreEphemeralSessionState,
  restoreStoredSessionState,
} from './sessions.js';
import {
  isModelCatalogCacheFresh,
  readModelCatalogCache,
  readModelCatalogCacheSync,
  writeModelCatalogCache,
} from './model-catalog-cache.js';
import {
  DEFAULT_API_BASE,
  defaultNewSessionPath,
  discoverWorkspaceRoot,
  loadConfig,
  loadHostMetadata,
  loadStoredSession,
  modelSecretKeyPresence,
  mergeRecentWorkspaceRoots,
  removeModelApiKey,
  resolveApiKeyForModel,
  saveApiKeyForModel,
  createDesktopExtensionStateStore,
  saveConfig,
  saveStoredSession,
  listStoredSessions,
  spiritAgentDataDir,
  normalizeDreamConfig,
  normalizeWebHostConfig,
  type DesktopConfigFile,
  type DesktopWebHostConfigFile,
  type HostMetadataSummary,
} from './storage.js';
import { DesktopToolExecutor } from './tool-executor.js';
import {
  buildCommitMessageGenerationPrompt,
  buildDreamCommitContext,
  clearDreamCollectorIssue,
  DREAM_COLLECTOR_BACKOFF_MS,
  DREAM_COLLECTOR_MONITOR_INTERVAL_MS,
  DREAM_COLLECTOR_TICK_INTERVAL_MS,
  emptyDreamCollectorSnapshot,
  isDreamCollectorDebugSessionPath,
  runDesktopDreamCollectorOnce,
} from './dreams.js';
import {
  buildDesktopExtensionListItems,
  buildDesktopExtensionToolDefinitions,
  collectDesktopExtensionCssLayers,
  collectExtensionSystemPrompts,
  toDesktopMarketplaceCatalogItem,
  toDesktopMarketplaceDetail,
  toDesktopMarketplacePreparedInstall,
} from './extensions.js';
import {
  buildMcpServerConfigFromRequest,
  emptyMcpStatusSnapshot,
  listDesktopMcpServersFromDisk,
  loadMcpConfigFileFromDisk,
  saveMcpConfigFileToDisk,
} from './mcp-config.js';
import {
  archiveBeforeLastUser,
  buildAvailableWorkspaces,
  buildWebHostSnapshot,
  cloneChatArchive,
  cloneDesktopConfig,
  currentApiBase,
  mapPendingQuestions,
  normalizeGeneratedCommitMessage,
  parseAddModelProvider,
  parseApprovalDecision,
  sameDreamCollectorSnapshot,
  sameWorkspaceRoot,
  toRuntimeAskQuestionsResult,
} from './service-utils.js';
import {
  assistantPrefixBeforeFirstToolInCurrentTurn,
  describeAuxForDebug,
  describeOptionalAuxForDebug,
  headlineForStreamingToolPreview,
  hasStandaloneThinkingMessageInCurrentTurn,
  indexForThinkingInsertAfterLastUser,
  indexForThinkingInsertBeforeFirstToolAfterLastUser,
  isStandaloneSubagentStatusAux,
  lastAssistantPlainTextInHistory,
  latestUnsyncedAssistantTextInCurrentTurn,
  messageIndexIsInCurrentTurn,
  messageOrderDebugLevel,
  normalizeMessageAuxSnapshot,
  parsePendingSubagentStatusText,
  restoreMessagesFromArchive,
  rewindStandalonePendingAuxInsertIndexForThinking,
  shouldReanchorPersistedStandaloneSubagentStatusOnBeginAssistantResponse,
  stripPendingThinkingMatchingFinalized,
  stripThinkingFromAux,
  summarizeMessagesTailForOrderDebug,
  truncateOneLineForDebug,
  toolMessageKey,
} from './message-ordering.js';
import {
  buildVisibleMessageSnapshots,
  pruneEmptyAssistantMessages as pruneEmptyAssistantMessagesFromSnapshots,
  shiftStreamAssistantThinkingAnchorForInsertion as shiftThinkingAnchorForInsertion,
  shiftStreamAssistantThinkingAnchorForRemoval as shiftThinkingAnchorForRemoval,
} from './message-snapshots.js';
import {
  buildActiveSkillPayload,
  buildActivateSkillUserTurn,
  buildCreateSkillUserTurn,
  createSkillFile,
  deleteSkillDir,
  desktopInstructionPaths,
  parseCreateSkillSlashPrompt,
} from './skills.js';
import {
  listWorkspaceExplorerChildren as listWorkspaceExplorerChildrenFromDisk,
  readWorkspaceTextFile as readWorkspaceTextFileFromDisk,
  writeWorkspaceTextFile as writeWorkspaceTextFileToDisk,
} from './workspace-files.js';
import {
  buildWorkspaceGitCommitMessageContext,
  commitWorkspaceChanges,
  readWorkspaceGitSnapshot,
} from './git.js';
import {
  bindRewindFileChangesToToolMessage,
  createDesktopRewindMetadata,
  createRewindCheckpointMetadata,
  fileChangeMetadata,
  loadRewindCheckpointSnapshot,
  loadRewindFileChange,
  nextDesktopRewindSequence,
  pruneRewindMetadataAfterCheckpoint,
  saveRewindCheckpointSnapshot,
  saveRewindFileChange,
  toDesktopFileChange,
  upsertRewindCheckpointMetadata,
  type DesktopRewindCheckpointSnapshot,
  type StoredDesktopRewindMetadata,
} from './rewind.js';

type DesktopRuntime = AgentRuntime<
  OpenAiTransportConfig,
  OpenAiToolAgentState,
  DesktopToolRequest,
  string
>;

export interface DesktopExtensionMessageBoxRequest {
  title: string;
  message: string;
  detail?: string;
  buttons?: string[];
  cancelId?: number;
  defaultId?: number;
  noLink?: boolean;
  type?: 'none' | 'info' | 'error' | 'question' | 'warning';
}

export interface DesktopExtensionHostAdapter {
  showMessageBox(request: DesktopExtensionMessageBoxRequest): Promise<void>;
}

let desktopExtensionHostAdapter: DesktopExtensionHostAdapter | undefined;

export function setDesktopExtensionHostAdapter(
  adapter: DesktopExtensionHostAdapter | undefined,
): void {
  desktopExtensionHostAdapter = adapter;
}

type CommandPayloads = {
  bootstrap: { request?: BootstrapRequest };
  rememberWorkspaceRoot: { request: RememberWorkspaceRequest };
  commitChanges: { request: CommitChangesRequest };
  updateConfig: { request: UpdateConfigRequest };
  setWebHostAuthTokenHash: { authTokenHash: string };
  addModel: { request: AddModelRequest };
  addProviderModels: { request: AddProviderModelsRequest };
  previewModels: { request: PreviewModelsRequest };
  removeModel: { request: RemoveModelRequest };
  addMcpServer: { request: AddMcpServerRequest };
  deleteMcpServer: { request: DeleteMcpServerRequest };
  inspectMcpServer: { name: string };
  importExtension: { request: ImportExtensionRequest };
  listMarketplaceExtensions: undefined;
  getMarketplaceExtensionDetail: { extensionId: string };
  getMarketplaceExtensionReadme: { extensionId: string };
  prepareMarketplaceExtensionInstall: { request: PrepareMarketplaceExtensionInstallRequest };
  installMarketplaceExtension: { request: InstallMarketplaceExtensionRequest };
  deleteExtension: { request: DeleteExtensionRequest };
  runExtension: { request: RunExtensionRequest };
  updateExtensionSettings: { request: UpdateExtensionSettingsRequest };
  updateExtensionSecret: { request: UpdateExtensionSecretRequest };
  createSkill: { request: CreateSkillRequest };
  deleteSkill: { request: DeleteSkillRequest };
  submitCreateSkillSlash: { request: SubmitCreateSkillSlashRequest };
  submitSkillSlash: { request: SubmitSkillSlashRequest };
  submitUserTurn: { text: string };
  poll: undefined;
  listDreamsOverview: undefined;
  replyPendingApproval: { message: string };
  replyPendingQuestions: { result: AskQuestionsResult };
  resetSession: undefined;
  listSessions: undefined;
  openSession: { path: string };
  listWorkspaceExplorerChildren: { relativePath: string };
  readWorkspaceTextFile: { relativePath: string };
  writeWorkspaceTextFile: { request: WriteWorkspaceTextFileRequest };
  rewindAndSubmitMessage: { request: RewindAndSubmitMessageRequest };
};

interface HostState {
  workspaceRoot: string;
  config: DesktopConfigFile;
  git: DesktopGitSnapshot;
  metadata: HostMetadataSummary;
  messages: ConversationMessageSnapshot[];
  extensionsList: DesktopExtensionListItem[];
  extensionCss: DesktopExtensionCssLayer[];
  activeSession?: ActiveSessionSnapshot;
  ephemeralSessions: EphemeralSessionRecord[];
  archiveHistory: ChatArchive['llmHistory'];
  archiveSubagentSessions: NonNullable<ChatArchive['subagentSessions']>;
  rewind: StoredDesktopRewindMetadata;
  rewindWarnings: FileRewindWarning[];
}

class DesktopHostService {
  private readonly transport = new OpenAiTransport();
  private readonly extensionStateStore = createDesktopExtensionStateStore({
    spiritDataDir: spiritAgentDataDir(),
    hostKind: 'desktop',
  });
  private readonly hostExtensionManager = createHostExtensionManager({
    spiritDataDir: spiritAgentDataDir(),
    hostKind: 'desktop',
    stateStore: this.extensionStateStore,
  });
  private hostExtensionMarketplace: HostExtensionMarketplaceManager | undefined;
  private hostExtensionMarketplaceFetchImpl: typeof fetch | undefined;
  private state: HostState | undefined;
  private runtime: DesktopRuntime | undefined;
  private toolExecutor: DesktopToolExecutor | undefined;
  private initialized = false;
  private lastRuntimeError = '';
  private activeApiKeyConfigured = false;
  private modelKeyPresence: Record<string, boolean> = {};
  private latestPendingAssistantAux: MessageAuxSnapshot | undefined;
  private persistedStandalonePendingAux: PendingAssistantAux | undefined;
  private persistedStandalonePendingAuxAnchorMessageId: number | undefined;
  private standalonePendingAuxMessageId: number | undefined;
  private lastStandalonePendingAuxSnapshotLogSignature: string | undefined;
  private pendingAssistantMessageId: number | undefined;
  private lastSettledAssistantMessageId: number | undefined;
  /** 思考段 finalize 去重、插入锚点与 apply 批次（见 `applyRuntimeHostEvents` / `appendAssistantThinkingSegment`）。 */
  private lastFinalizedThinkingSegment = '';
  private streamAssistantThinkingAnchor: number | undefined;
  private streamAssistantAnchorSetInApplyBatchId = 0;
  private lastApplyEventBatchId = 0;
  private messageOrderDebugLastVerboseLogMs = 0;
  private messageIdCounter = 1;
  private pendingUnboundFileChangeIds: string[] = [];
  private currentTurnSkills: OpenAiActiveSkill[] = [];
  private serialized = Promise.resolve();
  /** 忙时改 planMode / 模型或 endpoint 时推迟 `refreshRuntime`，避免替换 runtime 导致流式输出丢失；空闲后由 `flushDeferredRuntimeRefreshIfIdle` 应用。 */
  private deferredRuntimeRefreshWhileBusy = false;
  private dreamCollectorStatus: DesktopDreamCollectorSnapshot = emptyDreamCollectorSnapshot('disabled');
  private dreamCollectorRunning = false;
  private dreamCollectorLastTickUnixMs = 0;
  private dreamCollectorMonitorTimer: ReturnType<typeof setInterval> | undefined;
  private readonly dreamUpdateListeners = new Set<(snapshot: DesktopSnapshot) => void>();

  async bootstrap(request?: BootstrapRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(request?.workspaceRoot);
      this.startDreamCollectorMonitorIfNeeded();
      return this.buildSnapshot();
    });
  }

  subscribeDreamUpdates(listener: (snapshot: DesktopSnapshot) => void): () => void {
    this.dreamUpdateListeners.add(listener);
    this.startDreamCollectorMonitorIfNeeded();
    return () => {
      this.dreamUpdateListeners.delete(listener);
    };
  }

  async rememberWorkspaceRoot(request: RememberWorkspaceRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const workspaceRoot = request.workspaceRoot?.trim()
        ? path.resolve(request.workspaceRoot.trim())
        : '';
      if (!workspaceRoot) {
        throw new Error('工作区路径不能为空。');
      }

      const state = this.requireState();
      state.config = {
        ...state.config,
        recentWorkspaces: mergeRecentWorkspaceRoots(state.config.recentWorkspaces, workspaceRoot),
      };
      await saveConfig(state.config);
      return this.buildSnapshot();
    });
  }

  async commitChanges(request: CommitChangesRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      if (this.runtime?.isBusy()) {
        throw new Error('当前已有响应或审批在处理中，请稍候。');
      }

      const state = this.requireState();
      if (!state.git.isRepository) {
        throw new Error('当前工作区不是 Git 仓库。');
      }
      if (!state.git.hasChanges) {
        throw new Error('当前工作区没有可提交的更改。');
      }

      const commitMessage = request.message?.trim()
        ? request.message.trim()
        : await this.generateCommitMessageFromModel();

      await commitWorkspaceChanges(state.workspaceRoot, commitMessage, request.mode);
      await this.refreshGitState();
      return this.buildSnapshot();
    });
  }

  async updateConfig(request: UpdateConfigRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const state = this.requireState();
      const wasBusy = this.runtime?.isBusy() === true;
      const prevActiveModel = state.config.activeModel;
      const prevApiBase = currentApiBase(state.config);
      const prevPlanMode = state.config.planMode === true;

      if (this.runtime?.isBusy() && Boolean(request.apiKey?.trim())) {
        throw new Error('当前已有响应或审批在处理中，请稍候。');
      }

      const activeModel = request.activeModel.trim();
      const apiBase = request.apiBase.trim();
      const existing = state.config.models.find((model) => model.name === activeModel);
      if (existing) {
        existing.apiBase = apiBase;
      } else {
        state.config.models.push({ name: activeModel, apiBase });
      }
      state.config.activeModel = activeModel;
      state.config.uiLocale = request.uiLocale?.trim() || undefined;
      state.config.windowsMica = request.windowsMica !== false;
      if (request.planMode !== undefined) {
        state.config.planMode = request.planMode;
      }
      if (request.webHost !== undefined) {
        const nextWebHost = normalizeWebHostConfig({
          ...state.config.webHost,
          ...request.webHost,
        });
        if (request.webHost.resetPairing === true) {
          delete nextWebHost.authTokenHash;
        }
        state.config.webHost = nextWebHost;
      }
      if (request.dreams !== undefined) {
        const nextDreamConfig = {
          ...state.config.dreams,
          ...request.dreams,
        };
        if (request.dreams.clearCollectorModel === true) {
          delete nextDreamConfig.collectorModel;
        }
        state.config.dreams = normalizeDreamConfig(nextDreamConfig);
      }
      await saveConfig(state.config);
      if (request.apiKey?.trim()) {
        await saveApiKeyForModel(activeModel, request.apiKey);
      }

      const planModeNow = state.config.planMode === true;
      const modelOrEndpointChanged =
        state.config.activeModel !== prevActiveModel ||
        currentApiBase(state.config) !== prevApiBase;

      if (planModeNow !== prevPlanMode) {
        state.metadata = await loadHostMetadata(state.workspaceRoot, planModeNow);
      }

      const transportOrPlanChanged =
        planModeNow !== prevPlanMode || modelOrEndpointChanged;
      const deferRuntimeRefresh =
        wasBusy &&
        transportOrPlanChanged &&
        !Boolean(request.apiKey?.trim());

      if (deferRuntimeRefresh) {
        this.deferredRuntimeRefreshWhileBusy = true;
      } else {
        this.deferredRuntimeRefreshWhileBusy = false;
        await this.refreshRuntime();
      }
      this.lastRuntimeError = '';
      // 勿在此处 persist：仅改 config（如 planMode）不应刷新 savedAtUnixMs，否则会话在侧栏会误排到首位
      await this.flushDeferredRuntimeRefreshIfIdle();
      return this.buildSnapshot();
    });
  }

  async setWebHostAuthTokenHash(authTokenHash: string): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const state = this.requireState();
      state.config.webHost = normalizeWebHostConfig({
        ...state.config.webHost,
        authTokenHash,
      });
      await saveConfig(state.config);
      return this.buildSnapshot();
    });
  }

  async previewModels(request: PreviewModelsRequest): Promise<PreviewModelsResponse> {
    const apiBaseRaw = request.apiBase.trim();
    const apiBase = apiBaseRaw || DEFAULT_API_BASE;
    const apiKey = request.apiKey.trim();
    if (!apiKey) {
      throw new Error('API Key 不能为空。');
    }
    const forceRefresh = request.forceRefresh === true;
    const cached = await readModelCatalogCache(apiBase, apiKey);
    const now = Date.now();
    if (cached && isModelCatalogCacheFresh(cached, now, forceRefresh)) {
      return { modelIds: cached.modelIds, fromCache: true };
    }
    const modelIds = await listOpenAiCompatibleModelIds({ baseUrl: apiBase, apiKey });
    await writeModelCatalogCache(apiBase, modelIds, apiKey);
    return { modelIds, fromCache: false };
  }

  async addProviderModels(request: AddProviderModelsRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const state = this.requireState();

      if (this.runtime?.isBusy()) {
        throw new Error('当前已有响应或审批在处理中，请稍候。');
      }

      const apiBaseRaw = request.apiBase.trim();
      const apiBase = apiBaseRaw || DEFAULT_API_BASE;
      const apiKey = request.apiKey.trim();
      if (!apiKey) {
        throw new Error('API Key 不能为空。');
      }

      const provider = parseAddModelProvider(request.provider);
      const rawIds = request.modelIds.map((id) => id.trim()).filter((id) => id.length > 0);
      const uniqueIds = [...new Set(rawIds)];
      if (uniqueIds.length === 0) {
        throw new Error('模型列表为空。');
      }

      type NewProfile = { name: string; apiBase: string; provider?: DesktopModelProvider };
      const toAdd: NewProfile[] = [];
      for (const name of uniqueIds) {
        if (state.config.models.some((model) => model.name === name)) {
          continue;
        }
        const profile: NewProfile = { name, apiBase };
        if (provider !== undefined) {
          profile.provider = provider;
        }
        toAdd.push(profile);
      }

      if (toAdd.length === 0) {
        throw new Error('所选模型均已存在于配置中。');
      }

      const keySaveOrder: string[] = [];
      try {
        for (const { name } of toAdd) {
          await saveApiKeyForModel(name, apiKey);
          keySaveOrder.push(name);
        }
      } catch (err) {
        for (const name of keySaveOrder) {
          await removeModelApiKey(name);
        }
        throw err;
      }

      const firstNew = toAdd[0]?.name;
      for (const profile of toAdd) {
        state.config.models.push(profile);
      }

      state.config.activeModel = firstNew ?? state.config.activeModel;
      await saveConfig(state.config);
      await this.refreshRuntime();
      this.lastRuntimeError = '';
      await this.persistCurrentSessionIfNeeded();
      return this.buildSnapshot();
    });
  }

  async addModel(request: AddModelRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const state = this.requireState();

      if (this.runtime?.isBusy()) {
        throw new Error('当前已有响应或审批在处理中，请稍候。');
      }

      const name = request.name.trim();
      const apiBaseRaw = request.apiBase.trim();
      const apiBase = apiBaseRaw || DEFAULT_API_BASE;
      const apiKey = request.apiKey.trim();

      if (!name) {
        throw new Error('模型名称不能为空。');
      }
      if (!apiKey) {
        throw new Error('API Key 不能为空。');
      }
      if (state.config.models.some((model) => model.name === name)) {
        throw new Error(`模型已存在: ${name}`);
      }

      const provider = parseAddModelProvider(request.provider);
      const profile: { name: string; apiBase: string; provider?: DesktopModelProvider } = {
        name,
        apiBase,
      };
      if (provider !== undefined) {
        profile.provider = provider;
      }
      state.config.models.push(profile);
      state.config.activeModel = name;
      await saveConfig(state.config);
      await saveApiKeyForModel(name, apiKey);

      await this.refreshRuntime();
      this.lastRuntimeError = '';
      await this.persistCurrentSessionIfNeeded();
      return this.buildSnapshot();
    });
  }

  async removeModel(request: RemoveModelRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const state = this.requireState();

      const name = request.name.trim();
      if (!name) {
        throw new Error('模型名称不能为空。');
      }
      if (name === state.config.activeModel) {
        throw new Error('不能删除当前模型，请先切换到其他模型。');
      }

      const before = state.config.models.length;
      state.config.models = state.config.models.filter((model) => model.name !== name);
      if (state.config.models.length === before) {
        throw new Error(`模型不存在: ${name}`);
      }

      await saveConfig(state.config);
      await removeModelApiKey(name);
      await this.refreshModelKeyPresence();
      await this.persistCurrentSessionIfNeeded();
      return this.buildSnapshot();
    });
  }

  async createSkill(request: CreateSkillRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      if (this.runtime?.isBusy()) {
        throw new Error('当前已有回复或审批在进行，请稍后再添加 Skill。');
      }
      const state = this.requireState();
      await createSkillFile(state.workspaceRoot, request);

      await this.refreshRuntime();
      this.lastRuntimeError = '';
      await this.persistCurrentSessionIfNeeded();
      return this.buildSnapshot();
    });
  }

  async addMcpServer(request: AddMcpServerRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();

      const name = request.name.trim();
      if (!name) {
        throw new Error('MCP server 名称不能为空。');
      }
      if (/\s/u.test(name)) {
        throw new Error('MCP server 名称不能包含空白字符。');
      }

      const endpoint = request.endpoint.trim();
      if (!endpoint) {
        throw new Error(request.transportType === 'http' ? 'URL 不能为空。' : '命令不能为空。');
      }

      const configFile = loadMcpConfigFileFromDisk();
      if (configFile.servers[name]) {
        throw new Error(`MCP server 已存在：${name}`);
      }

      configFile.servers[name] = buildMcpServerConfigFromRequest(request);
      await saveMcpConfigFileToDisk(configFile);
      this.toolExecutor?.startMcpBackgroundRefresh();
      return this.buildSnapshot();
    });
  }

  async deleteMcpServer(request: DeleteMcpServerRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();

      const name = request.name.trim();
      if (!name) {
        throw new Error('MCP server 名称不能为空。');
      }

      const configFile = loadMcpConfigFileFromDisk();
      if (!configFile.servers[name]) {
        throw new Error(`MCP server 不存在：${name}`);
      }

      delete configFile.servers[name];
      await saveMcpConfigFileToDisk(configFile);
      this.toolExecutor?.startMcpBackgroundRefresh();
      return this.buildSnapshot();
    });
  }

  async inspectMcpServer(name: string): Promise<DesktopMcpServerInspection> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error('MCP server 名称不能为空。');
      }

      const inspection = await this.requireToolExecutor().inspectMcpServer(trimmedName) as Record<string, unknown>;
      return {
        name: typeof inspection.name === 'string' ? inspection.name : trimmedName,
        displayName:
          typeof inspection.displayName === 'string'
            ? inspection.displayName
            : trimmedName,
        supportsTools: inspection.supportsTools === true,
        supportsResources: inspection.supportsResources === true,
        supportsPrompts: inspection.supportsPrompts === true,
        toolsCount: typeof inspection.toolsCount === 'number' ? inspection.toolsCount : 0,
        resourcesCount: typeof inspection.resourcesCount === 'number' ? inspection.resourcesCount : 0,
        promptsCount: typeof inspection.promptsCount === 'number' ? inspection.promptsCount : 0,
      };
    });
  }

  async importExtension(request: ImportExtensionRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const archiveBase64 = request.archiveBase64.trim();
      if (!archiveBase64) {
        throw new Error('扩展 ZIP 内容不能为空。');
      }

      const installed = await this.extensionManager().importArchive({
        archiveBase64,
        ...(request.fileName?.trim() ? { fileName: request.fileName.trim() } : {}),
      });
      await this.refreshExtensionsList();
      await this.refreshRuntimeAfterExtensionMutation();
      await this.dispatchExtensionEvent(
        {
          type: 'onExtensionInstalled',
          detail: {
            extensionId: installed.id,
            name: installed.manifest.name,
            version: installed.manifest.version,
          },
        },
        { targetExtensionIds: [installed.id] },
      );
      return this.buildSnapshot();
    });
  }

  async listMarketplaceExtensions(): Promise<DesktopMarketplaceCatalogItem[]> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const items = await this.marketplace().listCatalog();
      return items.map((item) => toDesktopMarketplaceCatalogItem(item));
    });
  }

  async getMarketplaceExtensionDetail(extensionId: string): Promise<DesktopMarketplaceDetail> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const trimmedId = extensionId.trim();
      if (!trimmedId) {
        throw new Error('扩展 id 不能为空。');
      }

      const detail = await this.marketplace().getDetail(trimmedId);
      return toDesktopMarketplaceDetail(detail);
    });
  }

  async getMarketplaceExtensionReadme(extensionId: string): Promise<string> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const trimmedId = extensionId.trim();
      if (!trimmedId) {
        throw new Error('扩展 id 不能为空。');
      }

      return this.marketplace().getReadme(trimmedId);
    });
  }

  async prepareMarketplaceExtensionInstall(
    request: PrepareMarketplaceExtensionInstallRequest,
  ): Promise<DesktopMarketplacePreparedInstall> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const extensionId = request.extensionId.trim();
      if (!extensionId) {
        throw new Error('扩展 id 不能为空。');
      }

      const prepared = await this.marketplace().prepareInstall({
        extensionId,
        ...(request.version?.trim() ? { version: request.version.trim() } : {}),
      });
      return toDesktopMarketplacePreparedInstall(prepared);
    });
  }

  async installMarketplaceExtension(
    request: InstallMarketplaceExtensionRequest,
  ): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const extensionId = request.extensionId.trim();
      if (!extensionId) {
        throw new Error('扩展 id 不能为空。');
      }

      const installed = await this.marketplace().install({
        extensionId,
        ...(request.version?.trim() ? { version: request.version.trim() } : {}),
        ...(request.reviewAcknowledged === true ? { reviewAcknowledged: true } : {}),
      });
      await this.refreshExtensionsList();
      await this.refreshRuntimeAfterExtensionMutation();
      await this.dispatchExtensionEvent(
        {
          type: 'onExtensionInstalled',
          detail: {
            extensionId: installed.id,
            name: installed.manifest.name,
            version: installed.manifest.version,
          },
        },
        { targetExtensionIds: [installed.id] },
      );
      return this.buildSnapshot();
    });
  }

  async deleteExtension(request: DeleteExtensionRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const id = request.id.trim();
      if (!id) {
        throw new Error('扩展 id 不能为空。');
      }

      await this.extensionManager().remove(id);
      await this.refreshExtensionsList();
      await this.refreshRuntimeAfterExtensionMutation();
      return this.buildSnapshot();
    });
  }

  async runExtension(request: RunExtensionRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const id = request.id.trim();
      if (!id) {
        throw new Error('扩展 id 不能为空。');
      }

      await this.extensionManager().run({
        id,
        host: this.requireExtensionHostAdapter(),
        logger: console,
      });
      return this.buildSnapshot();
    });
  }

  async updateExtensionSettings(request: UpdateExtensionSettingsRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const id = request.id.trim();
      if (!id) {
        throw new Error('扩展 id 不能为空。');
      }

      await this.extensionManager().setSettingsValues({
        id,
        values: request.values,
      });
      await this.refreshExtensionsList();
      await this.refreshRuntimeAfterExtensionMutation();
      return this.buildSnapshot();
    });
  }

  async updateExtensionSecret(request: UpdateExtensionSecretRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const id = request.id.trim();
      const key = request.key.trim();
      if (!id) {
        throw new Error('扩展 id 不能为空。');
      }
      if (!key) {
        throw new Error('secret key 不能为空。');
      }

      await this.extensionManager().setSecretValue({
        id,
        key,
        ...(request.value !== undefined ? { value: request.value } : {}),
      });
      await this.refreshExtensionsList();
      await this.refreshRuntimeAfterExtensionMutation();
      return this.buildSnapshot();
    });
  }

  async deleteSkill(request: DeleteSkillRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      if (this.runtime?.isBusy()) {
        throw new Error('当前已有回复或审批在进行，请稍后再删除 Skill。');
      }
      const state = this.requireState();
      await deleteSkillDir(state.workspaceRoot, request);

      await this.refreshRuntime();
      this.lastRuntimeError = '';
      await this.persistCurrentSessionIfNeeded();
      return this.buildSnapshot();
    });
  }

  async submitSkillSlash(request: SubmitSkillSlashRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const runtime = this.requireRuntime();
      if (runtime.isBusy()) {
        throw new Error('当前已有响应或审批在处理中，请稍候。');
      }

      const skillName = request.skillName.trim();
      if (!skillName) {
        throw new Error('Skill 名称不能为空。');
      }

      const skill = this.requireEnabledSkillEntry(skillName);
      const payload = await buildActiveSkillPayload(skill);

      return this.submitUserTurnAfterInitialized(
        buildActivateSkillUserTurn(skillName, request.extraNote ?? ''),
        {
          displayText: request.rawText,
          turnSkills: [payload],
        },
      );
    });
  }

  async submitCreateSkillSlash(request: SubmitCreateSkillSlashRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const runtime = this.requireRuntime();
      if (runtime.isBusy()) {
        throw new Error('当前已有响应或审批在处理中，请稍候。');
      }

      const rawText = request.rawText.trim();
      if (!rawText) {
        throw new Error('消息不能为空。');
      }

      const prompt = parseCreateSkillSlashPrompt(rawText);
      if (prompt instanceof Error) {
        return this.appendInlineAssistantReply(rawText, prompt.message);
      }

      const state = this.requireState();
      return this.submitUserTurnAfterInitialized(
        buildCreateSkillUserTurn(
          state.workspaceRoot,
          desktopInstructionPaths(state.workspaceRoot),
          prompt,
        ),
        {
          displayText: rawText,
        },
      );
    });
  }

  async submitUserTurn(text: string): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      return this.submitUserTurnAfterInitialized(text);
    });
  }

  async rewindAndSubmitMessage(request: RewindAndSubmitMessageRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const state = this.requireState();
      const runtime = this.requireRuntime();
      if (runtime.isBusy()) {
        throw new Error('当前已有响应或审批在处理中，请稍候。');
      }
      if (!Number.isFinite(request.messageId)) {
        throw new Error('消息 id 无效。');
      }

      const checkpoint = state.rewind.checkpoints.find(
        (candidate) => candidate.messageId === request.messageId,
      );
      if (!checkpoint) {
        throw new Error('该消息没有可用的回溯检查点。');
      }

      const snapshot = await loadRewindCheckpointSnapshot(
        spiritAgentDataDir(),
        state.rewind.sessionId,
        checkpoint.id,
      );
      if (!snapshot) {
        throw new Error('回溯检查点文件不存在，无法回溯。');
      }

      const changesToRestore = state.rewind.fileChanges
        .filter((change) => change.sequence > checkpoint.sequence)
        .sort((left, right) => left.sequence - right.sequence);
      const loadedChanges: HostRecordedFileChange[] = [];
      const missingWarnings: FileRewindWarning[] = [];
      for (const metadata of changesToRestore) {
        const stored = await loadRewindFileChange(
          spiritAgentDataDir(),
          state.rewind.sessionId,
          metadata.id,
        );
        if (stored) {
          loadedChanges.push(stored);
        } else {
          missingWarnings.push({
            changeId: metadata.id,
            path: metadata.resolvedPath,
            action: metadata.kind,
            message: '文件变更快照缺失，已跳过该项回溯。',
          });
        }
      }

      const restoreResult = await restoreHostFileChanges(loadedChanges);
      state.rewindWarnings = [
        ...missingWarnings,
        ...restoreResult.warnings.map((warning) => ({ ...warning })),
      ];

      this.restoreBeforeRewindCheckpoint(snapshot, checkpoint.sequence);
      return this.submitUserTurnAfterInitialized(request.text, {
        preserveRewindWarnings: true,
      });
    });
  }

  private async submitUserTurnAfterInitialized(
    text: string,
    options: {
      preserveRewindWarnings?: boolean;
      displayText?: string;
      turnSkills?: OpenAiActiveSkill[];
    } = {},
  ): Promise<DesktopSnapshot> {
    const runtime = this.requireRuntime();
    const trimmed = text.trim();
    const displayText = (options.displayText ?? text).trim();
    if (!trimmed) {
      throw new Error('消息不能为空。');
    }
    if (!displayText) {
      throw new Error('消息不能为空。');
    }

    const state = this.requireState();
    if (state.activeSession?.readOnly) {
      throw new Error('当前调试会话为只读，无法继续发送消息。');
    }
    if (!options.preserveRewindWarnings) {
      state.rewindWarnings = [];
    }
    this.currentTurnSkills = cloneActiveSkills(options.turnSkills ?? []);
    this.ensureActiveSession(displayText);
    const beforeUserCheckpoint = this.buildRewindCheckpointSnapshot();
    const userMessage: ConversationMessageSnapshot = {
      id: this.allocateMessageId(),
      role: 'user',
      content: displayText,
      pending: false,
    };
    state.messages.push(userMessage);
    this.resetStreamingPlacementState(false);
    await this.persistCurrentSessionIfNeeded();
    await this.dispatchExtensionEvent({
      type: 'onUserMessage',
      detail: {
        text: trimmed,
        displayText,
        messageId: userMessage.id,
      },
    });

    try {
      await runtime.startUserTurnStreaming(trimmed);
      this.refreshArchiveFromRuntime();
      await this.recordRewindCheckpoint(userMessage.id, beforeUserCheckpoint);
      await runtime.poll();
      this.applyRuntimeHostEvents(runtime.drainEvents());
    } catch (error) {
      this.currentTurnSkills = [];
      this.handleMessageRemoved(state.messages.length - 1, userMessage.id, 'send-user-rollback');
      state.messages.pop();
      throw error;
    }

    this.consumeCompletedTurnResult();
    this.syncPendingToolStates();
    this.syncAssistantPrefixFromHistoryBeforeToolRow();
    await this.flushDeferredRuntimeRefreshIfIdle();
    if (!runtime.isBusy()) {
      await this.refreshGitState();
    }
    return this.buildSnapshot();
  }

  private async appendInlineAssistantReply(
    displayText: string,
    assistantText: string,
  ): Promise<DesktopSnapshot> {
    const state = this.requireState();
    state.rewindWarnings = [];
    this.ensureActiveSession(displayText);
    state.messages.push({
      id: this.allocateMessageId(),
      role: 'user',
      content: displayText,
      pending: false,
    });
    this.resetStreamingPlacementState(false);
    this.appendAssistantMessage(assistantText);
    await this.persistCurrentSessionIfNeeded();
    await this.refreshGitState();
    return this.buildSnapshot();
  }

  async poll(): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      if (this.runtime) {
        this.runtime.tickThinkingSpinner();
        await this.runtime.poll();
        this.applyRuntimeHostEvents(this.runtime.drainEvents());
      }
      this.consumeCompletedTurnResult();
      this.syncPendingToolStates();
      this.syncAssistantPrefixFromHistoryBeforeToolRow();
      await this.persistCurrentSessionIfNeeded();
      await this.flushDeferredRuntimeRefreshIfIdle();
      if (!this.runtime?.isBusy()) {
        await this.refreshGitState();
      }
      this.startDreamCollectorIfNeeded();
      return this.buildSnapshot();
    });
  }

  async replyPendingApproval(message: string): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const runtime = this.requireRuntime();
      const decision = parseApprovalDecision(message);
      const state = this.requireState();
      if (decision.kind === 'guidance' && decision.userMessage.trim()) {
        state.messages.push({
          id: this.allocateMessageId(),
          role: 'user',
          content: decision.userMessage.trim(),
          pending: false,
        });
        this.resetStreamingPlacementState(false);
      }
      await runtime.continuePendingApproval(decision);
      await runtime.poll();
      this.applyRuntimeHostEvents(runtime.drainEvents());
      this.consumeCompletedTurnResult();
      this.syncPendingToolStates();
      this.syncAssistantPrefixFromHistoryBeforeToolRow();
      await this.flushDeferredRuntimeRefreshIfIdle();
      if (!runtime.isBusy()) {
        await this.refreshGitState();
      }
      return this.buildSnapshot();
    });
  }

  async replyPendingQuestions(result: AskQuestionsResult): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const runtime = this.requireRuntime();
      await runtime.continuePendingQuestions(toRuntimeAskQuestionsResult(result));
      await runtime.poll();
      this.applyRuntimeHostEvents(runtime.drainEvents());
      this.consumeCompletedTurnResult();
      this.syncPendingToolStates();
      this.syncAssistantPrefixFromHistoryBeforeToolRow();
      await this.persistCurrentSessionIfNeeded();
      await this.flushDeferredRuntimeRefreshIfIdle();
      if (!runtime.isBusy()) {
        await this.refreshGitState();
      }
      return this.buildSnapshot();
    });
  }

  async resetSession(): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      if (this.runtime?.isBusy()) {
        throw new Error('当前已有响应或审批在处理中，请稍候。');
      }

      this.deferredRuntimeRefreshWhileBusy = false;
      const state = this.requireState();
      state.messages = [];
      state.activeSession = undefined;
      state.archiveHistory = [];
      state.archiveSubagentSessions = [];
      state.rewind = createDesktopRewindMetadata();
      state.rewindWarnings = [];
      this.currentTurnSkills = [];
      this.pendingUnboundFileChangeIds = [];
      this.latestPendingAssistantAux = undefined;
      this.resetStreamingPlacementState(true);
      this.messageIdCounter = 1;
      await this.refreshRuntime();
      this.lastRuntimeError = '';
      await this.dispatchExtensionEvent({
        type: 'onSessionReset',
        detail: {
          workspaceRoot: state.workspaceRoot,
        },
      });
      return this.buildSnapshot();
    });
  }

  async listSessions(): Promise<SessionListItem[]> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const state = this.requireState();
      const stored = await listStoredSessions();
      const ephemeral: SessionListItem[] = ephemeralSessionsToListItems(state.ephemeralSessions);
      return [...stored, ...ephemeral].sort((left, right) => right.modifiedAtUnixMs - left.modifiedAtUnixMs);
    });
  }

  async listDreamsOverview(): Promise<DesktopDreamOverviewItem[]> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const state = this.requireState();
      const gitBranch = state.git.branch?.trim();
      if (!state.git.isRepository || !gitBranch) {
        return [];
      }

      const dreamStore = createHostDreamStore({
        spiritDataDir: spiritAgentDataDir(),
        scope: {
          workspaceRoot: state.workspaceRoot,
          gitBranch,
        },
      });
      await dreamStore.pruneExpired();
      const dreams = await dreamStore.list({ includeDeleted: false, includeExpired: false });
      return dreams.map((dream) => ({
        id: dream.id,
        title: dream.title,
        summary: dream.summary,
        ...(dream.details ? { details: dream.details } : {}),
        tags: dream.tags ?? [],
        workspaceRoot: dream.scope.workspaceRoot,
        gitBranch: dream.scope.gitBranch,
        updatedAtUnixMs: dream.updatedAtUnixMs,
      }));
    });
  }

  async listWorkspaceExplorerChildren(relativePath: string): Promise<WorkspaceExplorerListResult> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const state = this.requireState();
      return listWorkspaceExplorerChildrenFromDisk(state.workspaceRoot, relativePath);
    });
  }

  async readWorkspaceTextFile(relativePath: string): Promise<WorkspaceReadTextFileResult> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const state = this.requireState();
      return readWorkspaceTextFileFromDisk(state.workspaceRoot, relativePath);
    });
  }

  async writeWorkspaceTextFile(request: WriteWorkspaceTextFileRequest): Promise<void> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const state = this.requireState();
      await writeWorkspaceTextFileToDisk(state.workspaceRoot, request);
      await this.refreshGitState();
    });
  }

  async openSession(filePath: string): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      this.deferredRuntimeRefreshWhileBusy = false;
      if (isEphemeralCommitSessionPath(filePath)) {
        const ephemeral = this.findEphemeralSession(filePath);
        if (!ephemeral) {
          throw new Error('临时调试会话不存在或已过期。');
        }
        await this.ensureInitialized(ephemeral.workspaceRoot);
        const state = this.requireState();
        const restored = restoreEphemeralSessionState(ephemeral);
        state.messages = restored.messages;
        state.activeSession = restored.activeSession;
        state.archiveHistory = restored.archiveHistory;
        state.archiveSubagentSessions = restored.archiveSubagentSessions;
        state.rewind = restored.rewind;
        state.rewindWarnings = [];
        this.currentTurnSkills = [];
        this.pendingUnboundFileChangeIds = [];
        this.messageIdCounter = nextMessageIdFromMessages(state.messages);
        this.latestPendingAssistantAux = undefined;
        this.resetStreamingPlacementState(true);
        await this.refreshRuntime();
        this.lastRuntimeError = '';
        return this.buildSnapshot();
      }

      const loaded = await loadStoredSession(filePath);
      await this.ensureInitialized(loaded.workspaceRoot);
      const state = this.requireState();
      const restored = restoreStoredSessionState({
        filePath,
        loaded,
        fallbackMessages: restoreMessagesFromArchive(loaded),
      });
      state.messages = restored.messages;
      state.activeSession = restored.activeSession;
      state.archiveHistory = restored.archiveHistory;
      state.archiveSubagentSessions = restored.archiveSubagentSessions;
      state.rewind = restored.rewind;
      state.rewindWarnings = [];
      this.currentTurnSkills = [];
      this.pendingUnboundFileChangeIds = [];
      this.messageIdCounter = nextMessageIdFromMessages(state.messages);
      this.latestPendingAssistantAux = undefined;
      this.resetStreamingPlacementState(true);
      await this.refreshRuntime();
      this.lastRuntimeError = '';
      await this.dispatchExtensionEvent({
        type: 'onSessionOpened',
        detail: {
          filePath: path.resolve(filePath),
          displayName: state.activeSession.displayName,
        },
      });
      return this.buildSnapshot();
    });
  }

  async invoke(command: HostCommandName, payload?: unknown): Promise<unknown> {
    switch (command) {
      case 'bootstrap': {
        const typedPayload = payload as CommandPayloads['bootstrap'] | undefined;
        return this.bootstrap(typedPayload?.request);
      }
      case 'rememberWorkspaceRoot': {
        const typedPayload = payload as CommandPayloads['rememberWorkspaceRoot'];
        return this.rememberWorkspaceRoot(typedPayload.request);
      }
      case 'commitChanges': {
        const typedPayload = payload as CommandPayloads['commitChanges'];
        return this.commitChanges(typedPayload.request);
      }
      case 'updateConfig': {
        const typedPayload = payload as CommandPayloads['updateConfig'];
        return this.updateConfig(typedPayload.request);
      }
      case 'setWebHostAuthTokenHash': {
        const typedPayload = payload as CommandPayloads['setWebHostAuthTokenHash'];
        return this.setWebHostAuthTokenHash(typedPayload.authTokenHash);
      }
      case 'addModel': {
        const typedPayload = payload as CommandPayloads['addModel'];
        return this.addModel(typedPayload.request);
      }
      case 'addProviderModels': {
        const typedPayload = payload as CommandPayloads['addProviderModels'];
        return this.addProviderModels(typedPayload.request);
      }
      case 'previewModels': {
        const typedPayload = payload as CommandPayloads['previewModels'];
        return this.previewModels(typedPayload.request);
      }
      case 'removeModel': {
        const typedPayload = payload as CommandPayloads['removeModel'];
        return this.removeModel(typedPayload.request);
      }
      case 'addMcpServer': {
        const typedPayload = payload as CommandPayloads['addMcpServer'];
        return this.addMcpServer(typedPayload.request);
      }
      case 'deleteMcpServer': {
        const typedPayload = payload as CommandPayloads['deleteMcpServer'];
        return this.deleteMcpServer(typedPayload.request);
      }
      case 'inspectMcpServer': {
        const typedPayload = payload as CommandPayloads['inspectMcpServer'];
        return this.inspectMcpServer(typedPayload.name);
      }
      case 'importExtension': {
        const typedPayload = payload as CommandPayloads['importExtension'];
        return this.importExtension(typedPayload.request);
      }
      case 'listMarketplaceExtensions': {
        return this.listMarketplaceExtensions();
      }
      case 'getMarketplaceExtensionDetail': {
        const typedPayload = payload as CommandPayloads['getMarketplaceExtensionDetail'];
        return this.getMarketplaceExtensionDetail(typedPayload.extensionId);
      }
      case 'getMarketplaceExtensionReadme': {
        const typedPayload = payload as CommandPayloads['getMarketplaceExtensionReadme'];
        return this.getMarketplaceExtensionReadme(typedPayload.extensionId);
      }
      case 'installMarketplaceExtension': {
        const typedPayload = payload as CommandPayloads['installMarketplaceExtension'];
        return this.installMarketplaceExtension(typedPayload.request);
      }
      case 'prepareMarketplaceExtensionInstall': {
        const typedPayload = payload as CommandPayloads['prepareMarketplaceExtensionInstall'];
        return this.prepareMarketplaceExtensionInstall(typedPayload.request);
      }
      case 'deleteExtension': {
        const typedPayload = payload as CommandPayloads['deleteExtension'];
        return this.deleteExtension(typedPayload.request);
      }
      case 'runExtension': {
        const typedPayload = payload as CommandPayloads['runExtension'];
        return this.runExtension(typedPayload.request);
      }
      case 'updateExtensionSettings': {
        const typedPayload = payload as CommandPayloads['updateExtensionSettings'];
        return this.updateExtensionSettings(typedPayload.request);
      }
      case 'updateExtensionSecret': {
        const typedPayload = payload as CommandPayloads['updateExtensionSecret'];
        return this.updateExtensionSecret(typedPayload.request);
      }
      case 'createSkill': {
        const typedPayload = payload as CommandPayloads['createSkill'];
        return this.createSkill(typedPayload.request);
      }
      case 'deleteSkill': {
        const typedPayload = payload as CommandPayloads['deleteSkill'];
        return this.deleteSkill(typedPayload.request);
      }
      case 'submitCreateSkillSlash': {
        const typedPayload = payload as CommandPayloads['submitCreateSkillSlash'];
        return this.submitCreateSkillSlash(typedPayload.request);
      }
      case 'submitSkillSlash': {
        const typedPayload = payload as CommandPayloads['submitSkillSlash'];
        return this.submitSkillSlash(typedPayload.request);
      }
      case 'submitUserTurn': {
        const typedPayload = payload as CommandPayloads['submitUserTurn'];
        return this.submitUserTurn(typedPayload.text);
      }
      case 'poll':
        return this.poll();
      case 'listDreamsOverview':
        return this.listDreamsOverview();
      case 'replyPendingApproval': {
        const typedPayload = payload as CommandPayloads['replyPendingApproval'];
        return this.replyPendingApproval(typedPayload.message);
      }
      case 'replyPendingQuestions': {
        const typedPayload = payload as CommandPayloads['replyPendingQuestions'];
        return this.replyPendingQuestions(typedPayload.result);
      }
      case 'resetSession':
        return this.resetSession();
      case 'listSessions':
        return this.listSessions();
      case 'openSession': {
        const typedPayload = payload as CommandPayloads['openSession'];
        return this.openSession(typedPayload.path);
      }
      case 'listWorkspaceExplorerChildren': {
        const typedPayload = payload as CommandPayloads['listWorkspaceExplorerChildren'];
        return this.listWorkspaceExplorerChildren(typedPayload.relativePath);
      }
      case 'readWorkspaceTextFile': {
        const typedPayload = payload as CommandPayloads['readWorkspaceTextFile'];
        return this.readWorkspaceTextFile(typedPayload.relativePath);
      }
      case 'writeWorkspaceTextFile': {
        const typedPayload = payload as CommandPayloads['writeWorkspaceTextFile'];
        return this.writeWorkspaceTextFile(typedPayload.request);
      }
      case 'rewindAndSubmitMessage': {
        const typedPayload = payload as CommandPayloads['rewindAndSubmitMessage'];
        return this.rewindAndSubmitMessage(typedPayload.request);
      }
      default:
        throw new Error(`Unsupported host command: ${command satisfies never}`);
    }
  }

  private async ensureInitialized(
    workspaceRootOverride?: string,
    options: { fastPath?: boolean } = {},
  ): Promise<void> {
    const requestedWorkspaceRoot = workspaceRootOverride?.trim()
      ? path.resolve(workspaceRootOverride.trim())
      : undefined;
    if (
      options.fastPath === true &&
      this.initialized &&
      this.state?.workspaceRoot &&
      (!requestedWorkspaceRoot || sameWorkspaceRoot(this.state.workspaceRoot, requestedWorkspaceRoot))
    ) {
      return;
    }

    const loadedConfig = await loadConfig();
    const workspaceRoot = requestedWorkspaceRoot
      ?? loadedConfig.recentWorkspaces?.[0]
      ?? discoverWorkspaceRoot();
    const config = {
      ...loadedConfig,
      recentWorkspaces: mergeRecentWorkspaceRoots(loadedConfig.recentWorkspaces, workspaceRoot),
    } satisfies DesktopConfigFile;
    const git = await readWorkspaceGitSnapshot(workspaceRoot);

    if (
      !loadedConfig.recentWorkspaces ||
      config.recentWorkspaces.length !== loadedConfig.recentWorkspaces.length ||
      config.recentWorkspaces.some((entry, index) => entry !== loadedConfig.recentWorkspaces?.[index])
    ) {
      await saveConfig(config);
    }

    if (this.initialized && this.state?.workspaceRoot && sameWorkspaceRoot(this.state.workspaceRoot, workspaceRoot)) {
      this.state.config = config;
      this.state.git = git;
      return;
    }

    const metadata = await loadHostMetadata(workspaceRoot, config.planMode === true);
    const state = this.state;
    const previousWorkspaceRoot = state?.workspaceRoot;
    const switchingWorkspace = Boolean(
      previousWorkspaceRoot && !sameWorkspaceRoot(previousWorkspaceRoot, workspaceRoot),
    );

    if (switchingWorkspace) {
      await this.extensionManager().deactivateAll();
    }

    if (switchingWorkspace) {
      this.deferredRuntimeRefreshWhileBusy = false;
      this.currentTurnSkills = [];
      this.pendingUnboundFileChangeIds = [];
      this.latestPendingAssistantAux = undefined;
      this.resetStreamingPlacementState(true);
      this.messageIdCounter = 1;
      this.lastRuntimeError = '';
    }

    this.state = {
      workspaceRoot,
      config,
      git,
      metadata,
      messages: switchingWorkspace ? [] : state?.messages ?? [],
      extensionsList: state?.extensionsList ?? [],
      extensionCss: state?.extensionCss ?? [],
      activeSession: switchingWorkspace ? undefined : state?.activeSession,
      ephemeralSessions: state?.ephemeralSessions ?? [],
      archiveHistory: switchingWorkspace ? [] : state?.archiveHistory ?? [],
      archiveSubagentSessions: switchingWorkspace ? [] : state?.archiveSubagentSessions ?? [],
      rewind: switchingWorkspace
        ? createDesktopRewindMetadata()
        : state?.rewind ?? createDesktopRewindMetadata(),
      rewindWarnings: switchingWorkspace ? [] : state?.rewindWarnings ?? [],
    };
    this.initialized = true;
    await this.refreshExtensionsList();
    await this.refreshRuntime();
    await this.dispatchExtensionEvent({
      type: 'onStartup',
      detail: {
        workspaceRoot,
      },
    });
  }

  private async refreshRuntime(): Promise<void> {
    const state = this.requireState();
    state.metadata = await loadHostMetadata(
      state.workspaceRoot,
      state.config.planMode === true,
    );
    const extensions = await this.extensionManager().list();
    this.toolExecutor = new DesktopToolExecutor(state.workspaceRoot, {
      extensionToolDefinitions: buildDesktopExtensionToolDefinitions(extensions),
      fileChangeObserver: {
        recordFileChange: (change) => this.recordHostFileChange(change),
      },
      extensions: {
        manager: this.extensionManager(),
        getHost: () => {
          const adapter = desktopExtensionHostAdapter;
          if (!adapter) {
            throw new Error('当前桌面宿主尚未连接扩展 host adapter。');
          }
          return adapter;
        },
        logger: console,
      },
    });
    this.toolExecutor.startMcpBackgroundRefresh();
    this.currentTurnSkills = [];
    const apiKey = await resolveApiKeyForModel(state.config.activeModel);
    this.activeApiKeyConfigured = Boolean(apiKey);
    const extensionSystemPrompts = await this.collectExtensionSystemPrompts();
    if (!apiKey) {
      this.runtime = undefined;
      this.lastRuntimeError = '未配置 API Key，请在设置中填写。';
      await this.refreshModelKeyPresence();
      return;
    }

    const activeProfile = state.config.models.find((m) => m.name === state.config.activeModel);
    const llmVendor = activeProfile?.provider;

    const runtime = this.createRuntime(
      {
        apiKey,
        model: state.config.activeModel,
        baseUrl: currentApiBase(state.config),
        workspaceRoot: state.workspaceRoot,
        ...(llmVendor ? { llmVendor } : {}),
      },
      state.archiveHistory,
      state.metadata.rules.enabledRules,
      state.metadata.skills.enabledSkillCatalog,
      state.metadata.planMetadata,
      extensionSystemPrompts,
    );
    if (state.archiveSubagentSessions.length > 0 || state.archiveHistory.length > 0) {
      runtime.replaceFromArchive({
        messages: this.archiveMessages(),
        assistantAux: this.archiveAssistantAux(),
        llmHistory: state.archiveHistory,
        subagentSessions: state.archiveSubagentSessions ?? [],
      });
    }
    this.runtime = runtime;
    this.lastRuntimeError = '';
    await this.refreshModelKeyPresence();
  }

  private async refreshGitState(): Promise<void> {
    const state = this.state;
    if (!state) {
      return;
    }
    state.git = await readWorkspaceGitSnapshot(state.workspaceRoot);
  }

  private startDreamCollectorIfNeeded(): void {
    const state = this.state;
    if (!state) {
      return;
    }

    const settings = state.config.dreams;
    const now = Date.now();
    if (!settings.enabled) {
      this.setDreamCollectorStatus(emptyDreamCollectorSnapshot('disabled'));
      return;
    }
    if (!settings.collectorModel) {
      this.setDreamCollectorStatus({
        ...emptyDreamCollectorSnapshot('missing-model'),
        lastError: '梦境收集模型未配置。',
      });
      return;
    }
    if (!state.git.isRepository || !state.git.branch) {
      this.setDreamCollectorStatus(emptyDreamCollectorSnapshot('idle'));
      return;
    }
    if (this.runtime?.isBusy() || this.dreamCollectorRunning) {
      return;
    }
    if (this.dreamCollectorStatus.backoffUntilUnixMs && now < this.dreamCollectorStatus.backoffUntilUnixMs) {
      this.setDreamCollectorStatus({
        ...this.dreamCollectorStatus,
        state: 'backoff',
      });
      return;
    }
    if (now - this.dreamCollectorLastTickUnixMs < DREAM_COLLECTOR_TICK_INTERVAL_MS) {
      return;
    }

    this.dreamCollectorLastTickUnixMs = now;
    this.dreamCollectorRunning = true;
    this.setDreamCollectorStatus({
      ...this.dreamCollectorStatus,
      state: 'running',
      lastRunAtUnixMs: now,
      pendingCount: this.dreamCollectorStatus.pendingCount,
      processedCount: this.dreamCollectorStatus.processedCount,
    });

    const collectorInput = {
      workspaceRoot: state.workspaceRoot,
      gitBranch: state.git.branch,
      collectorModel: settings.collectorModel,
      config: cloneDesktopConfig(state.config),
      planMetadata: { ...state.metadata.planMetadata },
    };

    void runDesktopDreamCollectorOnce(collectorInput, {
      createRuntime: (transportConfig, planMetadata, toolExecutor) => this.createRuntime(
        transportConfig,
        [],
        [],
        [],
        planMetadata,
        [
          {
            extensionId: 'dream-collector',
            extensionName: '梦境收集器',
            content: buildDreamCollectorSystemMessage(),
          },
        ],
        toolExecutor,
      ),
      getStatus: () => this.dreamCollectorStatus,
      setStatus: (next) => this.setDreamCollectorStatus(next),
    })
      .catch((error) => {
        const backoffUntilUnixMs = Date.now() + DREAM_COLLECTOR_BACKOFF_MS;
        this.setDreamCollectorStatus({
          ...this.dreamCollectorStatus,
          state: 'backoff',
          lastError: error instanceof Error ? error.message : String(error),
          backoffUntilUnixMs,
        });
      })
      .finally(() => {
        this.dreamCollectorRunning = false;
      });
  }

  private startDreamCollectorMonitorIfNeeded(): void {
    if (this.dreamCollectorMonitorTimer) {
      return;
    }

    this.dreamCollectorMonitorTimer = setInterval(() => {
      void this.runSerialized(async () => {
        if (!this.initialized || !this.state || this.runtime?.isBusy()) {
          return;
        }
        this.startDreamCollectorIfNeeded();
      });
    }, DREAM_COLLECTOR_MONITOR_INTERVAL_MS);
    this.dreamCollectorMonitorTimer.unref?.();
  }

  private setDreamCollectorStatus(next: DesktopDreamCollectorSnapshot): void {
    if (sameDreamCollectorSnapshot(this.dreamCollectorStatus, next)) {
      return;
    }
    this.dreamCollectorStatus = next;
    this.emitDreamUpdate();
  }

  private emitDreamUpdate(): void {
    if (!this.state || this.dreamUpdateListeners.size === 0) {
      return;
    }
    const snapshot = this.buildSnapshot();
    for (const listener of this.dreamUpdateListeners) {
      listener(snapshot);
    }
  }

  private async flushDeferredRuntimeRefreshIfIdle(): Promise<void> {
    if (!this.deferredRuntimeRefreshWhileBusy) {
      return;
    }
    if (this.runtime?.isBusy()) {
      return;
    }
    this.deferredRuntimeRefreshWhileBusy = false;
    await this.refreshRuntime();
    this.lastRuntimeError = '';
  }

  private async refreshModelKeyPresence(): Promise<void> {
    const state = this.state;
    if (!state) {
      this.modelKeyPresence = {};
      return;
    }
    this.modelKeyPresence = await modelSecretKeyPresence(
      state.config.models.map((model) => model.name),
    );
  }

  private createRuntime(
    transportConfig: OpenAiTransportConfig,
    history: ChatArchive['llmHistory'],
    enabledRules: OpenAiEnabledRule[],
    enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[],
    planMetadata: OpenAiPlanMetadata,
    extensionSystemPrompts: OpenAiExtensionSystemPrompt[],
    toolExecutor: DesktopToolExecutor = this.requireToolExecutor(),
  ): DesktopRuntime {
    const workspaceRoot = transportConfig.workspaceRoot ?? this.requireState().workspaceRoot;
    return new AgentRuntime({
      config: transportConfig,
      llmTransport: this.transport,
      toolExecutor,
      createToolAgentState: (messages, userInput) =>
        startOpenAiToolAgentState(
          messages,
          userInput,
          workspaceRoot,
          enabledRules,
          enabledSkillCatalog,
          cloneActiveSkills(this.currentTurnSkills),
          transportConfig.model,
          planMetadata,
          extensionSystemPrompts,
        ),
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
          enabledSkillCatalog,
          cloneActiveSkills(this.currentTurnSkills),
          transportConfig.model,
          planMetadata,
          extensionSystemPrompts,
        ),
      resolveWorkspaceFilesFromInput: (input) =>
        pendingWorkspaceFilesFromInput(workspaceRoot, input),
    }, history.map((message) => ({
      role: message.role,
      content: message.content,
      imagePaths: [...message.imagePaths],
    })));
  }

  private buildModelCatalogHints(state: HostState): DesktopModelCatalogHint[] {
    const seen = new Set<string>();
    const hints: DesktopModelCatalogHint[] = [];
    for (const model of state.config.models) {
      const base = model.apiBase.trim() || DEFAULT_API_BASE;
      if (seen.has(base)) {
        continue;
      }
      seen.add(base);
      const hit = readModelCatalogCacheSync(base);
      if (hit && hit.modelIds.length > 0) {
        hints.push({
          apiBase: hit.apiBase,
          modelIds: hit.modelIds,
          fetchedAtUnixMs: hit.fetchedAtUnixMs,
        });
      }
    }
    return hints;
  }

  private buildSnapshot(): DesktopSnapshot {
    const state = this.requireState();
    const pendingApproval = this.runtime?.currentPendingApproval();
    const pendingQuestions = this.runtime?.currentPendingQuestions();
    const pendingAux = this.runtime?.pendingAuxState();
    this.syncStandalonePendingAux(pendingAux);
    if (pendingAux && !parsePendingSubagentStatusText(pendingAux.statusText)) {
      this.updatePendingAssistantAux(
        pendingAux.kind,
        pendingAux.detailText ?? pendingAux.statusText,
      );
    }
    this.pruneEmptyAssistantMessages('buildSnapshot');

    return {
      workspaceRoot: state.workspaceRoot,
      availableWorkspaces: buildAvailableWorkspaces(
        state.workspaceRoot,
        state.config.recentWorkspaces,
      ),
      git: { ...state.git },
      dreams: {
        settings: {
          enabled: state.config.dreams.enabled === true,
          ...(state.config.dreams.collectorModel ? { collectorModel: state.config.dreams.collectorModel } : {}),
          debugMode: state.config.dreams.debugMode === true,
        },
        collector: { ...this.dreamCollectorStatus },
      },
      runtimeReady: this.runtime !== undefined,
      ...(this.lastRuntimeError ? { runtimeError: this.lastRuntimeError } : {}),
      config: {
        models: state.config.models.map((model) => ({
          name: model.name,
          apiBase: model.apiBase,
          ...(model.provider ? { provider: model.provider } : {}),
          keyConfigured: this.modelKeyPresence[model.name] ?? false,
        })),
        activeModel: state.config.activeModel,
        ...(state.config.uiLocale ? { uiLocale: state.config.uiLocale } : {}),
        activeApiKeyConfigured: this.activeApiKeyConfigured,
        windowsMica: state.config.windowsMica !== false,
        planMode: state.config.planMode === true,
        modelCatalogHints: this.buildModelCatalogHints(state),
      },
      webHost: buildWebHostSnapshot(state.config.webHost),
      rules: {
        discovered: state.metadata.rules.discovered,
        enabled: state.metadata.rules.enabled,
      },
      skills: {
        discovered: state.metadata.skills.discovered,
        enabled: state.metadata.skills.enabled,
      },
      skillsList: state.metadata.skills.entries.map((entry) => ({
        id: entry.source.id,
        name: entry.source.name,
        description: entry.source.description,
        shortLabel: entry.source.shortLabel,
        scope: entry.source.scope,
        rootKind: entry.source.rootKind,
        enabled: entry.enabled,
      })),
      // 须与 refreshExtensionsList 一致，否则设置页不显示工具/设置/密钥
      extensionsList: state.extensionsList.map((item) => ({ ...item })),
      extensionCss: state.extensionCss.map((entry) => ({ ...entry })),
      plan: {
        path: state.metadata.planMetadata.path,
        exists: state.metadata.planMetadata.exists,
      },
      mcpStatus: this.toolExecutor?.mcpStatusSnapshot() ?? emptyMcpStatusSnapshot(),
      mcpServers: listDesktopMcpServersFromDisk(),
      conversation: {
        messages: this.messagesWithPendingAssistant(pendingAux),
        ...(this.runtime?.pendingUserTurn()
          ? { pendingUserTurn: this.runtime.pendingUserTurn() }
          : {}),
        pendingImagePaths: [...(this.runtime?.pendingImagePaths() ?? [])],
        pendingMcpResources: (this.runtime?.pendingMcpResources() ?? []).map((resource) => ({
          server: resource.server,
          displayName: resource.displayName,
          uri: resource.uri,
          ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
          readAtUnixMs: resource.readAtUnixMs,
          content: resource.content,
        })),
        ...(pendingAux
          ? {
              pendingAuxState: {
                kind: pendingAux.kind,
                statusText: pendingAux.statusText,
                ...(pendingAux.detailText ? { detailText: pendingAux.detailText } : {}),
              },
            }
          : {}),
        ...(pendingApproval
          ? {
              pendingToolApproval: {
                toolName: pendingApproval.toolName,
                prompt: pendingApproval.prompt,
              },
            }
          : {}),
        ...(pendingQuestions
          ? { pendingQuestions: mapPendingQuestions(pendingQuestions) }
          : {}),
        isBusy: this.runtime?.isBusy() ?? false,
        ...(state.rewindWarnings.length > 0
          ? { rewindWarnings: state.rewindWarnings.map((warning) => ({ ...warning })) }
          : {}),
      },
      ...(state.activeSession ? { activeSession: { ...state.activeSession } } : {}),
    };
  }

  private findEphemeralSession(filePath: string): EphemeralSessionRecord | undefined {
    return this.state?.ephemeralSessions.find((session) => session.path === filePath);
  }

  private rememberEphemeralSession(record: EphemeralSessionRecord): void {
    const state = this.requireState();
    state.ephemeralSessions = rememberEphemeralSessionRecord(state.ephemeralSessions, record);
  }

  private async generateCommitMessageFromModel(): Promise<string> {
    const state = this.requireState();
    const activeProfile = state.config.models.find((model) => model.name === state.config.activeModel);
    const apiKey = await resolveApiKeyForModel(state.config.activeModel);
    if (!apiKey) {
      throw new Error('自动生成提交信息失败：当前模型未配置 API Key。');
    }

    const extensionSystemPrompts = await this.collectExtensionSystemPrompts();
    const commitContext = await buildWorkspaceGitCommitMessageContext(state.workspaceRoot);
    const dreamContextText = await buildDreamCommitContext({
      workspaceRoot: state.workspaceRoot,
      gitBranch: state.git.branch,
    });
    const prompt = buildCommitMessageGenerationPrompt({
      workspaceRoot: state.workspaceRoot,
      branch: state.git.branch,
      dreamContextText,
      statusText: commitContext.statusText,
      diffStatText: commitContext.diffStatText,
      diffText: commitContext.diffText,
    });
    const sessionPath = createEphemeralCommitSessionPath();
    const baseMessages: ConversationMessageSnapshot[] = [
      {
        id: 1,
        role: 'user',
        content: prompt,
        pending: false,
      },
    ];

    try {
      const result = await this.transport.createJsonSchemaCompletion<{
        message?: string;
      }>(
        {
          apiKey,
          model: state.config.activeModel,
          baseUrl: currentApiBase(state.config),
          workspaceRoot: state.workspaceRoot,
          ...(activeProfile?.provider ? { llmVendor: activeProfile.provider } : {}),
        },
        {
          userPrompt: prompt,
          schemaName: 'desktop_commit_message',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              message: {
                type: 'string',
                description: 'A complete commit message following the repository convention.',
              },
            },
            required: ['message'],
          },
          systemSections: [
            buildRulesSystemMessage(state.metadata.rules.enabledRules),
            buildSkillsCatalogSystemMessage(state.metadata.skills.enabledSkillCatalog),
            buildPlanSystemMessage(state.metadata.planMetadata),
            buildExtensionsSystemMessage(extensionSystemPrompts),
          ],
        },
      );
      const message = normalizeGeneratedCommitMessage(result.output.message);
      const finalMessages = [
        ...baseMessages,
        {
          id: 2,
          role: 'assistant' as const,
          content: message,
          pending: false,
        },
      ];
      this.rememberEphemeralSession(buildCommitEphemeralSessionRecord({
        path: sessionPath,
        displayName: `[Commit] ${deriveDisplayNameFromSeed(message)}`,
        workspaceRoot: state.workspaceRoot,
        messages: finalMessages,
      }));
      return message;
    } catch (error) {
      const failureMessage = `生成失败：${error instanceof Error ? error.message : String(error)}`;
      const finalMessages = [
        ...baseMessages,
        {
          id: 2,
          role: 'assistant' as const,
          content: failureMessage,
          pending: false,
        },
      ];
      this.rememberEphemeralSession(buildCommitEphemeralSessionRecord({
        path: sessionPath,
        displayName: '[Commit] 自动生成失败',
        workspaceRoot: state.workspaceRoot,
        messages: finalMessages,
      }));
      throw error;
    }
  }

  private messagesWithPendingAssistant(
    livePendingAux?: PendingAssistantAux,
  ): ConversationMessageSnapshot[] {
    const state = this.requireState();
    const snapshots = buildVisibleMessageSnapshots({
      messages: state.messages,
      livePendingAux,
      rewind: state.rewind,
    });

    const standalonePendingAux = this.standalonePendingAuxSnapshot(livePendingAux, snapshots);
    if (!standalonePendingAux) {
      this.lastStandalonePendingAuxSnapshotLogSignature = undefined;
      return snapshots;
    }

    const insertAt = Math.max(0, Math.min(standalonePendingAux.insertAt, snapshots.length));
    snapshots.splice(insertAt, 0, standalonePendingAux.message);
    this.logSnapshotStandalonePendingAux(standalonePendingAux, snapshots);
    return snapshots;
  }

  private consumeCompletedTurnResult(): void {
    if (!this.runtime) {
      return;
    }

    const result = this.runtime.takeCompletedTurnResult();
    if (!result) {
      return;
    }

    this.integrateToolExecutions(result.toolExecutions);
    switch (result.kind) {
      case 'completed':
        this.currentTurnSkills = [];
        if (result.assistantText.trim()) {
          const aux = this.takeLatestPendingAux();
          if (!this.materializeExistingCompletedAssistantMessage(result.assistantText, aux)) {
            this.appendAssistantMessage(result.assistantText, aux);
          }
        }
        this.lastRuntimeError = '';
        break;
      case 'failed':
        this.currentTurnSkills = [];
        {
          const aux = this.takeLatestPendingAux();
          if (!this.materializeExistingCompletedAssistantMessage(result.error, aux)) {
            this.appendAssistantMessage(result.error, aux);
          }
        }
        this.lastRuntimeError = result.error;
        break;
      case 'requires-approval':
      case 'requires-questions':
        this.syncPendingToolStates();
        this.syncAssistantPrefixFromHistoryBeforeToolRow();
        this.lastRuntimeError = '';
        break;
      default:
        break;
    }

    this.refreshArchiveFromRuntime();
  }

  private extensionManager() {
    return this.hostExtensionManager;
  }

  private marketplace() {
    if (!this.hostExtensionMarketplace) {
      this.hostExtensionMarketplace = createHostExtensionMarketplace(
        {
          spiritDataDir: spiritAgentDataDir(),
          hostKind: 'desktop',
        },
        this.hostExtensionMarketplaceFetchImpl
          ? { fetchImpl: this.hostExtensionMarketplaceFetchImpl }
          : {},
      );
    }
    return this.hostExtensionMarketplace;
  }

  setMarketplaceFetchImpl(fetchImpl: typeof fetch | undefined): void {
    if (this.hostExtensionMarketplaceFetchImpl === fetchImpl) {
      return;
    }
    this.hostExtensionMarketplaceFetchImpl = fetchImpl;
    this.hostExtensionMarketplace = undefined;
  }

  private async refreshExtensionsList(): Promise<void> {
    const state = this.requireState();
    const extensions = await this.extensionManager().list();
    state.extensionsList = await buildDesktopExtensionListItems(this.extensionManager(), extensions);
    state.extensionCss = await collectDesktopExtensionCssLayers(extensions);
  }

  private async refreshExtensionToolDefinitions(): Promise<void> {
    if (!this.toolExecutor) {
      return;
    }

    const extensions = await this.extensionManager().list();
    this.toolExecutor.setExtensionToolDefinitions(buildDesktopExtensionToolDefinitions(extensions));
  }

  private async collectExtensionSystemPrompts(): Promise<OpenAiExtensionSystemPrompt[]> {
    const adapter = desktopExtensionHostAdapter;
    if (!adapter) {
      return [];
    }

    return collectExtensionSystemPrompts(this.extensionManager(), adapter);
  }

  private async refreshRuntimeAfterExtensionMutation(): Promise<void> {
    if (this.runtime?.isBusy()) {
      this.deferredRuntimeRefreshWhileBusy = true;
      return;
    }

    this.deferredRuntimeRefreshWhileBusy = false;
    await this.refreshRuntime();
    this.lastRuntimeError = '';
  }

  private async dispatchExtensionEvent(
    event: HostExtensionEvent,
    options: {
      targetExtensionIds?: readonly string[];
    } = {},
  ): Promise<void> {
    const adapter = desktopExtensionHostAdapter;
    if (!adapter) {
      return;
    }

    try {
      await this.extensionManager().dispatchEvent({
        event,
        host: adapter,
        logger: console,
        ...(options.targetExtensionIds ? { targetExtensionIds: options.targetExtensionIds } : {}),
      });
    } catch (error) {
      this.lastRuntimeError = error instanceof Error ? error.message : String(error);
    }
  }

  private integrateToolExecutions(executions: RuntimeToolExecution<DesktopToolRequest>[]): void {
    for (const execution of executions) {
      const message = this.upsertToolMessage(execution.toolCallId || `tool:${execution.toolName}`, {
        toolCallId: execution.toolCallId || `tool:${execution.toolName}`,
        toolName: execution.toolName,
        phase: execution.failed ? 'failed' : 'succeeded',
        headline: execution.failed
          ? `工具执行失败: ${execution.toolName}`
          : `工具执行完成: ${execution.toolName}`,
        detailLines: [],
        argsExcerpt: truncateJson(execution.request),
        outputExcerpt: truncateText(execution.output, 4_000),
      });
      this.bindFileChangesToToolMessage(execution, message.id);
    }
  }

  private applyRuntimeHostEvents(events: RuntimeEvent<DesktopToolRequest>[]): void {
    const state = this.requireState();
    // 空 drain 不递增批次：否则同一 poll 里后续 consume→integrate 的 upsert 会误判批次并清空 preview 记下的锚点。
    const batchId =
      events.length > 0 ? (this.lastApplyEventBatchId += 1) : this.lastApplyEventBatchId;
    // 严格按事件时序单遍处理；begin 一律 anchor := min(已有, messages.length)：
    // - 同批内 preview 先于 begin：保留首条工具下标。
    // - 同批内 finalize/tool-done 先于 begin 导致 at 已含新工具：保留先前跨 poll preview 写下的较小下标。
    for (const ev of events) {
      if (ev.kind === 'begin-assistant-response') {
        const at = state.messages.length;
        const shouldReanchorStandalonePendingAux =
          shouldReanchorPersistedStandaloneSubagentStatusOnBeginAssistantResponse(
            state.messages[state.messages.length - 1],
            this.persistedStandalonePendingAux,
          );
        this.pendingAssistantMessageId = undefined;
        this.latestPendingAssistantAux = undefined;
        this.streamAssistantThinkingAnchor =
          this.streamAssistantThinkingAnchor === undefined
            ? at
            : Math.min(this.streamAssistantThinkingAnchor, at);
        this.streamAssistantAnchorSetInApplyBatchId = batchId;
        const pendingAssistant = this.ensurePendingAssistantMessage();
        if (shouldReanchorStandalonePendingAux) {
          this.persistedStandalonePendingAuxAnchorMessageId = pendingAssistant.id;
        }
        continue;
      }
      if (ev.kind === 'update-pending-assistant-thinking') {
        this.updatePendingAssistantAux('thinking', ev.text);
        continue;
      }
      if (ev.kind === 'update-pending-assistant-compaction') {
        this.updatePendingAssistantAux('compressing', ev.text);
        continue;
      }
      if (ev.kind === 'assistant-chunk') {
        this.appendPendingAssistantChunk(ev.text);
        continue;
      }
      if (ev.kind === 'replace-pending-assistant') {
        this.replacePendingAssistantText(ev.text);
        continue;
      }
      if (ev.kind === 'assistant-response-completed') {
        this.completePendingAssistantMessage();
        continue;
      }
      if (ev.kind === 'remove-pending-assistant') {
        this.removePendingAssistantMessage();
        continue;
      }
      if (ev.kind === 'assistant-thinking-segment-finalized') {
        if (ev.text.trim()) {
          this.appendAssistantThinkingSegment(ev.text);
        }
        continue;
      }
      if (ev.kind === 'tool-call-started') {
        void this.dispatchExtensionEvent({
          type: 'onToolCall',
          detail: {
            toolCallId: ev.toolCallId,
            toolName: ev.toolName,
            request: ev.request as JsonObject,
          },
        });
        continue;
      }
      if (ev.kind === 'approval-resolved') {
        void this.dispatchExtensionEvent({
          type: 'onApprovalResolved',
          detail: {
            toolCallId: ev.toolCallId,
            toolName: ev.toolName,
            decisionKind: ev.decisionKind,
            request: ev.request as JsonObject,
          },
        });
        continue;
      }
      if (ev.kind === 'tool-execution-finished') {
        this.integrateToolExecutions([ev.execution]);
        void this.dispatchExtensionEvent({
          type: 'onToolResult',
          detail: {
            toolCallId: ev.execution.toolCallId,
            toolName: ev.execution.toolName,
            output: ev.execution.output,
            failed: ev.execution.failed,
            request: ev.execution.request as JsonObject,
          },
        });
        continue;
      }
      if (ev.kind !== 'streaming-tool-preview') {
        continue;
      }
      let argsExcerpt: string;
      try {
        argsExcerpt = truncateJson(JSON.parse(ev.argumentsJson) as unknown);
      } catch {
        argsExcerpt = truncateText(ev.argumentsJson, 4_000);
      }
      this.upsertToolMessage(ev.toolCallId, {
        toolCallId: ev.toolCallId,
        toolName: ev.toolName,
        phase: 'running',
        headline: headlineForStreamingToolPreview(state.messages, ev.toolCallId, ev.toolName),
        detailLines: [],
        argsExcerpt,
      });
    }
    this.logMessageOrderApplyBatch(
      batchId,
      events,
      state,
      this.streamAssistantThinkingAnchor,
      this.streamAssistantAnchorSetInApplyBatchId,
    );
  }

  /**
   * 将 `runtime.history()` 中的助手正文同步到 `state.messages`（首轮：首条 tool 前前缀；待审批/问卷：
   * 用 `lastAssistantPlainTextInHistory` 兜底，因 OpenAI 路径下 `history()` 常不含 `role: tool`）。
   */
  private syncAssistantPrefixFromHistoryBeforeToolRow(): void {
    if (!this.runtime) {
      return;
    }
    const pendingTrim = this.runtime.pendingAssistantText().trim();
    const awaitingInteractive =
      Boolean(this.runtime.currentPendingApproval()) ||
      Boolean(this.runtime.currentPendingQuestions());

    if (pendingTrim && !awaitingInteractive) {
      return;
    }

    const hist = this.runtime.history();
    const state = this.requireState();
    const prefixFromUnsyncedLatest = latestUnsyncedAssistantTextInCurrentTurn(
      hist,
      state.messages,
    );
    const prefixFromBeforeFirst = assistantPrefixBeforeFirstToolInCurrentTurn(hist);
    const prefixFromLastAssistant = lastAssistantPlainTextInHistory(hist);
    const prefix = (
      awaitingInteractive && pendingTrim
        ? pendingTrim
        : awaitingInteractive
          ? (prefixFromUnsyncedLatest ?? prefixFromLastAssistant ?? prefixFromBeforeFirst)
          : (prefixFromUnsyncedLatest ?? prefixFromBeforeFirst)
    )
      ?.trim() ?? '';
    const n = state.messages.length;
    const last = n > 0 ? state.messages[n - 1] : undefined;

    if (!prefix) {
      return;
    }

    if (n === 0) {
      return;
    }

    const hasPlainPrefix = state.messages.some(
      (m) => m.role === 'assistant' && m.content === prefix && !m.tool,
    );
    if (hasPlainPrefix) {
      return;
    }

    const isLaterUnsyncedPrefix =
      !awaitingInteractive &&
      prefixFromUnsyncedLatest !== undefined &&
      prefix === prefixFromUnsyncedLatest &&
      prefixFromUnsyncedLatest !== prefixFromBeforeFirst;

    if (isLaterUnsyncedPrefix) {
      const anchor = this.streamAssistantThinkingAnchor ?? state.messages.length;
      const insertAt = Math.max(0, Math.min(anchor, state.messages.length));
      const before = insertAt > 0 ? state.messages[insertAt - 1] : undefined;
      if (
        before?.role === 'assistant' &&
        !before.tool &&
        before.content.trim() === prefix
      ) {
        return;
      }
      this.shiftStreamAssistantThinkingAnchorForInsertion(insertAt);
      state.messages.splice(insertAt, 0, {
        id: this.allocateMessageId(),
        role: 'assistant',
        content: prefix,
        pending: false,
      });
      this.logMessageOrderPrefixSync(`splice-at-anchor@${insertAt}`, state);
      return;
    }

    if (awaitingInteractive) {
      const approval = this.runtime.currentPendingApproval();
      const questions = this.runtime.currentPendingQuestions();
      const key = approval
        ? toolMessageKey(approval)
        : questions
          ? toolMessageKey(questions)
          : undefined;
      if (key) {
        const idx = state.messages.findIndex(
          (m) => m.role === 'assistant' && m.tool?.toolCallId === key,
        );
        if (idx >= 0) {
          const before = idx > 0 ? state.messages[idx - 1] : undefined;
          if (
            before?.role === 'assistant' &&
            !before.tool &&
            before.content.trim() === prefix
          ) {
            return;
          }
          this.shiftStreamAssistantThinkingAnchorForInsertion(idx);
          state.messages.splice(idx, 0, {
            id: this.allocateMessageId(),
            role: 'assistant',
            content: prefix,
            pending: false,
          });
          this.logMessageOrderPrefixSync(`splice-before-approval@${idx}`, state);
        }
      }
      return;
    }

    if (last!.role === 'user') {
      state.messages.push({
        id: this.allocateMessageId(),
        role: 'assistant',
        content: prefix,
        pending: false,
      });
      this.logMessageOrderPrefixSync('push-after-user', state);
      return;
    }

    if (last!.role === 'assistant' && last!.tool) {
      const firstToolIdx = indexForThinkingInsertBeforeFirstToolAfterLastUser(state.messages);
      if (firstToolIdx === undefined) {
        return;
      }
      const beforeFirst = firstToolIdx > 0 ? state.messages[firstToolIdx - 1] : undefined;
      if (beforeFirst?.role === 'assistant' && beforeFirst.content === prefix && !beforeFirst.tool) {
        return;
      }
      this.shiftStreamAssistantThinkingAnchorForInsertion(firstToolIdx);
      state.messages.splice(firstToolIdx, 0, {
        id: this.allocateMessageId(),
        role: 'assistant',
        content: prefix,
        pending: false,
      });
      this.logMessageOrderPrefixSync(`splice-before-first-tool@${firstToolIdx}`, state);
      return;
    }

    if (last!.role === 'assistant' && !last!.tool && last!.content.trim() && last!.content !== prefix) {
      const firstToolIdx = indexForThinkingInsertBeforeFirstToolAfterLastUser(state.messages);
      if (firstToolIdx !== undefined) {
        const beforeFirst = firstToolIdx > 0 ? state.messages[firstToolIdx - 1] : undefined;
        if (beforeFirst?.role === 'assistant' && beforeFirst.content === prefix && !beforeFirst.tool) {
          return;
        }
        this.shiftStreamAssistantThinkingAnchorForInsertion(firstToolIdx);
        state.messages.splice(firstToolIdx, 0, {
          id: this.allocateMessageId(),
          role: 'assistant',
          content: prefix,
          pending: false,
        });
        this.logMessageOrderPrefixSync(`splice-before-first-tool@${firstToolIdx}`, state);
        return;
      }
      let toolIdx = -1;
      for (let i = n - 2; i >= 0; i -= 1) {
        const m = state.messages[i];
        if (m.role === 'assistant' && m.tool) {
          toolIdx = i;
          break;
        }
      }
      if (toolIdx >= 0) {
        const beforeTool = toolIdx > 0 ? state.messages[toolIdx - 1] : undefined;
        if (beforeTool?.role === 'assistant' && beforeTool.content === prefix && !beforeTool.tool) {
          return;
        }
        this.shiftStreamAssistantThinkingAnchorForInsertion(toolIdx);
        state.messages.splice(toolIdx, 0, {
          id: this.allocateMessageId(),
          role: 'assistant',
          content: prefix,
          pending: false,
        });
        this.logMessageOrderPrefixSync(`splice-before-tool@${toolIdx}`, state);
        return;
      }
      if (!last!.content.startsWith(prefix)) {
        this.shiftStreamAssistantThinkingAnchorForInsertion(n - 1);
        state.messages.splice(n - 1, 0, {
          id: this.allocateMessageId(),
          role: 'assistant',
          content: prefix,
          pending: false,
        });
        this.logMessageOrderPrefixSync(`splice-before-tail@${n - 1}`, state);
      }
      return;
    }
  }

  private syncPendingToolStates(): void {
    const approval = this.runtime?.currentPendingApproval();
    if (approval) {
      this.upsertToolMessage(toolMessageKey(approval), {
        toolCallId: toolMessageKey(approval),
        toolName: approval.toolName,
        phase: 'pending-approval',
        headline: `等待确认: ${approval.toolName}`,
        detailLines: [approval.prompt],
        argsExcerpt: truncateJson(approval.request),
      });
    }

    const questions = this.runtime?.currentPendingQuestions();
    if (questions) {
      this.upsertToolMessage(toolMessageKey(questions), {
        toolCallId: toolMessageKey(questions),
        toolName: questions.toolName,
        phase: 'pending-approval',
        headline: `等待补充信息: ${questions.toolName}`,
        detailLines: [questions.questions.title ?? '请回答表单问题'],
        argsExcerpt: truncateJson(questions.questions),
      });
    }
  }

  private upsertToolMessage(
    toolCallId: string,
    tool: ToolBlockSnapshot,
  ): ConversationMessageSnapshot {
    const state = this.requireState();
    const existing = state.messages.find(
      (message) => message.tool?.toolCallId === toolCallId,
    );

    if (existing) {
      const previousTool = existing.tool;
      existing.tool = tool;
      this.logToolMessageUpdate(existing.id, toolCallId, previousTool, tool, state.messages);
      return existing;
    }

    const batchId = this.lastApplyEventBatchId;
    if (this.streamAssistantThinkingAnchor === undefined) {
      this.streamAssistantThinkingAnchor = state.messages.length;
    }
    this.streamAssistantAnchorSetInApplyBatchId = batchId;
    const pushAt = state.messages.length;
    const message: ConversationMessageSnapshot = {
      id: this.allocateMessageId(),
      role: 'assistant',
      content: '',
      tool,
      pending: false,
    };
    state.messages.push(message);
    this.logMessageOrderToolPreviewNew(tool.toolName, pushAt);
    return message;
  }

  private appendAssistantMessage(content: string, aux?: MessageAuxSnapshot): void {
    const state = this.requireState();
    const finalAux = this.normalizeCompletedAssistantAux(aux);
    const message: ConversationMessageSnapshot = {
      id: this.allocateMessageId(),
      role: 'assistant',
      content,
      ...(finalAux ? { aux: finalAux } : {}),
      pending: false,
    };
    state.messages.push(message);
    this.logAssistantAuxDecision('append-assistant', {
      messageId: message.id,
      aux: message.aux,
      content,
    });
  }

  /** 将本段模型思考固化为独立消息，并从挂起 aux 中剥离同文以避免与终稿重复。 */
  private appendAssistantThinkingSegment(text: string): void {
    this.lastFinalizedThinkingSegment = text.trim();
    const state = this.requireState();
    this.stripFinalizedThinkingFromAssistantAnchors(text);
    const msg: ConversationMessageSnapshot = {
      id: this.allocateMessageId(),
      role: 'assistant',
      content: '',
      aux: { thinking: text },
      pending: false,
    };
    let insertAt = this.streamAssistantThinkingAnchor;
    this.streamAssistantThinkingAnchor = undefined;
    if (insertAt === undefined) {
      insertAt = indexForThinkingInsertBeforeFirstToolAfterLastUser(state.messages);
    }
    if (insertAt === undefined) {
      insertAt = indexForThinkingInsertAfterLastUser(state.messages);
    }
    const clamped = Math.max(0, Math.min(insertAt, state.messages.length));
    state.messages.splice(clamped, 0, msg);
    const placed = `splice@${clamped}`;
    this.logMessageOrderThinkingFinalized(placed, state.messages.length, text);
    this.latestPendingAssistantAux = stripPendingThinkingMatchingFinalized(
      this.latestPendingAssistantAux,
      text,
    );
  }

  private findPendingAssistantMessageIndex(): number | undefined {
    const state = this.requireState();
    if (this.pendingAssistantMessageId !== undefined) {
      const index = state.messages.findIndex(
        (message) =>
          message.id === this.pendingAssistantMessageId &&
          message.role === 'assistant' &&
          message.pending &&
          !message.tool,
      );
      if (index >= 0) {
        return index;
      }
      this.pendingAssistantMessageId = undefined;
    }

    const fallbackIndex = state.messages.findIndex(
      (message) => message.role === 'assistant' && message.pending && !message.tool,
    );
    if (fallbackIndex >= 0) {
      this.pendingAssistantMessageId = state.messages[fallbackIndex]!.id;
      return fallbackIndex;
    }
    return undefined;
  }

  private ensurePendingAssistantMessage(): ConversationMessageSnapshot {
    const state = this.requireState();
    const existingIndex = this.findPendingAssistantMessageIndex();
    if (existingIndex !== undefined) {
      return state.messages[existingIndex]!;
    }

    const message: ConversationMessageSnapshot = {
      id: this.allocateMessageId(),
      role: 'assistant',
      content: '',
      ...(this.latestPendingAssistantAux ? { aux: { ...this.latestPendingAssistantAux } } : {}),
      pending: true,
    };
    state.messages.push(message);
    this.pendingAssistantMessageId = message.id;
    return message;
  }

  private updatePendingAssistantAux(
    kind: 'thinking' | 'compressing',
    text: string,
  ): void {
    const normalized = text.trim();
    const existingIndex = this.findPendingAssistantMessageIndex();
    const message =
      existingIndex !== undefined
        ? this.requireState().messages[existingIndex]!
        : normalized && this.runtime?.isBusy()
          ? this.ensurePendingAssistantMessage()
          : undefined;
    const currentAux = message?.aux ?? this.latestPendingAssistantAux;
    const nextAux = normalizeMessageAuxSnapshot({
      ...(kind === 'thinking'
        ? normalized
          ? { thinking: text }
          : {}
        : currentAux?.thinking
          ? { thinking: currentAux.thinking }
          : {}),
      ...(kind === 'compressing'
        ? normalized
          ? { compaction: text }
          : {}
        : currentAux?.compaction
          ? { compaction: currentAux.compaction }
          : {}),
    });

    if (message) {
      if (nextAux) {
        message.aux = nextAux;
      } else {
        delete message.aux;
      }
    }

    if (nextAux) {
      this.latestPendingAssistantAux = nextAux;
    } else {
      this.latestPendingAssistantAux = undefined;
    }
  }

  private appendPendingAssistantChunk(chunk: string): void {
    const message = this.ensurePendingAssistantMessage();
    message.content += chunk;
  }

  private replacePendingAssistantText(text: string): void {
    const message = this.ensurePendingAssistantMessage();
    message.content = text;
  }

  private completePendingAssistantMessage(): void {
    const index = this.findPendingAssistantMessageIndex();
    if (index === undefined) {
      this.pendingAssistantMessageId = undefined;
      return;
    }
    const message = this.requireState().messages[index]!;
    message.pending = false;
    this.lastSettledAssistantMessageId = message.id;
    this.pendingAssistantMessageId = undefined;
    this.latestPendingAssistantAux = undefined;
  }

  private removePendingAssistantMessage(): void {
    const index = this.findPendingAssistantMessageIndex();
    if (index === undefined) {
      this.pendingAssistantMessageId = undefined;
      this.latestPendingAssistantAux = undefined;
      return;
    }

    const state = this.requireState();
    const message = state.messages[index]!;
    const aux = normalizeMessageAuxSnapshot(message.aux);
    if (!message.content.trim() && !aux) {
      this.handleMessageRemoved(index, message.id, 'remove-pending-assistant');
      state.messages.splice(index, 1);
    } else {
      message.pending = false;
      if (aux) {
        message.aux = aux;
      } else {
        delete message.aux;
      }
      this.lastSettledAssistantMessageId = message.id;
    }
    this.pendingAssistantMessageId = undefined;
    this.latestPendingAssistantAux = undefined;
  }

  private materializeExistingCompletedAssistantMessage(
    content: string,
    aux?: MessageAuxSnapshot,
  ): boolean {
    const state = this.requireState();
    const normalized = content.trim();
    const finalAux = this.normalizeCompletedAssistantAux(aux);
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const message = state.messages[index]!;
      if (message.role !== 'assistant' || message.tool) {
        continue;
      }
      if (message.pending) {
        continue;
      }
      if (message.content.trim() !== normalized) {
        continue;
      }
      if (finalAux) {
        message.aux = normalizeMessageAuxSnapshot({
          ...(message.aux?.thinking ? { thinking: message.aux.thinking } : {}),
          ...(message.aux?.compaction ? { compaction: message.aux.compaction } : {}),
          ...(finalAux.thinking ? { thinking: finalAux.thinking } : {}),
          ...(finalAux.compaction ? { compaction: finalAux.compaction } : {}),
        });
      }
      if (hasStandaloneThinkingMessageInCurrentTurn(state.messages)) {
        message.aux = stripThinkingFromAux(message.aux);
        if (!message.aux) {
          delete message.aux;
        }
      }
      this.logAssistantAuxDecision('materialize-completed', {
        messageId: message.id,
        aux: message.aux,
        content,
      });
      return true;
    }
    return false;
  }

  private normalizeCompletedAssistantAux(aux?: MessageAuxSnapshot): MessageAuxSnapshot | undefined {
    const normalized = normalizeMessageAuxSnapshot(aux);
    if (!normalized?.thinking) {
      return normalized;
    }
    const state = this.requireState();
    if (!hasStandaloneThinkingMessageInCurrentTurn(state.messages)) {
      return normalized;
    }
    const stripped = stripThinkingFromAux(normalized);
    this.logAssistantAuxDecision('strip-completed-thinking-aux', {
      aux: normalized,
      extra: stripped ? `kept=${describeAuxForDebug(stripped)}` : 'kept=none',
    });
    return stripped;
  }

  private findLastSettledAssistantMessageIndex(): number | undefined {
    if (this.lastSettledAssistantMessageId === undefined) {
      return undefined;
    }

    const state = this.requireState();
    const index = state.messages.findIndex(
      (message) =>
        message.id === this.lastSettledAssistantMessageId &&
        message.role === 'assistant' &&
        !message.tool &&
        !message.pending,
    );
    if (index < 0 || !messageIndexIsInCurrentTurn(state.messages, index)) {
      this.lastSettledAssistantMessageId = undefined;
      return undefined;
    }
    return index;
  }

  private stripFinalizedThinkingFromAssistantAnchors(text: string): void {
    const state = this.requireState();
    const targets: Array<{ kind: 'pending' | 'settled'; index: number | undefined }> = [
      { kind: 'pending', index: this.findPendingAssistantMessageIndex() },
      { kind: 'settled', index: this.findLastSettledAssistantMessageIndex() },
    ];

    for (const target of targets) {
      if (target.index === undefined) {
        continue;
      }
      const message = state.messages[target.index];
      if (!message) {
        continue;
      }
      const beforeAux = normalizeMessageAuxSnapshot(message.aux);
      const afterAux = stripPendingThinkingMatchingFinalized(beforeAux, text);
      const changed = describeOptionalAuxForDebug(beforeAux) !== describeOptionalAuxForDebug(afterAux);
      if (!changed) {
        continue;
      }
      if (afterAux) {
        message.aux = afterAux;
      } else {
        delete message.aux;
      }
      this.logAssistantAuxDecision('strip-finalized-thinking-anchor', {
        messageId: message.id,
        aux: beforeAux,
        finalizedThinking: text,
        extra: `target=${target.kind} next=${describeOptionalAuxForDebug(afterAux)}`,
      });
      return;
    }

    this.logAssistantAuxDecision('strip-finalized-thinking-miss', {
      finalizedThinking: text,
    });
  }

  private ensureActiveSession(seedText: string): void {
    const state = this.requireState();
    if (state.activeSession) {
      return;
    }

    state.activeSession = {
      filePath: defaultNewSessionPath(),
      displayName: deriveDisplayNameFromSeed(seedText),
      kind: 'stored',
    };
  }

  private archiveMessages(): Array<{ role: 'user' | 'assistant'; content: string }> {
    return this.requireState().messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  private archiveAssistantAux(): AssistantAuxArchiveEntry[] {
    return this.requireState().messages.flatMap((message, index) => {
      if (!message.aux) {
        return [];
      }

      const entry: AssistantAuxArchiveEntry = {
        messageIndex: index,
        ...(message.aux.thinking ? { thinking: message.aux.thinking } : {}),
        ...(message.aux.compaction ? { compaction: message.aux.compaction } : {}),
      };
      return [entry];
    });
  }

  private refreshArchiveFromRuntime(): void {
    if (!this.runtime) {
      return;
    }

    const archive = this.runtime.toArchive(
      this.archiveMessages(),
      this.archiveAssistantAux(),
    );
    const state = this.requireState();
    state.archiveHistory = archive.llmHistory;
    state.archiveSubagentSessions = archive.subagentSessions ?? [];
  }

  private async recordHostFileChange(change: HostRecordedFileChange): Promise<void> {
    const state = this.state;
    if (!state?.activeSession) {
      return;
    }

    const stored = toDesktopFileChange(change, nextDesktopRewindSequence(state.rewind));
    await saveRewindFileChange(spiritAgentDataDir(), state.rewind.sessionId, stored);
    const metadata = fileChangeMetadata(stored);
    state.rewind.fileChanges.push(metadata);
    if (!metadata.toolCallId) {
      this.pendingUnboundFileChangeIds.push(metadata.id);
    }
  }

  private bindFileChangesToToolMessage(
    execution: RuntimeToolExecution<DesktopToolRequest>,
    messageId: number,
  ): void {
    const state = this.requireState();
    this.pendingUnboundFileChangeIds = bindRewindFileChangesToToolMessage(
      state.rewind,
      this.pendingUnboundFileChangeIds,
      execution,
      messageId,
    );
  }

  private async recordRewindCheckpoint(
    messageId: number,
    beforeUserCheckpoint?: DesktopRewindCheckpointSnapshot,
  ): Promise<void> {
    this.pruneEmptyAssistantMessages('recordRewindCheckpoint');
    const state = this.requireState();
    if (!state.activeSession) {
      return;
    }
    const messageIndex = state.messages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) {
      return;
    }

    const checkpoint = createRewindCheckpointMetadata(
      messageId,
      messageIndex,
      nextDesktopRewindSequence(state.rewind),
    );
    const archive = this.runtime
      ? this.runtime.toArchive(this.archiveMessages(), this.archiveAssistantAux())
      : {
          messages: this.archiveMessages(),
          assistantAux: this.archiveAssistantAux(),
          llmHistory: state.archiveHistory,
          subagentSessions: state.archiveSubagentSessions ?? [],
        } satisfies ChatArchive;
    await saveRewindCheckpointSnapshot(
      spiritAgentDataDir(),
      state.rewind.sessionId,
      checkpoint.id,
      {
        archive,
        desktopMessages: state.messages.map((message) => ({ ...message })),
        ...(beforeUserCheckpoint
          ? {
              beforeArchive: cloneChatArchive(beforeUserCheckpoint.archive),
              beforeDesktopMessages: beforeUserCheckpoint.desktopMessages.map((message) => ({ ...message })),
            }
          : {}),
      },
    );

    upsertRewindCheckpointMetadata(state.rewind, checkpoint);
  }

  private buildRewindCheckpointSnapshot(): DesktopRewindCheckpointSnapshot {
    this.pruneEmptyAssistantMessages('buildRewindCheckpointSnapshot');
    const state = this.requireState();
    const archive = this.runtime
      ? this.runtime.toArchive(this.archiveMessages(), this.archiveAssistantAux())
      : {
          messages: this.archiveMessages(),
          assistantAux: this.archiveAssistantAux(),
          llmHistory: state.archiveHistory,
          subagentSessions: state.archiveSubagentSessions ?? [],
        } satisfies ChatArchive;
    return {
      archive,
      desktopMessages: state.messages.map((message) => ({ ...message })),
    };
  }

  private restoreBeforeRewindCheckpoint(
    snapshot: DesktopRewindCheckpointSnapshot,
    checkpointSequence: number,
  ): void {
    const state = this.requireState();
    const archive = snapshot.beforeArchive ?? archiveBeforeLastUser(snapshot.archive);
    const desktopMessages = snapshot.beforeDesktopMessages ?? snapshot.desktopMessages.slice(0, -1);

    state.messages = desktopMessages.map((message) => ({ ...message }));
    state.archiveHistory = archive.llmHistory.map((message) => ({
      role: message.role,
      content: message.content,
      imagePaths: [...message.imagePaths],
    }));
    state.archiveSubagentSessions = (archive.subagentSessions ?? []).map((entry) => ({
      summary: { ...entry.summary },
      llmHistory: entry.llmHistory.map((message) => ({
        role: message.role,
        content: message.content,
        imagePaths: [...message.imagePaths],
      })),
    }));
    pruneRewindMetadataAfterCheckpoint(state.rewind, checkpointSequence);
    this.pendingUnboundFileChangeIds = [];
    this.latestPendingAssistantAux = undefined;
    this.messageIdCounter = nextMessageIdFromMessages(state.messages);
    this.resetStreamingPlacementState(true);
    this.pruneEmptyAssistantMessages('restoreBeforeRewindCheckpoint');
    this.requireRuntime().replaceFromArchive(archive);
  }

  private pruneEmptyAssistantMessages(reason: string): void {
    const state = this.requireState();
    const { messages, removed } = pruneEmptyAssistantMessagesFromSnapshots(state.messages);
    state.messages = messages;
    for (const removal of removed) {
      this.handleMessageRemoved(removal.messageIndex, removal.messageId, `prune:${reason}`);
    }
    if (removed.length > 0) {
      const removedIds = removed.map((removal) => removal.messageId);
      console.warn(
        `[desktop-host][messages] dropped ${removedIds.length} empty assistant message(s) during ${reason}: ${removedIds.join(', ')}`,
      );
    }
  }

  private shiftStreamAssistantThinkingAnchorForInsertion(insertAt: number): void {
    this.streamAssistantThinkingAnchor = shiftThinkingAnchorForInsertion(
      this.streamAssistantThinkingAnchor,
      insertAt,
    );
  }

  private shiftStreamAssistantThinkingAnchorForRemoval(removeAt: number, removeCount = 1): void {
    this.streamAssistantThinkingAnchor = shiftThinkingAnchorForRemoval(
      this.streamAssistantThinkingAnchor,
      removeAt,
      removeCount,
    );
  }

  private handleMessageRemoved(messageIndex: number, messageId: number, reason: string): void {
    this.shiftStreamAssistantThinkingAnchorForRemoval(messageIndex);
    if (this.pendingAssistantMessageId === messageId) {
      this.pendingAssistantMessageId = undefined;
    }
    if (this.lastSettledAssistantMessageId === messageId) {
      this.lastSettledAssistantMessageId = undefined;
    }
    this.logAssistantAuxDecision('remove-message-anchor-shift', {
      messageId,
      extra: `reason=${reason} nextAnchor=${this.streamAssistantThinkingAnchor ?? '∅'}`,
    });
  }

  private async persistCurrentSessionIfNeeded(): Promise<void> {
    const state = this.requireState();
    if (!state.activeSession || state.activeSession.kind === 'ephemeral' || this.runtime?.isBusy()) {
      return;
    }

    this.pruneEmptyAssistantMessages('persistCurrentSessionIfNeeded');

    const archive = this.runtime
      ? this.runtime.toArchive(this.archiveMessages(), this.archiveAssistantAux())
      : {
          messages: this.archiveMessages(),
          assistantAux: this.archiveAssistantAux(),
          llmHistory: state.archiveHistory,
          subagentSessions: state.archiveSubagentSessions ?? [],
        } satisfies ChatArchive;

    const stored = buildStoredDesktopSession({
      archive,
      sessionDisplayName: state.activeSession.displayName,
      workspaceRoot: state.workspaceRoot,
      gitBranch: state.git.branch,
      desktopMessages: state.messages,
      rewind: state.rewind,
    });
    state.activeSession.filePath = await saveStoredSession(state.activeSession.filePath, stored);
  }

  private requireState(): HostState {
    if (!this.state) {
      throw new Error('宿主尚未初始化。');
    }
    return this.state;
  }

  private requireRuntime(): DesktopRuntime {
    if (!this.runtime) {
      throw new Error(this.lastRuntimeError || '运行时尚未就绪。');
    }
    return this.runtime;
  }

  private allocateMessageId(): number {
    const next = this.messageIdCounter;
    this.messageIdCounter += 1;
    return next;
  }

  /**
   * @param full `false`：仅清思考插入锚点（新用户轮次，避免误插旧工具链）。`true`：另清 finalize 去重与 apply 批次计数（重置会话 / 打开存档）。
   */
  private resetStreamingPlacementState(full: boolean): void {
    this.pendingAssistantMessageId = undefined;
    this.lastSettledAssistantMessageId = undefined;
    if (!full) {
      this.streamAssistantThinkingAnchor = undefined;
      return;
    }
    this.clearStandalonePendingAuxState();
    this.lastFinalizedThinkingSegment = '';
    this.streamAssistantThinkingAnchor = undefined;
    this.streamAssistantAnchorSetInApplyBatchId = 0;
    this.lastApplyEventBatchId = 0;
    this.messageOrderDebugLastVerboseLogMs = 0;
  }

  private syncStandalonePendingAux(livePendingAux: PendingAssistantAux | undefined): void {
    if (livePendingAux && isStandaloneSubagentStatusAux(livePendingAux)) {
      this.persistedStandalonePendingAux = {
        kind: livePendingAux.kind,
        statusText: livePendingAux.statusText,
        ...(livePendingAux.detailText ? { detailText: livePendingAux.detailText } : {}),
      };
      if (this.standalonePendingAuxMessageId === undefined) {
        this.standalonePendingAuxMessageId = this.allocateMessageId();
      }
      const anchorMessageId = this.pendingAssistantMessageId ?? this.lastSettledAssistantMessageId;
      if (anchorMessageId !== undefined) {
        this.persistedStandalonePendingAuxAnchorMessageId = anchorMessageId;
      }
      return;
    }

    if (!isStandaloneSubagentStatusAux(this.persistedStandalonePendingAux)) {
      this.clearStandalonePendingAuxState();
    }
  }

  private standalonePendingAuxSnapshot(
    livePendingAux: PendingAssistantAux | undefined,
    snapshots: ConversationMessageSnapshot[],
  ):
    | {
        message: ConversationMessageSnapshot;
        insertAt: number;
        source: 'live' | 'persisted';
        anchorMessageId?: number;
        anchorResolvedIndex?: number;
      }
    | undefined {
    const liveStandalonePendingAux =
      livePendingAux && isStandaloneSubagentStatusAux(livePendingAux)
        ? livePendingAux
        : undefined;
    const liveStatusText = liveStandalonePendingAux
      ? parsePendingSubagentStatusText(liveStandalonePendingAux.statusText)
      : undefined;
    if (liveStatusText) {
      return {
        source: 'live',
        insertAt: snapshots.length,
        message: this.standalonePendingAuxMessage(liveStatusText),
      };
    }

    const persistedStandalonePendingAux =
      this.persistedStandalonePendingAux && isStandaloneSubagentStatusAux(this.persistedStandalonePendingAux)
        ? this.persistedStandalonePendingAux
        : undefined;
    const persistedStatusText = persistedStandalonePendingAux
      ? parsePendingSubagentStatusText(persistedStandalonePendingAux.statusText)
      : undefined;
    if (!persistedStatusText) {
      return undefined;
    }

    const anchorMessageId = this.persistedStandalonePendingAuxAnchorMessageId;
    let anchorResolvedIndex: number | undefined;
    let insertAt: number | undefined;
    if (anchorMessageId !== undefined) {
      const anchoredIndex = snapshots.findIndex((message) => message.id === anchorMessageId);
      if (anchoredIndex >= 0) {
        anchorResolvedIndex = anchoredIndex;
        insertAt = rewindStandalonePendingAuxInsertIndexForThinking(snapshots, anchoredIndex);
      }
    }

    if (insertAt === undefined) {
      insertAt = snapshots.length > 0 ? Math.max(0, snapshots.length - 1) : 0;
    }

    return {
      source: 'persisted',
      anchorMessageId,
      anchorResolvedIndex,
      insertAt,
      message: this.standalonePendingAuxMessage(persistedStatusText),
    };
  }

  private standalonePendingAuxMessage(statusText: string): ConversationMessageSnapshot {
    if (this.standalonePendingAuxMessageId === undefined) {
      this.standalonePendingAuxMessageId = this.allocateMessageId();
    }

    return {
      id: this.standalonePendingAuxMessageId,
      role: 'assistant',
      content: statusText,
      pending: false,
    };
  }

  private clearStandalonePendingAuxState(): void {
    this.persistedStandalonePendingAux = undefined;
    this.persistedStandalonePendingAuxAnchorMessageId = undefined;
    this.standalonePendingAuxMessageId = undefined;
    this.lastStandalonePendingAuxSnapshotLogSignature = undefined;
  }

  private logSnapshotStandalonePendingAux(
    standalonePendingAux: {
      message: ConversationMessageSnapshot;
      insertAt: number;
      source: 'live' | 'persisted';
      anchorMessageId?: number;
      anchorResolvedIndex?: number;
    },
    snapshots: ConversationMessageSnapshot[],
  ): void {
    if (messageOrderDebugLevel() !== 'verbose') {
      return;
    }

    const status = truncateOneLineForDebug(standalonePendingAux.message.content, 48);
    const tail = summarizeMessagesTailForOrderDebug(snapshots, 6);
    const signature = [
      standalonePendingAux.source,
      standalonePendingAux.message.id,
      standalonePendingAux.insertAt,
      standalonePendingAux.anchorMessageId ?? '∅',
      standalonePendingAux.anchorResolvedIndex ?? '∅',
      standalonePendingAux.message.content,
      tail,
    ].join('|');
    if (signature === this.lastStandalonePendingAuxSnapshotLogSignature) {
      return;
    }
    this.lastStandalonePendingAuxSnapshotLogSignature = signature;
    console.log(
      `[desktop-host][snapshot] standalone-subagent-status source=${standalonePendingAux.source} msg=${standalonePendingAux.message.id} insert=${standalonePendingAux.insertAt} anchorMsg=${standalonePendingAux.anchorMessageId ?? '∅'} anchorIdx=${standalonePendingAux.anchorResolvedIndex ?? '∅'} status≈${status}${standalonePendingAux.message.content.length > 48 ? '…' : ''} tail=${tail}`,
    );
  }

  private logToolMessageUpdate(
    messageId: number,
    toolCallId: string,
    previousTool: ToolBlockSnapshot | undefined,
    nextTool: ToolBlockSnapshot,
    messages: ReadonlyArray<ConversationMessageSnapshot>,
  ): void {
    const mode = messageOrderDebugLevel();
    if (mode === 'off') {
      return;
    }

    const previousPhase = previousTool?.phase;
    const nextPhase = nextTool.phase;
    const previousHeadline = previousTool?.headline ?? '';
    const nextHeadline = nextTool.headline;
    const previousOutput = previousTool?.outputExcerpt ?? '';
    const nextOutput = nextTool.outputExcerpt ?? '';
    if (
      previousPhase === nextPhase &&
      previousHeadline === nextHeadline &&
      previousOutput === nextOutput
    ) {
      return;
    }

    const tail = summarizeMessagesTailForOrderDebug([...messages], 8);
    console.log(
      `[desktop-host][tool] msg=${messageId} call=${toolCallId} name=${nextTool.toolName} phase=${previousPhase ?? '∅'}->${nextPhase} headline≈${truncateOneLineForDebug(nextHeadline, 42)} tail=${tail}`,
    );
  }

  private takeLatestPendingAux(): MessageAuxSnapshot | undefined {
    const current = this.latestPendingAssistantAux;
    this.latestPendingAssistantAux = undefined;
    if (!current) {
      this.logAssistantAuxDecision('take-pending-aux-none', {
        finalizedThinking: this.lastFinalizedThinkingSegment,
      });
      this.lastFinalizedThinkingSegment = '';
      return undefined;
    }
    if (
      this.lastFinalizedThinkingSegment &&
      current.thinking?.trim() === this.lastFinalizedThinkingSegment.trim()
    ) {
      const { thinking: _thinking, ...rest } = current;
      this.logAssistantAuxDecision('take-pending-aux-strip-exact', {
        aux: current,
        finalizedThinking: this.lastFinalizedThinkingSegment,
        extra: Object.keys(rest).length > 0 ? `kept=${describeAuxForDebug(rest)}` : 'kept=none',
      });
      this.lastFinalizedThinkingSegment = '';
      return Object.keys(rest).length > 0 ? rest : undefined;
    }
    if (current.thinking && hasStandaloneThinkingMessageInCurrentTurn(this.requireState().messages)) {
      const stripped = stripThinkingFromAux(current);
      this.logAssistantAuxDecision('take-pending-aux-strip-standalone', {
        aux: current,
        finalizedThinking: this.lastFinalizedThinkingSegment,
        extra: stripped ? `kept=${describeAuxForDebug(stripped)}` : 'kept=none',
      });
      this.lastFinalizedThinkingSegment = '';
      return stripped;
    }
    this.logAssistantAuxDecision('take-pending-aux-carry', {
      aux: current,
      finalizedThinking: this.lastFinalizedThinkingSegment,
    });
    this.lastFinalizedThinkingSegment = '';
    return current;
  }

  private logAssistantAuxDecision(
    stage: string,
    details: {
      messageId?: number;
      aux?: MessageAuxSnapshot;
      content?: string;
      finalizedThinking?: string;
      extra?: string;
    },
  ): void {
    if (messageOrderDebugLevel() === 'off') {
      return;
    }
    const parts = [stage];
    if (details.messageId !== undefined) {
      parts.push(`msg=${details.messageId}`);
    }
    if (details.aux) {
      parts.push(`aux=${describeAuxForDebug(details.aux)}`);
    }
    if (details.finalizedThinking?.trim()) {
      parts.push(`final≈${truncateOneLineForDebug(details.finalizedThinking, 42)}`);
    }
    if (details.content?.trim()) {
      parts.push(`content≈${truncateOneLineForDebug(details.content, 42)}`);
    }
    if (details.extra) {
      parts.push(details.extra);
    }
    console.log(`[desktop-host][aux] ${parts.join(' ')}`);
  }

  private logMessageOrderApplyBatch(
    batchId: number,
    events: RuntimeEvent<DesktopToolRequest>[],
    state: HostState,
    anchorEnd: number | undefined,
    anchorSourceBatchEnd: number,
  ): void {
    const mode = messageOrderDebugLevel();
    if (mode === 'off') return;

    const tags: string[] = [];
    let previewCount = 0;
    for (const ev of events) {
      if (ev.kind === 'begin-assistant-response') {
        tags.push('begin');
      } else if (ev.kind === 'assistant-response-completed') {
        tags.push('resp-done');
      } else if (ev.kind === 'remove-pending-assistant') {
        tags.push('rm-pending');
      } else if (ev.kind === 'assistant-thinking-segment-finalized') {
        tags.push(ev.text.trim() ? 'finalize' : 'finalize-empty');
      } else if (ev.kind === 'tool-call-started') {
        tags.push(`tool-start:${ev.toolName}`);
      } else if (ev.kind === 'tool-execution-finished') {
        tags.push(`tool-done:${ev.execution.toolName}`);
      } else if (ev.kind === 'approval-resolved') {
        tags.push(`approval-${ev.decisionKind}`);
      } else if (ev.kind === 'approval-requested') {
        tags.push(`approval:${ev.approval.toolName}`);
      } else if (ev.kind === 'questions-requested') {
        tags.push(`questions:${ev.questions.toolName}`);
      } else if (ev.kind === 'streaming-tool-preview') {
        previewCount += 1;
      }
    }

    const hasOrderTags = tags.length > 0;
    if (!hasOrderTags && previewCount === 0) {
      return;
    }

    if (mode === 'compact' && !hasOrderTags) {
      return;
    }

    if (!hasOrderTags && previewCount > 0 && mode === 'verbose') {
      const now = Date.now();
      if (now - this.messageOrderDebugLastVerboseLogMs < 1200) {
        return;
      }
      this.messageOrderDebugLastVerboseLogMs = now;
      tags.push(`preview×${previewCount}`);
    } else if (hasOrderTags && previewCount > 0 && mode === 'verbose') {
      tags.push(`pv×${previewCount}`);
    }

    const tail = summarizeMessagesTailForOrderDebug(state.messages, 12);
    console.log(
      `[desktop-host][msg-order] apply#${batchId} kinds=${tags.join(',')} anchor=${anchorEnd ?? '∅'} anchorBatch=${anchorSourceBatchEnd} len=${state.messages.length} tail=${tail}`,
    );
  }

  private logMessageOrderThinkingFinalized(placed: string, lenAfter: number, text: string): void {
    if (messageOrderDebugLevel() === 'off') {
      return;
    }
    const one = text.replace(/\s+/g, ' ').trim();
    const clip = one.slice(0, 72);
    console.log(
      `[desktop-host][msg-order] thinking-finalized ${placed} len=${lenAfter} text≈${clip}${one.length > 72 ? '…' : ''}`,
    );
  }

  private logMessageOrderPrefixSync(how: string, state: HostState): void {
    if (messageOrderDebugLevel() === 'off') {
      return;
    }
    const tail = summarizeMessagesTailForOrderDebug(state.messages, 10);
    console.log(`[desktop-host][msg-order] prefix-sync ${how} len=${state.messages.length} tail=${tail}`);
  }

  private logMessageOrderToolPreviewNew(toolName: string, pushAt: number): void {
    if (messageOrderDebugLevel() === 'off') {
      return;
    }
    console.log(`[desktop-host][msg-order] tool-preview-new ${toolName} push@${pushAt}`);
  }

  private async runSerialized<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.serialized;
    let release: (() => void) | undefined;
    this.serialized = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release?.();
    }
  }

  private requireEnabledSkillEntry(skillName: string): HostMetadataSummary['skills']['entries'][number] {
    const normalized = skillName.trim();
    const entry = this.requireState().metadata.skills.entries.find(
      (candidate) => candidate.enabled && candidate.source.name === normalized,
    );
    if (!entry) {
      throw new Error(`未找到已启用 Skill：${normalized}`);
    }
    return entry;
  }

  private requireToolExecutor(): DesktopToolExecutor {
    if (!this.toolExecutor) {
      throw new Error('Desktop MCP tool executor 尚未初始化。');
    }
    return this.toolExecutor;
  }

  private requireExtensionHostAdapter(): DesktopExtensionHostAdapter {
    if (!desktopExtensionHostAdapter) {
      throw new Error('当前宿主未提供扩展运行环境；请在 Electron Desktop 中运行该扩展。');
    }
    return desktopExtensionHostAdapter;
  }
}

function cloneActiveSkills(skills: OpenAiActiveSkill[]): OpenAiActiveSkill[] {
  return skills.map((skill) => ({
    ...skill,
    resources: skill.resources.map((resource) => ({ ...resource })),
  }));
}

const desktopHostService = new DesktopHostService();

export function setDesktopMarketplaceFetchImplementation(
  fetchImpl: typeof fetch | undefined,
): void {
  desktopHostService.setMarketplaceFetchImpl(fetchImpl);
}

export async function invokeDesktopHostCommand(
  command: HostCommandName,
  payload?: unknown,
): Promise<unknown> {
  return desktopHostService.invoke(command, payload);
}

export function subscribeDesktopDreamUpdates(
  listener: (snapshot: DesktopSnapshot) => void,
): () => void {
  return desktopHostService.subscribeDreamUpdates(listener);
}

function truncateJson(value: unknown): string {
  return truncateText(JSON.stringify(value, null, 2), 4_000);
}

function truncateText(value: string, maxChars: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxChars) {
    return value;
  }
  return `${chars.slice(0, maxChars).join('')}...<truncated>`;
}

