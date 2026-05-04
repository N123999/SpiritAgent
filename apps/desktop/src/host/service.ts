import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildActiveSkillsSystemMessage,
  buildDreamCollectorSystemMessage,
  buildExtensionsSystemMessage,
  buildPlanSystemMessage,
  buildRulesSystemMessage,
  buildSkillsCatalogSystemMessage,
  buildToolAgentHostPrompt,
  type OpenAiActiveSkill,
  type OpenAiExtensionSystemPrompt,
  OpenAiTransport,
  type AssistantAuxArchiveEntry,
  type ChatArchive,
  type OpenAiEnabledRule,
  type OpenAiEnabledSkillCatalogEntry,
  type OpenAiPlanMetadata,
  type OpenAiTransportConfig,
  type RuntimeToolExecution,
} from '@spirit-agent/agent-core';
import {
  createHostExtensionMarketplace,
  createHostExtensionManager,
  createHostDreamStore,
  defaultModelReasoningEffort,
  listOpenAiCompatibleModelIds,
  resolveModelReasoningEffortForContext,
  restoreHostFileChanges,
  type ModelReasoningEffort,
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
  DesktopSnapshot,
  FileRewindWarning,
  RunExtensionRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
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
  UpdateConfigRequest,
  WorkspaceExplorerListResult,
  WorkspaceReadTextFileResult,
  WriteWorkspaceTextFileRequest,
} from '../types.js';
import type { DesktopToolRequest, HostCommandName } from './contracts.js';
import {
  buildArchiveAssistantAuxFromConversation,
  buildArchiveMessagesFromConversation,
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
  sanitizeConversationMessagesForPersistence,
} from './sessions.js';
import {
  isModelCatalogCacheFresh,
  readModelCatalogCache,
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
  cloneActiveSkills,
  createDesktopRuntime,
  type DesktopRuntime,
} from './runtime.js';
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
import { DesktopConversationSnapshotView } from './conversation-snapshot.js';
import { buildDesktopSnapshot } from './snapshot.js';
import {
  messageOrderDebugLevel,
  messageIndexIsInCurrentTurn,
  parsePendingSubagentStatusText,
  restoreMessagesFromArchive,
  summarizeMessagesTailForOrderDebug,
  truncateOneLineForDebug,
} from './message-ordering.js';
import { DesktopAssistantMessageStateMachine } from './assistant-message-state.js';
import { DesktopRuntimeEventOrchestrator } from './runtime-event-orchestrator.js';
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
  exportSessionLog: undefined;
  submitUserTurn: { text: string };
  abortConversation: undefined;
  continueAssistantCompletion: { messageId: number };
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
  private readonly conversationSnapshotView = new DesktopConversationSnapshotView(() => this.allocateMessageId());
  private readonly assistantMessages = new DesktopAssistantMessageStateMachine({
    messages: () => this.requireState().messages,
    setMessages: (messages) => {
      this.requireState().messages = messages;
    },
    allocateMessageId: () => this.allocateMessageId(),
    isRuntimeBusy: () => this.runtime?.isBusy() ?? false,
  });
  private readonly runtimeEvents = new DesktopRuntimeEventOrchestrator({
    runtime: () => this.runtime,
    messages: () => this.requireState().messages,
    allocateMessageId: () => this.allocateMessageId(),
    assistantMessages: this.assistantMessages,
    conversationSnapshotView: this.conversationSnapshotView,
    clearCurrentTurnSkills: () => {
      this.currentTurnSkills = [];
    },
    setLastRuntimeError: (error) => {
      this.lastRuntimeError = error;
    },
    refreshArchiveFromRuntime: () => this.refreshArchiveFromRuntime(),
    dispatchExtensionEvent: (event) => {
      void this.dispatchExtensionEvent(event);
    },
    bindFileChangesToToolMessage: (execution, messageId) => {
      this.bindFileChangesToToolMessage(execution, messageId);
    },
  });
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
      const reasoningEffort = request.reasoningEffort;
      const existing = state.config.models.find((model) => model.name === activeModel);
      if (existing) {
        existing.apiBase = apiBase;
        if (reasoningEffort !== undefined) {
          existing.reasoningEffort = resolveModelReasoningEffortForContext(reasoningEffort, {
            ...(existing.provider ? { provider: existing.provider } : {}),
            model: existing.name,
          });
        }
      } else {
        state.config.models.push({
          name: activeModel,
          apiBase,
          reasoningEffort: resolveModelReasoningEffortForContext(reasoningEffort, {
            model: activeModel,
          }),
        });
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

      type NewProfile = {
        name: string;
        apiBase: string;
        reasoningEffort: ModelReasoningEffort;
        provider?: DesktopModelProvider;
      };
      const toAdd: NewProfile[] = [];
      for (const name of uniqueIds) {
        if (state.config.models.some((model) => model.name === name)) {
          continue;
        }
        const profile: NewProfile = {
          name,
          apiBase,
          reasoningEffort: defaultModelReasoningEffort({
            ...(provider !== undefined ? { provider } : {}),
            model: name,
          }),
        };
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
      const profile: {
        name: string;
        apiBase: string;
        reasoningEffort: ModelReasoningEffort;
        provider?: DesktopModelProvider;
      } = {
        name,
        apiBase,
        reasoningEffort: defaultModelReasoningEffort({
          ...(provider !== undefined ? { provider } : {}),
          model: name,
        }),
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

  async exportSessionLog(): Promise<{ snapshot: DesktopSnapshot; path: string }> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });

      const state = this.requireState();
      const runtime = this.requireRuntime();
      const extensionSystemPrompts = await this.collectExtensionSystemPrompts();
      const rulesSystemPrompt = buildRulesSystemMessage(state.metadata.rules.enabledRules);
      const skillsCatalogSystemPrompt = buildSkillsCatalogSystemMessage(
        state.metadata.skills.enabledSkillCatalog,
      );
      const planSystemPrompt = buildPlanSystemMessage(state.metadata.planMetadata);
      const activeSkillsSystemPrompt = buildActiveSkillsSystemMessage(this.currentTurnSkills);
      const extensionsSystemPrompt = buildExtensionsSystemMessage(extensionSystemPrompts);
      const exportedAtUnixSecs = Math.floor(Date.now() / 1000);
      const filePath = path.join(
        tmpdir(),
        `spirit-agent-llm-export-${exportedAtUnixSecs}-${process.pid}.json`,
      );
      const exportPayload = {
        export_version: 2,
        exported_at_unix_secs: exportedAtUnixSecs,
        active_model: state.config.activeModel,
        api_base: currentApiBase(state.config),
        working_directory: state.workspaceRoot,
        system_prompts: {
          ...(this.transport.llmSystemPromptsForExport() as Record<string, unknown>),
          tool_agent: buildToolAgentHostPrompt(state.config.activeModel),
          ...(rulesSystemPrompt === undefined ? {} : { rules: rulesSystemPrompt }),
          ...(skillsCatalogSystemPrompt === undefined
            ? {}
            : { skillsCatalog: skillsCatalogSystemPrompt }),
          ...(planSystemPrompt === undefined ? {} : { plan: planSystemPrompt }),
          ...(activeSkillsSystemPrompt === undefined
            ? {}
            : { activeSkills: activeSkillsSystemPrompt }),
          ...(extensionsSystemPrompt === undefined ? {} : { extensions: extensionsSystemPrompt }),
        },
        note: 'messages: 内存 llm_history 的 API 形态。api_request_trace: 每步模型推理均为一次 tool_agent_chat_completions，stream=true，含 tools；多轮工具时会有多条 trace（每轮一次 HTTP），失败轮次也会保留最后一次请求体。system_prompts 为 transport 导出的 system 文案（如 tool_agent），供调试与导出。',
        message_count: runtime.history().length,
        messages: this.transport.llmHistoryAsApiMessages([...runtime.history()]),
        api_request_trace_count: runtime.requestTrace().length,
        api_request_trace: [...runtime.requestTrace()],
      };

      await writeFile(filePath, `${JSON.stringify(exportPayload, null, 2)}\n`, 'utf8');

      const snapshot = await this.appendInlineAssistantReply(
        '/log-session',
        [
          '已导出：llm_history、完整 API 请求轨迹（含 tools 与 system）、system 全文：',
          filePath,
        ].join('\n'),
      );

      return {
        snapshot,
        path: filePath,
      };
    });
  }

  async submitUserTurn(text: string): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      return this.submitUserTurnAfterInitialized(text);
    });
  }

  async abortConversation(): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const runtime = this.requireRuntime();
      const interruptedAssistantText = runtime.pendingAssistantText().trim();
      const interruptedAssistantAuxText =
        runtime.thinkingText().trim() || runtime.compactionText().trim();
      const interruptible =
        runtime.isBusy() &&
        !runtime.currentPendingApproval() &&
        !runtime.currentPendingQuestions();

      if (!interruptible) {
        return this.buildSnapshot();
      }

      runtime.abort();
      this.currentTurnSkills = [];
      this.runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
      this.runtimeEvents.consumeCompletedTurnResult();
      this.runtimeEvents.syncPendingToolStates();
      this.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
      if (interruptedAssistantText || interruptedAssistantAuxText) {
        this.markAssistantMessageContinuable(interruptedAssistantText);
      } else {
        this.markLatestRenderableAssistantMessageContinuableInCurrentTurn();
      }
      await this.persistCurrentSessionIfNeeded();
      await this.flushDeferredRuntimeRefreshIfIdle();
      if (!runtime.isBusy()) {
        await this.refreshGitState();
      }
      return this.buildSnapshot();
    });
  }

  async continueAssistantCompletion(messageId: number): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const runtime = this.requireRuntime();
      if (runtime.isBusy()) {
        throw new Error('当前已有响应或审批在处理中，请稍候。');
      }
      if (!Number.isFinite(messageId)) {
        throw new Error('消息 id 无效。');
      }

      const state = this.requireState();
      if (state.activeSession?.readOnly) {
        throw new Error('当前调试会话为只读，无法继续补全。');
      }

      const continuable = this.latestContinuableAssistantMessage();
      if (!continuable || continuable.id !== messageId) {
        throw new Error('当前消息已不可继续补全。');
      }

      const previousContinuationIds = this.requireState().messages
        .filter((message) => message.canContinue === true)
        .map((message) => message.id);
      try {
        this.clearAssistantContinuationMarkers();
        await this.persistCurrentSessionIfNeeded();
        await runtime.continueAssistantCompletionStreaming();
      } catch (error) {
        for (const message of this.requireState().messages) {
          if (previousContinuationIds.includes(message.id)) {
            message.canContinue = true;
          }
        }
        throw error;
      }
      this.refreshArchiveFromRuntime();
      await runtime.poll();
      this.runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
      this.runtimeEvents.consumeCompletedTurnResult();
      this.runtimeEvents.syncPendingToolStates();
      this.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
      await this.flushDeferredRuntimeRefreshIfIdle();
      if (!runtime.isBusy()) {
        await this.refreshGitState();
      }
      return this.buildSnapshot();
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
    this.clearAssistantContinuationMarkers();
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
      this.runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
    } catch (error) {
      this.currentTurnSkills = [];
      this.assistantMessages.handleMessageRemoved(state.messages.length - 1, userMessage.id, 'send-user-rollback');
      state.messages.pop();
      throw error;
    }

    this.runtimeEvents.consumeCompletedTurnResult();
    this.runtimeEvents.syncPendingToolStates();
    this.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
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
    this.clearAssistantContinuationMarkers();
    this.ensureActiveSession(displayText);
    state.messages.push({
      id: this.allocateMessageId(),
      role: 'user',
      content: displayText,
      pending: false,
    });
    this.resetStreamingPlacementState(false);
    this.assistantMessages.appendAssistantMessage(assistantText);
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
        this.runtimeEvents.applyRuntimeHostEvents(this.runtime.drainEvents());
      }
      this.runtimeEvents.consumeCompletedTurnResult();
      this.runtimeEvents.syncPendingToolStates();
      this.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
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
      this.runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
      this.runtimeEvents.consumeCompletedTurnResult();
      this.runtimeEvents.syncPendingToolStates();
      this.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
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
      this.runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
      this.runtimeEvents.consumeCompletedTurnResult();
      this.runtimeEvents.syncPendingToolStates();
      this.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
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
      case 'exportSessionLog':
        return this.exportSessionLog();
      case 'submitUserTurn': {
        const typedPayload = payload as CommandPayloads['submitUserTurn'];
        return this.submitUserTurn(typedPayload.text);
      }
      case 'abortConversation':
        return this.abortConversation();
      case 'continueAssistantCompletion': {
        const typedPayload = payload as CommandPayloads['continueAssistantCompletion'];
        return this.continueAssistantCompletion(typedPayload.messageId);
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
      this.resetStreamingPlacementState(true);
      this.messageIdCounter = 1;
      this.lastRuntimeError = '';
      this.toolExecutor = undefined;
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
    await this.ensureToolExecutor();
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
        reasoningEffort: activeProfile?.reasoningEffort,
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

  private async ensureToolExecutor(): Promise<DesktopToolExecutor> {
    if (!this.toolExecutor) {
      const state = this.requireState();
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
      return this.toolExecutor;
    }

    await this.refreshExtensionToolDefinitions();
    return this.toolExecutor;
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
    return createDesktopRuntime({
      transportConfig,
      history,
      enabledRules,
      enabledSkillCatalog,
      planMetadata,
      extensionSystemPrompts,
      toolExecutor,
      llmTransport: this.transport,
      activeSkills: this.currentTurnSkills,
      workspaceRoot,
    });
  }

  private buildSnapshot(): DesktopSnapshot {
    const state = this.requireState();
    const pendingApproval = this.runtime?.currentPendingApproval();
    const pendingQuestions = this.runtime?.currentPendingQuestions();
    const pendingAux = this.runtime?.pendingAuxState();
    const standaloneAnchorState = this.assistantMessages.standaloneAnchorState();
    this.conversationSnapshotView.syncStandalonePendingAux({
      livePendingAux: pendingAux,
      pendingAssistantMessageId: standaloneAnchorState.pendingAssistantMessageId,
      lastSettledAssistantMessageId: standaloneAnchorState.lastSettledAssistantMessageId,
    });
    if (pendingAux && !parsePendingSubagentStatusText(pendingAux.statusText)) {
      this.assistantMessages.updatePendingAssistantAux(
        pendingAux.kind,
        pendingAux.detailText ?? pendingAux.statusText,
      );
    }
    this.assistantMessages.pruneEmptyAssistantMessages('buildSnapshot');

    const conversationMessages = this.conversationSnapshotView.buildMessagesWithPendingAssistant({
      messages: state.messages,
      livePendingAux: pendingAux,
      rewind: state.rewind,
    });
    this.logContinuationSnapshotState({
      rawMessages: state.messages,
      visibleMessages: conversationMessages,
      isBusy: this.runtime?.isBusy() ?? false,
      pendingAux,
    });

    return buildDesktopSnapshot({
      workspaceRoot: state.workspaceRoot,
      config: state.config,
      git: state.git,
      metadata: state.metadata,
      extensionsList: state.extensionsList,
      extensionCss: state.extensionCss,
      dreamCollectorStatus: this.dreamCollectorStatus,
      runtimeReady: this.runtime !== undefined,
      runtimeError: this.lastRuntimeError,
      modelKeyPresence: this.modelKeyPresence,
      activeApiKeyConfigured: this.activeApiKeyConfigured,
      mcpStatus: this.toolExecutor?.mcpStatusSnapshot() ?? emptyMcpStatusSnapshot(),
      mcpServers: listDesktopMcpServersFromDisk(),
      conversation: {
        messages: conversationMessages,
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
      ...(state.activeSession ? { activeSession: state.activeSession } : {}),
    });
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
    return buildArchiveMessagesFromConversation(this.requireState().messages);
  }

  private archiveAssistantAux(): AssistantAuxArchiveEntry[] {
    return buildArchiveAssistantAuxFromConversation(this.requireState().messages);
  }

  private clearAssistantContinuationMarkers(): void {
    const messages = this.requireState().messages;
    for (const message of messages) {
      delete message.canContinue;
    }
  }

  private markAssistantMessageContinuable(content: string): void {
    const normalized = content.trim();
    this.clearAssistantContinuationMarkers();

    const messages = this.requireState().messages;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]!;
      const hasRenderableAux = Boolean(
        message.aux?.thinking?.trim() || message.aux?.compaction?.trim(),
      );
      const hasRenderableTool = Boolean(message.tool);
      if (
        message.role !== 'assistant' ||
        message.pending ||
        (!message.content.trim() && !hasRenderableAux && !hasRenderableTool)
      ) {
        continue;
      }
      if (normalized && !message.tool && message.content.trim() !== normalized) {
        continue;
      }
      message.canContinue = true;
      this.logContinuationMarker('marked', message, normalized, messages);
      return;
    }

    this.logContinuationMarker('missing', undefined, normalized, messages);
  }

  private latestContinuableAssistantMessage(): ConversationMessageSnapshot | undefined {
    const messages = this.requireState().messages;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]!;
      if (
        message.role === 'assistant' &&
        !message.pending &&
        message.canContinue === true
      ) {
        return message;
      }
    }
    return undefined;
  }

  private markLatestRenderableAssistantMessageContinuableInCurrentTurn(): void {
    this.clearAssistantContinuationMarkers();

    const messages = this.requireState().messages;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]!;
      if (!messageIndexIsInCurrentTurn(messages, index)) {
        break;
      }

      const hasRenderableAux = Boolean(
        message.aux?.thinking?.trim() || message.aux?.compaction?.trim(),
      );
      const hasRenderableTool = Boolean(message.tool);
      if (
        message.role !== 'assistant' ||
        message.pending ||
        (!message.content.trim() && !hasRenderableAux && !hasRenderableTool)
      ) {
        continue;
      }

      message.canContinue = true;
      this.logContinuationMarker('marked-fallback', message, '', messages);
      return;
    }

    this.logContinuationMarker('missing-fallback', undefined, '', messages);
  }

  private logContinuationMarker(
    outcome: 'marked' | 'missing' | 'marked-fallback' | 'missing-fallback',
    message: ConversationMessageSnapshot | undefined,
    normalized: string,
    messages: ConversationMessageSnapshot[],
  ): void {
    if (messageOrderDebugLevel() !== 'verbose') {
      return;
    }

    const target = message
      ? this.describeContinuationMessage(message)
      : '∅';
    const text = normalized ? truncateOneLineForDebug(normalized, 48) : '∅';
    const tail = summarizeMessagesTailForOrderDebug(messages, 8);
    console.log(
      `[desktop-host][continue] mark outcome=${outcome} normalized≈${text}${normalized.length > 48 ? '…' : ''} target=${target} tail=${tail}`,
    );
  }

  private logContinuationSnapshotState(input: {
    rawMessages: ConversationMessageSnapshot[];
    visibleMessages: ConversationMessageSnapshot[];
    isBusy: boolean;
    pendingAux: PendingAssistantAux | undefined;
  }): void {
    if (messageOrderDebugLevel() !== 'verbose') {
      return;
    }

    const rawMarked = input.rawMessages.filter((message) => message.canContinue === true);
    const visibleMarked = input.visibleMessages.filter((message) => message.canContinue === true);
    if (rawMarked.length === 0 && visibleMarked.length === 0) {
      return;
    }

    const pendingAux = input.pendingAux
      ? `${input.pendingAux.kind}:${truncateOneLineForDebug(input.pendingAux.detailText ?? input.pendingAux.statusText, 36)}`
      : 'none';
    console.log(
      `[desktop-host][continue] snapshot busy=${input.isBusy} pendingAux=${pendingAux} raw=${rawMarked.map((message) => this.describeContinuationMessage(message)).join(',') || '∅'} visible=${visibleMarked.map((message) => this.describeContinuationMessage(message)).join(',') || '∅'} rawTail=${summarizeMessagesTailForOrderDebug(input.rawMessages, 8)} visibleTail=${summarizeMessagesTailForOrderDebug(input.visibleMessages, 8)}`,
    );
  }

  private describeContinuationMessage(message: ConversationMessageSnapshot): string {
    const kind = message.tool
      ? `tool:${message.tool.phase}:${message.tool.toolName}`
      : message.aux?.thinking?.trim()
        ? 'thinking'
        : message.aux?.compaction?.trim()
          ? 'compaction'
          : message.content.trim()
            ? 'content'
            : 'empty';
    const text = message.content.trim()
      ? truncateOneLineForDebug(message.content, 28)
      : '∅';
    return `${message.id}:${kind}:${text}`;
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
    this.assistantMessages.pruneEmptyAssistantMessages('recordRewindCheckpoint');
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
        desktopMessages: sanitizeConversationMessagesForPersistence(state.messages),
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
    this.assistantMessages.pruneEmptyAssistantMessages('buildRewindCheckpointSnapshot');
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
      desktopMessages: sanitizeConversationMessagesForPersistence(state.messages),
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
    this.messageIdCounter = nextMessageIdFromMessages(state.messages);
    this.resetStreamingPlacementState(true);
    this.assistantMessages.pruneEmptyAssistantMessages('restoreBeforeRewindCheckpoint');
    this.requireRuntime().replaceFromArchive(archive);
  }

  private async persistCurrentSessionIfNeeded(): Promise<void> {
    const state = this.requireState();
    if (!state.activeSession || state.activeSession.kind === 'ephemeral' || this.runtime?.isBusy()) {
      return;
    }

    this.assistantMessages.pruneEmptyAssistantMessages('persistCurrentSessionIfNeeded');

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
    this.assistantMessages.resetStreamingPlacementState(full);
    if (!full) {
      return;
    }
    this.conversationSnapshotView.clearStandalonePendingAuxState();
    this.runtimeEvents.reset();
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

