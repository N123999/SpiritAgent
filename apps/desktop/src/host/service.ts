import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AgentRuntime,
  buildDreamCollectorSystemMessage,
  buildExtensionsSystemMessage,
  buildPlanSystemMessage,
  buildRulesSystemMessage,
  buildSkillsCatalogSystemMessage,
  buildContributedHostToolDefinitions,
  type OpenAiActiveSkill,
  type OpenAiActiveSkillResourceEntry,
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
  type AskQuestionsResult as RuntimeAskQuestionsResult,
  type ChatArchive,
  type JsonObject,
  type OpenAiEnabledRule,
  type OpenAiEnabledSkillCatalogEntry,
  type OpenAiPlanMetadata,
  type OpenAiToolAgentState,
  type OpenAiTransportConfig,
  type RuntimeApprovalDecision,
  type RuntimePendingApproval,
  type RuntimePendingQuestions,
  type RuntimeEvent,
  type RuntimeToolExecution,
  mcpUserConfigPath,
  normalizeCapabilityToggles,
  normalizeMcpServerConfig,
  parseMcpConfigFile,
  summarizeTransport,
  type McpConfigFile,
  type McpServerConfig,
} from '@spirit-agent/agent-core';
import {
  collectHostExtensionContributedTools,
  createHostExtensionMarketplace,
  createHostExtensionManager,
  createHostDreamStore,
  dreamLogsDirPath,
  listOpenAiCompatibleModelIds,
  resolveInstructionPaths,
  SKILL_FILE_NAME,
  validateSkillName,
  restoreHostFileChanges,
  type HostExtensionMarketplaceManager,
  type HostDreamSessionProgress,
  type HostExtensionEvent,
  type HostInstalledExtension,
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
  DesktopMcpServerListItem,
  DesktopSkillRootKind,
  DesktopModelCatalogHint,
  DesktopSnapshot,
  DesktopWebHostSnapshot,
  FileRewindWarning,
  RunExtensionRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  MessageAuxSnapshot,
  PendingAssistantAux,
  PendingQuestionsSnapshot,
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
  WorkspaceExplorerEntry,
  WorkspaceExplorerListResult,
  WorkspaceReadTextFileResult,
  WriteWorkspaceTextFileRequest,
} from '../types.js';
import type { DesktopToolRequest, HostCommandName, StoredDesktopSession } from './contracts.js';
import {
  isModelCatalogCacheFresh,
  readModelCatalogCache,
  readModelCatalogCacheSync,
  writeModelCatalogCache,
} from './model-catalog-cache.js';
import {
  DEFAULT_API_BASE,
  chatsDirPath,
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
  buildWorkspaceGitCommitMessageContext,
  commitWorkspaceChanges,
  readWorkspaceGitSnapshot,
} from './git.js';
import {
  DESKTOP_WEB_HOST_POLICY,
  getDesktopWebHostRuntimeStatus,
} from './web-host-state.js';
import {
  createDesktopRewindMetadata,
  createRewindCheckpointMetadata,
  fileChangeMetadata,
  loadRewindCheckpointSnapshot,
  loadRewindFileChange,
  nextDesktopRewindSequence,
  saveRewindCheckpointSnapshot,
  saveRewindFileChange,
  toDesktopFileChange,
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

function normalizeWorkspaceRootKey(workspaceRoot: string): string {
  return workspaceRoot.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
}

function sameWorkspaceRoot(left: string, right: string): boolean {
  return normalizeWorkspaceRootKey(left) === normalizeWorkspaceRootKey(right);
}

function deriveWorkspaceLabel(workspaceRoot: string): string {
  const normalized = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/g, '');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) || normalized : normalized;
}

function buildAvailableWorkspaces(currentWorkspaceRoot: string, recentWorkspaces?: string[]) {
  return mergeRecentWorkspaceRoots(recentWorkspaces, currentWorkspaceRoot).map((workspaceRoot) => ({
    path: workspaceRoot,
    label: deriveWorkspaceLabel(workspaceRoot),
  }));
}

const EPHEMERAL_COMMIT_SESSION_PREFIX = 'ephemeral://commit-message/';
const MAX_EPHEMERAL_COMMIT_SESSIONS = 8;
const DREAM_DEBUG_SESSION_FILE_PREFIX = 'dream-collector-';
const DREAM_RETENTION_MS = 5 * 24 * 60 * 60 * 1000;
const DREAM_COLLECTOR_TICK_INTERVAL_MS = 30_000;
const DREAM_COLLECTOR_BACKOFF_MS = 60_000;
const DREAM_COLLECTOR_SOURCE_CONTEXT_MAX_CHARS = 16_000;
const DREAM_COLLECTOR_INCREMENTAL_CONTEXT_MAX_CHARS = 8_000;
const DREAM_COLLECTOR_ANCHOR_CONTEXT_MAX_CHARS = 4_000;
const DREAM_COLLECTOR_ANCHOR_MESSAGE_COUNT = 4;
const DREAM_COLLECTOR_SESSION_COOLDOWN_MS = 2 * 60 * 1000;
const DREAM_COMMIT_CONTEXT_MAX_CHARS = 6_000;

interface EphemeralSessionRecord {
  path: string;
  displayName: string;
  workspaceRoot: string;
  modifiedAtUnixMs: number;
  messages: ConversationMessageSnapshot[];
  llmHistory: ChatArchive['llmHistory'];
  readOnly: true;
}

function isEphemeralCommitSessionPath(filePath: string): boolean {
  return filePath.startsWith(EPHEMERAL_COMMIT_SESSION_PREFIX);
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

  async bootstrap(request?: BootstrapRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(request?.workspaceRoot);
      return this.buildSnapshot();
    });
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

      const rootKind = this.parseSkillRootKind(request.rootKind);
      const name = request.name.trim().toLowerCase();
      const nameIssue = validateSkillName(name);
      if (nameIssue) {
        throw new Error(nameIssue);
      }

      const description = (request.description ?? '').trim();
      if (!description) {
        throw new Error('描述不能为空。');
      }
      const skillDir = this.resolveSkillDir(name, rootKind);
      if (existsSync(skillDir)) {
        throw new Error(`该位置已存在同名 Skill：${name}`);
      }

      const frontmatterDescription = formatYamlScalarForSkillFrontmatter(description);
      const fileContent = `---
name: ${name}
description: ${frontmatterDescription}
---

在此编写技能正文：步骤、示例、边界条件与相对路径引用。
`;

      await mkdir(skillDir, { recursive: true });
      await writeFile(path.join(skillDir, SKILL_FILE_NAME), fileContent, 'utf8');

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

      const rootKind = this.parseSkillRootKind(request.rootKind);
      const name = request.name.trim().toLowerCase();
      const nameIssue = validateSkillName(name);
      if (nameIssue) {
        throw new Error(nameIssue);
      }

      const skillDir = this.resolveSkillDir(name, rootKind);
      this.assertPathUnderSkillRoot(skillDir, rootKind);

      if (!existsSync(skillDir)) {
        throw new Error(`Skill 不存在：${name}`);
      }

      await rm(skillDir, { recursive: true, force: true });

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
        buildCreateSkillUserTurn(state.workspaceRoot, this.instructionPaths(), prompt),
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
      const ephemeral: SessionListItem[] = state.ephemeralSessions.map((session) => ({
        path: session.path,
        displayName: session.displayName,
        modifiedAtUnixMs: session.modifiedAtUnixMs,
        workspaceRoot: session.workspaceRoot,
        kind: 'ephemeral',
        readOnly: true,
      }));
      return [...stored, ...ephemeral].sort((left, right) => right.modifiedAtUnixMs - left.modifiedAtUnixMs);
    });
  }

  async listWorkspaceExplorerChildren(relativePath: string): Promise<WorkspaceExplorerListResult> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const state = this.requireState();
      const dir = this.resolveWorkspaceRelativePath(state, relativePath);
      let st;
      try {
        st = await stat(dir);
      } catch {
        return { entries: [] };
      }
      if (!st.isDirectory()) {
        return { entries: [] };
      }
      const dirents = await readdir(dir, { withFileTypes: true });
      const entries: WorkspaceExplorerEntry[] = dirents
        .filter((d) => d.name && d.name !== '.' && d.name !== '..')
        .map((d) => ({
          name: d.name,
          kind: d.isDirectory() ? 'dir' : 'file',
        }));
      entries.sort((a, b) => {
        if (a.kind !== b.kind) {
          return a.kind === 'dir' ? -1 : 1;
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      return { entries };
    });
  }

  /** 单文件上限，避免大文件拖垮渲染进程。 */
  private static readonly workspaceTextFileMaxBytes = 2 * 1024 * 1024;

  async readWorkspaceTextFile(relativePath: string): Promise<WorkspaceReadTextFileResult> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const state = this.requireState();
      const posix = relativePath.replace(/\0/g, '').replace(/\\/g, '/').trim();
      if (!posix) {
        throw new Error('未指定文件路径');
      }
      const filePath = this.resolveWorkspaceRelativePath(state, relativePath);
      let st;
      try {
        st = await stat(filePath);
      } catch {
        throw new Error('文件不存在或无法访问');
      }
      if (!st.isFile()) {
        throw new Error('不是文件');
      }
      if (st.size > DesktopHostService.workspaceTextFileMaxBytes) {
        throw new Error('文件过大，无法在侧栏打开');
      }
      const buf = await readFile(filePath);
      return { text: buf.toString('utf8') };
    });
  }

  async writeWorkspaceTextFile(request: WriteWorkspaceTextFileRequest): Promise<void> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const state = this.requireState();
      const posix = request.relativePath.replace(/\0/g, '').replace(/\\/g, '/').trim();
      if (!posix) {
        throw new Error('未指定文件路径');
      }
      const filePath = this.resolveWorkspaceRelativePath(state, request.relativePath);
      let st;
      try {
        st = await stat(filePath);
      } catch {
        throw new Error('文件不存在或无法访问');
      }
      if (!st.isFile()) {
        throw new Error('只能保存为普通文件');
      }
      const bytes = Buffer.byteLength(request.text, 'utf8');
      if (bytes > DesktopHostService.workspaceTextFileMaxBytes) {
        throw new Error('内容过大，无法保存');
      }
      await writeFile(filePath, request.text, 'utf8');
      await this.refreshGitState();
    });
  }

  /**
   * 将工作区相对路径解析为绝对路径；使用 `/` 分段，禁止 `..` 与绝对路径。
   */
  private resolveWorkspaceRelativePath(state: HostState, relativePath: string): string {
    const root = path.resolve(state.workspaceRoot);
    const cleaned = relativePath.replace(/\0/g, '');
    const posix = cleaned.replace(/\\/g, '/').trim();
    if (posix.startsWith('/') || /^[a-zA-Z]:/.test(posix)) {
      throw new Error('无效路径');
    }
    const segments = posix.split('/').filter((s) => s.length > 0);
    for (const seg of segments) {
      if (seg === '..' || seg === '.') {
        throw new Error('无效路径');
      }
    }
    const target =
      segments.length === 0 ? root : path.resolve(root, ...segments);
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('路径越出工作区');
    }
    return target;
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
        state.messages = ephemeral.messages.map((message) => ({ ...message }));
        state.activeSession = {
          filePath: ephemeral.path,
          displayName: ephemeral.displayName,
          kind: 'ephemeral',
          readOnly: true,
        };
        state.archiveHistory = ephemeral.llmHistory.map((message) => ({
          role: message.role,
          content: message.content,
          imagePaths: [...message.imagePaths],
        }));
        state.archiveSubagentSessions = [];
        state.rewind = createDesktopRewindMetadata();
        state.rewindWarnings = [];
        this.currentTurnSkills = [];
        this.pendingUnboundFileChangeIds = [];
        this.messageIdCounter = Math.max(0, ...state.messages.map((message) => message.id)) + 1;
        this.latestPendingAssistantAux = undefined;
        this.resetStreamingPlacementState(true);
        await this.refreshRuntime();
        this.lastRuntimeError = '';
        return this.buildSnapshot();
      }

      const loaded = await loadStoredSession(filePath);
      await this.ensureInitialized(loaded.workspaceRoot);
      const state = this.requireState();
      state.messages = loaded.desktopMessages
        ? loaded.desktopMessages.map((message) => ({ ...message }))
        : restoreMessagesFromArchive(loaded);
      state.activeSession = {
        filePath: path.resolve(filePath),
        displayName:
          loaded.sessionDisplayName ?? deriveDisplayNameFromMessages(state.messages),
        kind: 'stored',
      };
      state.archiveHistory = loaded.llmHistory.map((message) => ({
        role: message.role,
        content: message.content,
        imagePaths: [...message.imagePaths],
      }));
      state.archiveSubagentSessions = (loaded.subagentSessions ?? []).map((entry) => ({
        summary: { ...entry.summary },
        llmHistory: entry.llmHistory.map((message) => ({
          role: message.role,
          content: message.content,
          imagePaths: [...message.imagePaths],
        })),
      }));
      state.rewind = loaded.rewind ?? createDesktopRewindMetadata();
      state.rewindWarnings = [];
      this.currentTurnSkills = [];
      this.pendingUnboundFileChangeIds = [];
      this.messageIdCounter =
        Math.max(0, ...state.messages.map((message) => message.id)) + 1;
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
      extensionToolDefinitions: buildContributedHostToolDefinitions(
        collectHostExtensionContributedTools(extensions).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as JsonObject,
        })),
      ),
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
      this.dreamCollectorStatus = emptyDreamCollectorSnapshot('disabled');
      return;
    }
    if (!settings.collectorModel) {
      this.dreamCollectorStatus = {
        ...emptyDreamCollectorSnapshot('missing-model'),
        lastError: '梦境收集模型未配置。',
      };
      return;
    }
    if (!state.git.isRepository || !state.git.branch) {
      this.dreamCollectorStatus = emptyDreamCollectorSnapshot('idle');
      return;
    }
    if (this.runtime?.isBusy() || this.dreamCollectorRunning) {
      return;
    }
    if (this.dreamCollectorStatus.backoffUntilUnixMs && now < this.dreamCollectorStatus.backoffUntilUnixMs) {
      this.dreamCollectorStatus = {
        ...this.dreamCollectorStatus,
        state: 'backoff',
      };
      return;
    }
    if (now - this.dreamCollectorLastTickUnixMs < DREAM_COLLECTOR_TICK_INTERVAL_MS) {
      return;
    }

    this.dreamCollectorLastTickUnixMs = now;
    this.dreamCollectorRunning = true;
    this.dreamCollectorStatus = {
      ...this.dreamCollectorStatus,
      state: 'running',
      lastRunAtUnixMs: now,
      pendingCount: this.dreamCollectorStatus.pendingCount,
      processedCount: this.dreamCollectorStatus.processedCount,
    };

    const collectorInput = {
      workspaceRoot: state.workspaceRoot,
      gitBranch: state.git.branch,
      collectorModel: settings.collectorModel,
      config: cloneDesktopConfig(state.config),
      planMetadata: { ...state.metadata.planMetadata },
    };

    void this.runDreamCollectorOnce(collectorInput)
      .catch((error) => {
        const backoffUntilUnixMs = Date.now() + DREAM_COLLECTOR_BACKOFF_MS;
        this.dreamCollectorStatus = {
          ...this.dreamCollectorStatus,
          state: 'backoff',
          lastError: error instanceof Error ? error.message : String(error),
          backoffUntilUnixMs,
        };
      })
      .finally(() => {
        this.dreamCollectorRunning = false;
      });
  }

  private async runDreamCollectorOnce(input: {
    workspaceRoot: string;
    gitBranch: string;
    collectorModel: string;
    config: DesktopConfigFile;
    planMetadata: OpenAiPlanMetadata;
  }): Promise<void> {
    const runId = randomUUID();
    const startedAtUnixMs = Date.now();
    const scope = {
      workspaceRoot: input.workspaceRoot,
      gitBranch: input.gitBranch,
    };
    let sourceSession: SessionListItem | undefined;
    let sourceContextMode: DreamCollectorSourceContextMode | undefined;
    let pendingCount = 0;
    let toolCalls: DesktopDreamCollectorRunLog['toolCalls'] = [];
    let promptForDebug = '';
    let debugSessionPersisted = false;
    try {
      const cutoffUnixMs = Date.now() - DREAM_RETENTION_MS;
      const now = Date.now();
      const storedSessions = (await listStoredSessions())
        .filter((session) => sameWorkspaceRoot(session.workspaceRoot, input.workspaceRoot))
        .filter((session) => session.gitBranch === input.gitBranch)
        .filter((session) => !isDreamCollectorDebugSessionPath(session.path))
        .filter((session) => session.modifiedAtUnixMs >= cutoffUnixMs)
        .sort((left, right) => left.modifiedAtUnixMs - right.modifiedAtUnixMs);

      const dreamStore = createHostDreamStore({ spiritDataDir: spiritAgentDataDir(), scope });
      await dreamStore.pruneExpired(now);
      const sessionProgressList = await dreamStore.listSessionProgress();
      const sessionProgressMap = new Map(sessionProgressList.map((entry) => [entry.path, entry]));
      const pendingSessions = storedSessions.filter((session) =>
        shouldQueueDreamCollectorSession(session, sessionProgressMap.get(session.path), now),
      );
      pendingCount = pendingSessions.length;
      if (pendingSessions.length === 0) {
        this.dreamCollectorStatus = clearDreamCollectorIssue({
          ...this.dreamCollectorStatus,
          state: 'idle',
          pendingCount: 0,
        });
        return;
      }

      sourceSession = pendingSessions[0]!;
      this.dreamCollectorStatus = clearDreamCollectorIssue({
        ...this.dreamCollectorStatus,
        state: 'running',
        pendingCount: pendingSessions.length,
      });

      const apiKey = await resolveApiKeyForModel(input.collectorModel);
      if (!apiKey) {
        throw new Error('梦境收集模型未配置 API Key。');
      }

      const activeProfile = input.config.models.find((model) => model.name === input.collectorModel);
      const archive = await loadStoredSession(sourceSession.path);
      const sessionProgress = sessionProgressMap.get(sourceSession.path);
      const sourceContext = buildDreamCollectorSourceContext(archive, sessionProgress);
      sourceContextMode = sourceContext.mode;
      if (!sourceContext.shouldRunCollector) {
        await dreamStore.upsertSessionProgress({
          path: sourceSession.path,
          ...(sourceSession.displayName ? { displayName: sourceSession.displayName } : {}),
          lastProcessedSavedAtUnixMs: sourceSession.modifiedAtUnixMs,
          lastProcessedMessageCount: sourceContext.processedMessageCount,
          lastProcessedPrefixHash: sourceContext.prefixHash,
          lastRunAtUnixMs: Date.now(),
          cooldownUntilUnixMs: Date.now() + DREAM_COLLECTOR_SESSION_COOLDOWN_MS,
        });
        this.dreamCollectorStatus = clearDreamCollectorIssue({
          ...this.dreamCollectorStatus,
          state: 'idle',
          pendingCount: Math.max(0, pendingSessions.length - 1),
        });
        return;
      }
      const toolExecutor = new DesktopToolExecutor(input.workspaceRoot, {
        dreamScope: scope,
        dreamSourceSession: {
          path: sourceSession.path,
          displayName: sourceSession.displayName,
          savedAtUnixMs: sourceSession.modifiedAtUnixMs,
        },
      });
      const runtime = this.createRuntime(
        {
          apiKey,
          model: input.collectorModel,
          baseUrl: activeProfile?.apiBase ?? currentApiBase(input.config),
          workspaceRoot: input.workspaceRoot,
          ...(activeProfile?.provider ? { llmVendor: activeProfile.provider } : {}),
        },
        [],
        [],
        [],
        input.planMetadata,
        [
          {
            extensionId: 'dream-collector',
            extensionName: '梦境收集器',
            content: buildDreamCollectorSystemMessage(),
          },
        ],
        toolExecutor,
      );
      promptForDebug = buildDreamCollectorPrompt({
        sourceSession,
        scope,
        sourceContext,
      });
      const result = await runtime.submitUserTurn(promptForDebug);
      toolCalls = result.toolExecutions.map((execution) => ({
        toolName: execution.toolName,
        failed: execution.failed,
      }));
      if (result.kind !== 'completed') {
        throw new Error(result.kind === 'failed' ? result.error : `梦境收集未完成: ${result.kind}`);
      }
      if (input.config.dreams.debugMode) {
        await persistDreamCollectorDebugSession({
          runId,
          workspaceRoot: input.workspaceRoot,
          gitBranch: input.gitBranch,
          collectorModel: input.collectorModel,
          sourceSession,
          prompt: promptForDebug,
          assistantText: result.assistantText,
          failed: false,
        });
        debugSessionPersisted = true;
      }

      await dreamStore.upsertSessionProgress({
        path: sourceSession.path,
        ...(sourceSession.displayName ? { displayName: sourceSession.displayName } : {}),
        lastProcessedSavedAtUnixMs: sourceSession.modifiedAtUnixMs,
        lastProcessedMessageCount: sourceContext.processedMessageCount,
        lastProcessedPrefixHash: sourceContext.prefixHash,
        lastRunAtUnixMs: Date.now(),
        cooldownUntilUnixMs: Date.now() + DREAM_COLLECTOR_SESSION_COOLDOWN_MS,
      });
      this.dreamCollectorStatus = clearDreamCollectorIssue({
        ...this.dreamCollectorStatus,
        state: 'idle',
        lastSuccessAtUnixMs: Date.now(),
        pendingCount: Math.max(0, pendingSessions.length - 1),
        processedCount: this.dreamCollectorStatus.processedCount + 1,
      });
      await writeDreamCollectorRunLog({
        runId,
        startedAtUnixMs,
        finishedAtUnixMs: Date.now(),
        workspaceRoot: input.workspaceRoot,
        gitBranch: input.gitBranch,
        collectorModel: input.collectorModel,
        sourceSessionPath: sourceSession.path,
        decision: 'processed',
        ...(sourceContextMode ? { sourceContextMode } : {}),
        pendingCount,
        resultSummary: truncateText(result.assistantText, 1_000),
        toolCalls,
      });
    } catch (error) {
      if (input.config.dreams.debugMode && sourceSession && promptForDebug && !debugSessionPersisted) {
        await persistDreamCollectorDebugSession({
          runId,
          workspaceRoot: input.workspaceRoot,
          gitBranch: input.gitBranch,
          collectorModel: input.collectorModel,
          sourceSession,
          prompt: promptForDebug,
          assistantText: error instanceof Error ? error.message : String(error),
          failed: true,
        });
      }
      await writeDreamCollectorRunLog({
        runId,
        startedAtUnixMs,
        finishedAtUnixMs: Date.now(),
        workspaceRoot: input.workspaceRoot,
        gitBranch: input.gitBranch,
        collectorModel: input.collectorModel,
        ...(sourceSession ? { sourceSessionPath: sourceSession.path } : {}),
        decision: 'failed',
        ...(sourceContextMode ? { sourceContextMode } : {}),
        pendingCount,
        error: error instanceof Error ? error.message : String(error),
        toolCalls,
      });
      throw error;
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
    state.ephemeralSessions = [
      record,
      ...state.ephemeralSessions.filter((session) => session.path !== record.path),
    ].slice(0, MAX_EPHEMERAL_COMMIT_SESSIONS);
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
    const sessionPath = `${EPHEMERAL_COMMIT_SESSION_PREFIX}${Date.now()}`;
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
      this.rememberEphemeralSession({
        path: sessionPath,
        displayName: `[Commit] ${deriveDisplayNameFromSeed(message)}`,
        workspaceRoot: state.workspaceRoot,
        modifiedAtUnixMs: Date.now(),
        messages: finalMessages,
        llmHistory: finalMessages.map((entry) => ({
          role: entry.role,
          content: entry.content,
          imagePaths: [],
        })),
        readOnly: true,
      });
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
      this.rememberEphemeralSession({
        path: sessionPath,
        displayName: '[Commit] 自动生成失败',
        workspaceRoot: state.workspaceRoot,
        modifiedAtUnixMs: Date.now(),
        messages: finalMessages,
        llmHistory: finalMessages.map((entry) => ({
          role: entry.role,
          content: entry.content,
          imagePaths: [],
        })),
        readOnly: true,
      });
      throw error;
    }
  }

  private messagesWithPendingAssistant(
    livePendingAux?: PendingAssistantAux,
  ): ConversationMessageSnapshot[] {
    const state = this.requireState();
    const snapshots = state.messages.flatMap((message) => {
      const snapshot = this.messageSnapshot(message, livePendingAux);
      return snapshot && !shouldHideEmptyPendingAssistantSnapshot(snapshot) ? [snapshot] : [];
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
    state.extensionsList = await Promise.all(extensions.map(async (item) => ({
      id: item.id,
      displayName: item.manifest.name,
      ...(item.manifest.icon ? { icon: item.manifest.icon } : {}),
      version: item.manifest.version,
      ...(item.manifest.description ? { description: item.manifest.description } : {}),
      ...(item.manifest.author ? { author: item.manifest.author } : {}),
      ...(item.manifest.homepage ? { homepage: item.manifest.homepage } : {}),
      ...(item.manifest.main ? { main: item.manifest.main } : {}),
      supportedHosts: [...item.manifest.supportedHosts],
      ...(item.manifest.activationEvents?.length
        ? { activationEvents: [...item.manifest.activationEvents] }
        : {}),
      ...(item.manifest.requestedCapabilities?.length
        ? { requestedCapabilities: [...item.manifest.requestedCapabilities] }
        : {}),
      ...(item.manifest.contributes?.tools?.length
        ? {
            contributedTools: item.manifest.contributes.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              ...(tool.approvalMode ? { approvalMode: tool.approvalMode } : {}),
              ...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
            })),
          }
        : {}),
      ...(item.manifest.contributes?.desktop?.css?.length
        ? {
            desktopCss: item.manifest.contributes.desktop.css.map((entry) => ({
              path: entry.path,
              ...(entry.media ? { media: entry.media } : {}),
            })),
          }
        : {}),
      ...(item.manifest.contributes?.cli?.hooks?.length
        ? {
            cliHooks: item.manifest.contributes.cli.hooks.map((hook) => ({
              slot: hook.slot,
              ...(hook.variant ? { variant: hook.variant } : {}),
              ...(hook.tokens
                ? {
                    tokens: {
                      ...(hook.tokens.foreground ? { foreground: hook.tokens.foreground } : {}),
                      ...(hook.tokens.border ? { border: hook.tokens.border } : {}),
                      ...(hook.tokens.accent ? { accent: hook.tokens.accent } : {}),
                    },
                  }
                : {}),
              ...(hook.prefix ? { prefix: hook.prefix } : {}),
              ...(hook.suffix ? { suffix: hook.suffix } : {}),
            })),
          }
        : {}),
      ...(item.manifest.settingsSchema?.length
        ? {
            settingsSchema: item.manifest.settingsSchema.map((setting) => ({
              key: setting.key,
              type: setting.type,
              title: setting.title,
              ...(setting.description ? { description: setting.description } : {}),
              ...(setting.placeholder ? { placeholder: setting.placeholder } : {}),
              ...(setting.required !== undefined ? { required: setting.required } : {}),
              ...(setting.defaultValue !== undefined
                ? { defaultValue: setting.defaultValue }
                : {}),
              ...(setting.options?.length
                ? {
                    options: setting.options.map((option) => ({
                      value: option.value,
                      label: option.label,
                      ...(option.description ? { description: option.description } : {}),
                    })),
                  }
                : {}),
            })),
            settingsValues: await this.extensionManager().getSettingsValues(item.id),
          }
        : {}),
      ...(item.manifest.secretSlots?.length
        ? {
            secretSlots: item.manifest.secretSlots.map((slot) => ({
              key: slot.key,
              title: slot.title,
              ...(slot.description ? { description: slot.description } : {}),
              ...(slot.required !== undefined ? { required: slot.required } : {}),
            })),
            secretStatuses: Object.entries(
              await this.extensionManager().getSecretStatus(item.id),
            ).map(([key, configured]) => ({
              key,
              configured,
            })),
          }
        : {}),
      ...(item.archiveFileName ? { archiveFileName: item.archiveFileName } : {}),
      installedAtUnixMs: item.installedAtUnixMs,
    })));
    state.extensionCss = await this.collectDesktopExtensionCssLayers(extensions);
  }

  private async collectDesktopExtensionCssLayers(
    extensions: readonly HostInstalledExtension[],
  ): Promise<DesktopExtensionCssLayer[]> {
    const layers: DesktopExtensionCssLayer[] = [];

    for (const item of extensions) {
      const cssEntries = item.manifest.contributes?.desktop?.css ?? [];
      for (const entry of cssEntries) {
        const sourcePath = path.join(item.directoryPath, ...entry.path.split('/'));
        try {
          const cssText = await readFile(sourcePath, 'utf8');
          if (!cssText.trim()) {
            continue;
          }
          layers.push({
            extensionId: item.id,
            extensionName: item.manifest.name,
            sourcePath: entry.path,
            cssText,
            ...(entry.media ? { media: entry.media } : {}),
          });
        } catch (error) {
          console.warn(
            `[desktop-host][extensions] read css failed: ${item.id}:${entry.path}`,
            error,
          );
        }
      }
    }

    return layers;
  }

  private async refreshExtensionToolDefinitions(): Promise<void> {
    if (!this.toolExecutor) {
      return;
    }

    const extensions = await this.extensionManager().list();
    this.toolExecutor.setExtensionToolDefinitions(
      buildContributedHostToolDefinitions(
        collectHostExtensionContributedTools(extensions).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as JsonObject,
        })),
      ),
    );
  }

  private async collectExtensionSystemPrompts(): Promise<OpenAiExtensionSystemPrompt[]> {
    const adapter = desktopExtensionHostAdapter;
    if (!adapter) {
      return [];
    }

    const collected = await this.extensionManager().collectSystemPromptContributions({
      host: adapter,
      logger: console,
    });
    return collected.map((entry) => ({
      extensionId: entry.extensionId,
      extensionName: entry.extensionName,
      content: entry.content,
    }));
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
    const targetIds = new Set<string>();
    const toolCallId = execution.toolCallId || `tool:${execution.toolName}`;
    for (const change of state.rewind.fileChanges) {
      if (change.messageId !== undefined) {
        continue;
      }
      if (change.toolCallId === toolCallId) {
        targetIds.add(change.id);
      }
    }
    if (targetIds.size === 0) {
      for (const id of this.pendingUnboundFileChangeIds) {
        targetIds.add(id);
      }
    }
    if (targetIds.size === 0) {
      return;
    }

    for (const change of state.rewind.fileChanges) {
      if (targetIds.has(change.id)) {
        change.messageId = messageId;
      }
    }
    this.pendingUnboundFileChangeIds = this.pendingUnboundFileChangeIds.filter(
      (id) => !targetIds.has(id),
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

    const existing = state.rewind.checkpoints.findIndex(
      (candidate) => candidate.messageId === messageId,
    );
    if (existing >= 0) {
      state.rewind.checkpoints.splice(existing, 1, checkpoint);
    } else {
      state.rewind.checkpoints.push(checkpoint);
    }
    state.rewind.checkpoints.sort((left, right) => left.sequence - right.sequence);
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
    state.rewind.checkpoints = state.rewind.checkpoints.filter(
      (checkpoint) => checkpoint.sequence < checkpointSequence,
    );
    state.rewind.fileChanges = state.rewind.fileChanges.filter(
      (change) => change.sequence <= checkpointSequence,
    );
    this.pendingUnboundFileChangeIds = [];
    this.latestPendingAssistantAux = undefined;
    this.messageIdCounter = Math.max(0, ...state.messages.map((message) => message.id)) + 1;
    this.resetStreamingPlacementState(true);
    this.pruneEmptyAssistantMessages('restoreBeforeRewindCheckpoint');
    this.requireRuntime().replaceFromArchive(archive);
  }

  private messageSnapshot(
    message: ConversationMessageSnapshot,
    livePendingAux?: PendingAssistantAux,
  ): ConversationMessageSnapshot | undefined {
    const tool = normalizeToolBlockSnapshot(message.tool);
    const aux = shouldHidePendingAssistantThinkingForLiveStandaloneSubagentStatus(
      message,
      livePendingAux,
    )
      ? stripThinkingFromAux(message.aux)
      : normalizeMessageAuxSnapshot(message.aux);
    if (shouldDropEmptyAssistantMessage(message, tool, aux)) {
      return undefined;
    }

    const { canRewind: _canRewind, ...base } = message;
    return {
      ...base,
      ...(tool ? { tool } : {}),
      ...(aux ? { aux } : {}),
      ...(this.canRewindMessage(message) ? { canRewind: true } : {}),
    };
  }

  private pruneEmptyAssistantMessages(reason: string): void {
    const state = this.requireState();
    const removedIds: number[] = [];
    state.messages = state.messages.filter((message, index) => {
      const drop = shouldDropEmptyAssistantMessage(
        message,
        normalizeToolBlockSnapshot(message.tool),
        normalizeMessageAuxSnapshot(message.aux),
      );
      if (drop) {
        const currentIndex = index - removedIds.length;
        this.handleMessageRemoved(currentIndex, message.id, `prune:${reason}`);
        removedIds.push(message.id);
      }
      return !drop;
    });
    if (removedIds.length > 0) {
      console.warn(
        `[desktop-host][messages] dropped ${removedIds.length} empty assistant message(s) during ${reason}: ${removedIds.join(', ')}`,
      );
    }
  }

  private shiftStreamAssistantThinkingAnchorForInsertion(insertAt: number): void {
    if (
      this.streamAssistantThinkingAnchor !== undefined &&
      insertAt <= this.streamAssistantThinkingAnchor
    ) {
      this.streamAssistantThinkingAnchor += 1;
    }
  }

  private shiftStreamAssistantThinkingAnchorForRemoval(removeAt: number, removeCount = 1): void {
    if (this.streamAssistantThinkingAnchor === undefined || removeCount <= 0) {
      return;
    }

    const anchor = this.streamAssistantThinkingAnchor;
    if (removeAt + removeCount <= anchor) {
      this.streamAssistantThinkingAnchor = anchor - removeCount;
      return;
    }

    if (removeAt < anchor) {
      this.streamAssistantThinkingAnchor = removeAt;
    }
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

  private canRewindMessage(message: ConversationMessageSnapshot): boolean {
    if (message.pending || message.role !== 'user') {
      return false;
    }
    return this.requireState().rewind.checkpoints.some(
      (checkpoint) => checkpoint.messageId === message.id,
    );
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

    const stored: StoredDesktopSession = {
      ...archive,
      savedAtUnixMs: Date.now(),
      sessionDisplayName: state.activeSession.displayName,
      workspaceRoot: state.workspaceRoot,
      ...(state.git.branch ? { gitBranch: state.git.branch } : {}),
      desktopMessages: state.messages.map((message) => ({ ...message })),
      rewind: state.rewind,
    };
    state.activeSession.filePath = await saveStoredSession(state.activeSession.filePath, stored);
  }

  private instructionPaths() {
    const state = this.requireState();
    return resolveInstructionPaths({
      workspaceRoot: state.workspaceRoot,
      spiritDataDir: spiritAgentDataDir(),
    });
  }

  private parseSkillRootKind(value: unknown): DesktopSkillRootKind {
    if (value === 'user' || value === 'workspaceSpirit' || value === 'workspaceAgents') {
      return value;
    }
    throw new Error('无效的 Skill 根类型。');
  }

  private resolveSkillRootDir(rootKind: DesktopSkillRootKind): string {
    const paths = this.instructionPaths();
    switch (rootKind) {
      case 'user':
        return paths.userSkillsDir;
      case 'workspaceSpirit':
        return paths.workspaceSpiritSkillsDir;
      case 'workspaceAgents':
        return paths.workspaceAgentsSkillsDir;
      default: {
        const _exhaustive: never = rootKind;
        return _exhaustive;
      }
    }
  }

  private resolveSkillDir(skillDirectoryName: string, rootKind: DesktopSkillRootKind): string {
    return path.join(this.resolveSkillRootDir(rootKind), skillDirectoryName);
  }

  private assertPathUnderSkillRoot(targetDir: string, rootKind: DesktopSkillRootKind): void {
    const root = path.resolve(this.resolveSkillRootDir(rootKind));
    const resolved = path.resolve(targetDir);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error('Skill 路径不在允许的根目录内。');
    }
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

async function buildDreamCommitContext(input: {
  workspaceRoot: string;
  gitBranch?: string;
}): Promise<string> {
  const gitBranch = input.gitBranch?.trim();
  if (!gitBranch) {
    return '';
  }

  const dreamStore = createHostDreamStore({
    spiritDataDir: spiritAgentDataDir(),
    scope: {
      workspaceRoot: input.workspaceRoot,
      gitBranch,
    },
  });
  await dreamStore.pruneExpired();
  const dreams = await dreamStore.list({ includeDeleted: false, includeExpired: false });
  if (dreams.length === 0) {
    return '';
  }

  const rendered = dreams.map((dream, index) => {
    const lines = [
      `${index + 1}. ${dream.title}`,
      `summary: ${dream.summary}`,
      dream.details ? `details: ${dream.details}` : '',
      dream.tags?.length ? `tags: ${dream.tags.join(', ')}` : '',
      `updatedAtUnixMs: ${dream.updatedAtUnixMs}`,
    ].filter(Boolean);
    return lines.join('\n');
  }).join('\n\n');
  return truncateText(rendered, DREAM_COMMIT_CONTEXT_MAX_CHARS);
}

function buildCommitMessageGenerationPrompt(input: {
  workspaceRoot: string;
  branch?: string;
  dreamContextText?: string;
  statusText: string;
  diffStatText: string;
  diffText: string;
}): string {
  const dreamSection = input.dreamContextText?.trim()
    ? [
        '',
        '[dream summaries] 当前工作动向摘要',
        input.dreamContextText.trim(),
      ]
    : [];
  return [
    '请为以下 Git 变更生成一条提交信息。',
    '必须遵守仓库约定：type / 可选 scope 使用英文；subject 使用中文。',
    '输出 JSON，由宿主解析。不要输出 Markdown、解释、代码块或额外字段。',
    'message 应该是一条可直接执行 git commit 的提交信息。若需要正文，可使用换行。',
    '如果提供了 dream summaries，请把它作为“为什么做这些变更”的语义背景；最终提交信息仍以 Git diff 为准。',
    '',
    `workspace: ${input.workspaceRoot}`,
    `branch: ${input.branch ?? '(unknown)'}`,
    ...dreamSection,
    '',
    '[git status --short --branch]',
    input.statusText || '(empty)',
    '',
    '[git diff --stat HEAD]',
    input.diffStatText || '(empty)',
    '',
    '[git diff HEAD]',
    input.diffText || '(empty)',
  ].join('\n');
}

type DreamCollectorSourceContextMode = 'full' | 'incremental';

interface DreamCollectorNormalizedMessage {
  role: 'user' | 'assistant';
  rendered: string;
}

interface DreamCollectorSourceContext {
  mode: DreamCollectorSourceContextMode;
  rendered: string;
  prefixHash: string;
  processedMessageCount: number;
  shouldRunCollector: boolean;
}

function buildDreamCollectorSourceContext(
  archive: StoredDesktopSession,
  progress?: HostDreamSessionProgress,
): DreamCollectorSourceContext {
  const normalizedMessages = normalizeDreamCollectorMessages(archive);
  const processedMessageCount = normalizedMessages.length;
  const prefixHash = hashDreamCollectorMessages(normalizedMessages);
  if (!progress) {
    return {
      mode: 'full',
      rendered: renderDreamCollectorFullContext(normalizedMessages),
      prefixHash,
      processedMessageCount,
      shouldRunCollector: true,
    };
  }

  const needsFullRebuild =
    progress.lastProcessedMessageCount > processedMessageCount ||
    hashDreamCollectorMessages(
      normalizedMessages.slice(0, Math.min(progress.lastProcessedMessageCount, processedMessageCount)),
    ) !== progress.lastProcessedPrefixHash;
  if (needsFullRebuild) {
    return {
      mode: 'full',
      rendered: renderDreamCollectorFullContext(normalizedMessages),
      prefixHash,
      processedMessageCount,
      shouldRunCollector: true,
    };
  }

  const newMessages = normalizedMessages.slice(progress.lastProcessedMessageCount);
  if (newMessages.length === 0) {
    return {
      mode: 'incremental',
      rendered: '',
      prefixHash,
      processedMessageCount,
      shouldRunCollector: false,
    };
  }

  const anchorMessages = normalizedMessages.slice(
    Math.max(0, progress.lastProcessedMessageCount - DREAM_COLLECTOR_ANCHOR_MESSAGE_COUNT),
    progress.lastProcessedMessageCount,
  );
  return {
    mode: 'incremental',
    rendered: renderDreamCollectorIncrementalContext(anchorMessages, newMessages),
    prefixHash,
    processedMessageCount,
    shouldRunCollector: true,
  };
}

function normalizeDreamCollectorMessages(
  archive: StoredDesktopSession,
): DreamCollectorNormalizedMessage[] {
  const source = archive.llmHistory.length > 0
    ? archive.llmHistory
    : archive.messages.map((message) => ({
        role: message.role,
        content: message.content,
        imagePaths: [],
      }));
  return source
    .filter(
      (message): message is { role: 'user' | 'assistant'; content: string; imagePaths: string[] } =>
        message.role === 'user' || message.role === 'assistant',
    )
    .map((message) => ({
      role: message.role,
      rendered: `${message.role.toUpperCase()}:\n${message.content.trim()}`,
    }))
    .filter((entry) => entry.rendered.trim().length > 0);
}

function hashDreamCollectorMessages(
  messages: DreamCollectorNormalizedMessage[],
): string {
  return createHash('sha256')
    .update(messages.map((message) => message.rendered).join('\n\n'), 'utf8')
    .digest('hex')
    .slice(0, 32);
}

function renderDreamCollectorFullContext(
  messages: DreamCollectorNormalizedMessage[],
): string {
  return truncateText(
    messages.map((message) => message.rendered).join('\n\n') || '(empty session)',
    DREAM_COLLECTOR_SOURCE_CONTEXT_MAX_CHARS,
  );
}

function renderDreamCollectorIncrementalContext(
  anchorMessages: DreamCollectorNormalizedMessage[],
  newMessages: DreamCollectorNormalizedMessage[],
): string {
  const anchorText = truncateText(
    anchorMessages.map((message) => message.rendered).join('\n\n') || '(no prior anchor)',
    DREAM_COLLECTOR_ANCHOR_CONTEXT_MAX_CHARS,
  );
  const deltaText = truncateText(
    newMessages.map((message) => message.rendered).join('\n\n') || '(no delta)',
    DREAM_COLLECTOR_INCREMENTAL_CONTEXT_MAX_CHARS,
  );
  return [
    '[recent_anchor]',
    anchorText,
    '',
    '[new_delta]',
    deltaText,
  ].join('\n');
}

function shouldQueueDreamCollectorSession(
  session: SessionListItem,
  progress: HostDreamSessionProgress | undefined,
  nowUnixMs: number,
): boolean {
  if (!progress) {
    return true;
  }
  if (session.modifiedAtUnixMs <= progress.lastProcessedSavedAtUnixMs) {
    return false;
  }
  if (progress.cooldownUntilUnixMs !== undefined && nowUnixMs < progress.cooldownUntilUnixMs) {
    return false;
  }
  return true;
}

function buildDreamCollectorPrompt(input: {
  sourceSession: SessionListItem;
  scope: { workspaceRoot: string; gitBranch: string };
  sourceContext: DreamCollectorSourceContext;
}): string {
  const modeBlock = input.sourceContext.mode === 'incremental'
    ? [
        '这是同一会话在上次梦境收集后的新增内容。优先更新已有梦境，不要重复总结旧内容。',
        '[source_session_incremental_context]',
      ]
    : [
        '这是该会话当前可用的完整摘要上下文。',
        '[source_session_full_context]',
      ];
  return [
    '请收集这条源会话的梦境摘要。',
    '你必须先调用 dream_list 查看当前 scope 的已有梦境。',
    '如果源会话延续了已有动向，请调用 dream_update；如果是新动向，请调用 dream_record；如果已有梦境已经误导或过时，可调用 dream_delete。',
    '如果源会话完全没有可沉淀的近期工作动向，可以不写入梦境，但不要执行任何非梦境维护操作。',
    '',
    `[scope] workspace=${input.scope.workspaceRoot}`,
    `[scope] branch=${input.scope.gitBranch}`,
    `[source_session] path=${input.sourceSession.path}`,
    `[source_session] title=${input.sourceSession.displayName}`,
    `[source_session] modifiedAtUnixMs=${input.sourceSession.modifiedAtUnixMs}`,
    `[source_session] mode=${input.sourceContext.mode}`,
    '',
    ...modeBlock,
    input.sourceContext.rendered,
  ].join('\n');
}

interface DesktopDreamCollectorRunLog {
  runId: string;
  startedAtUnixMs: number;
  finishedAtUnixMs: number;
  workspaceRoot: string;
  gitBranch: string;
  collectorModel: string;
  sourceSessionPath?: string;
  decision: 'no-pending' | 'processed' | 'failed';
  sourceContextMode?: DreamCollectorSourceContextMode;
  pendingCount: number;
  resultSummary?: string;
  error?: string;
  toolCalls: Array<{
    toolName: string;
    failed: boolean;
  }>;
}

async function writeDreamCollectorRunLog(log: DesktopDreamCollectorRunLog): Promise<void> {
  const logsDir = dreamLogsDirPath(spiritAgentDataDir());
  await mkdir(logsDir, { recursive: true });
  const fileName = `${log.startedAtUnixMs}-${log.runId}.json`;
  await writeFile(path.join(logsDir, fileName), `${JSON.stringify(log, null, 2)}\n`, 'utf8');
}

async function persistDreamCollectorDebugSession(input: {
  runId: string;
  workspaceRoot: string;
  gitBranch: string;
  collectorModel: string;
  sourceSession: SessionListItem;
  prompt: string;
  assistantText: string;
  failed: boolean;
}): Promise<void> {
  const now = Date.now();
  const messages: ConversationMessageSnapshot[] = [
    {
      id: 1,
      role: 'user',
      content: input.prompt,
      pending: false,
    },
    {
      id: 2,
      role: 'assistant',
      content: input.failed ? `生成失败：${input.assistantText}` : input.assistantText,
      pending: false,
    },
  ];
  const sessionFile = path.join(chatsDirPath(), `${DREAM_DEBUG_SESSION_FILE_PREFIX}${now}-${input.runId}.json`);
  await saveStoredSession(sessionFile, {
    messages,
    assistantAux: [],
    llmHistory: messages.map((message) => ({
      role: message.role,
      content: message.content,
      imagePaths: [],
    })),
    subagentSessions: [],
    savedAtUnixMs: now,
    sessionDisplayName: `[梦境] ${input.sourceSession.displayName}`,
    workspaceRoot: input.workspaceRoot,
    gitBranch: input.gitBranch,
    desktopMessages: messages,
  });
}

function isDreamCollectorDebugSessionPath(filePath: string): boolean {
  return path.basename(filePath).startsWith(DREAM_DEBUG_SESSION_FILE_PREFIX);
}

function emptyDreamCollectorSnapshot(
  state: DesktopDreamCollectorSnapshot['state'],
): DesktopDreamCollectorSnapshot {
  return {
    state,
    pendingCount: 0,
    processedCount: 0,
  };
}

function clearDreamCollectorIssue(
  snapshot: DesktopDreamCollectorSnapshot,
): DesktopDreamCollectorSnapshot {
  const { lastError: _lastError, backoffUntilUnixMs: _backoffUntilUnixMs, ...clean } = snapshot;
  return clean;
}

function cloneDesktopConfig(config: DesktopConfigFile): DesktopConfigFile {
  return JSON.parse(JSON.stringify(config)) as DesktopConfigFile;
}

function normalizeGeneratedCommitMessage(value: unknown): string {
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

const MCP_DEFAULT_TIMEOUT_MS = 20_000;

type DesktopMcpMetadataKind = 'env' | 'header';

function emptyMcpStatusSnapshot(): DesktopSnapshot['mcpStatus'] {
  return {
    revision: 0,
    state: 'idle',
    configuredServers: 0,
    loadedServers: 0,
    cachedTools: 0,
  };
}

function desktopMcpConfigPath(): string {
  return mcpUserConfigPath(spiritAgentDataDir());
}

function loadMcpConfigFileFromDisk(): McpConfigFile {
  const configPath = desktopMcpConfigPath();
  if (!existsSync(configPath)) {
    return { servers: {} };
  }

  const content = readFileSync(configPath, 'utf8');
  return parseMcpConfigFile(JSON.parse(content) as unknown);
}

async function saveMcpConfigFileToDisk(config: McpConfigFile): Promise<void> {
  const configPath = desktopMcpConfigPath();
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function listDesktopMcpServersFromDisk(): DesktopMcpServerListItem[] {
  try {
    const configFile = loadMcpConfigFileFromDisk();
    return Object.entries(configFile.servers).map(([name, server]) => {
      const normalized = normalizeMcpServerConfig(name, server);
      switch (normalized.transport.type) {
        case 'stdio':
          return {
            name: normalized.name,
            displayName: normalized.displayName,
            enabled: normalized.enabled,
            capabilities: normalized.capabilities,
            transport: {
              type: 'stdio',
              command: normalized.transport.command,
              args: normalized.transport.args,
              metadata: normalized.transport.env,
              ...(normalized.transport.cwd ? { cwd: normalized.transport.cwd } : {}),
              ...(normalized.transport.timeoutMs !== undefined
                ? { timeoutMs: normalized.transport.timeoutMs }
                : {}),
              summary: summarizeTransport(normalized.transport),
            },
          };
        case 'http':
          return {
            name: normalized.name,
            displayName: normalized.displayName,
            enabled: normalized.enabled,
            capabilities: normalized.capabilities,
            transport: {
              type: 'http',
              url: normalized.transport.url,
              metadata: normalized.transport.headers,
              ...(normalized.transport.timeoutMs !== undefined
                ? { timeoutMs: normalized.transport.timeoutMs }
                : {}),
              summary: summarizeTransport(normalized.transport),
            },
          };
      }
    });
  } catch {
    return [];
  }
}

function buildMcpServerConfigFromRequest(request: AddMcpServerRequest): McpServerConfig {
  const name = request.name.trim();
  const capabilities = normalizeCapabilityToggles(request.capabilities);
  const metadata = parseDesktopMcpMetadata(
    request.metadata ?? '',
    request.transportType === 'http' ? 'header' : 'env',
  );

  if (request.transportType === 'http') {
    return {
      displayName: name,
      enabled: true,
      capabilities,
      transport: {
        type: 'http',
        url: request.endpoint.trim(),
        ...(Object.keys(metadata).length > 0 ? { headers: metadata } : {}),
        timeoutMs: MCP_DEFAULT_TIMEOUT_MS,
      },
    };
  }

  const tokens = splitDesktopCommandLine(request.endpoint.trim());
  const [command, ...args] = tokens;
  if (!command) {
    throw new Error('命令不能为空。');
  }

  return {
    displayName: name,
    enabled: true,
    capabilities,
    transport: {
      type: 'stdio',
      command,
      ...(args.length > 0 ? { args } : {}),
      ...(Object.keys(metadata).length > 0 ? { env: metadata } : {}),
      timeoutMs: MCP_DEFAULT_TIMEOUT_MS,
    },
  };
}

function toDesktopMarketplaceCatalogItem(item: {
  extensionId: string;
  packageName: string;
  status: string;
  featured: boolean;
  defaultVersion: string;
  defaultChannel: 'stable' | 'preview' | 'experimental';
  defaultReviewStatus: 'unverified' | 'verified' | 'revoked';
  detailPath: string;
  displayName: string;
  description: string;
  author?: string;
  homepageUrl?: string;
  repositoryUrl?: string;
  keywords: string[];
  supportedHosts: Array<'cli' | 'desktop'>;
  requestedCapabilities: string[];
  iconUrl?: string;
}): DesktopMarketplaceCatalogItem {
  return {
    extensionId: item.extensionId,
    packageName: item.packageName,
    status: item.status,
    featured: item.featured,
    defaultVersion: item.defaultVersion,
    defaultChannel: item.defaultChannel,
    defaultReviewStatus: item.defaultReviewStatus,
    detailPath: item.detailPath,
    displayName: item.displayName,
    description: item.description,
    ...(item.author ? { author: item.author } : {}),
    ...(item.homepageUrl ? { homepageUrl: item.homepageUrl } : {}),
    ...(item.repositoryUrl ? { repositoryUrl: item.repositoryUrl } : {}),
    keywords: [...item.keywords],
    supportedHosts: [...item.supportedHosts],
    requestedCapabilities: [...item.requestedCapabilities],
    ...(item.iconUrl ? { iconUrl: item.iconUrl } : {}),
  };
}

function toDesktopMarketplaceDetail(detail: {
  extensionId: string;
  packageName: string;
  status: string;
  featured: boolean;
  defaultVersion: string;
  readmePath: string;
  versions: Array<{
    version: string;
    channel: 'stable' | 'preview' | 'experimental';
    reviewStatus: 'unverified' | 'verified' | 'revoked';
    displayName: string;
    description: string;
    author?: string;
    homepageUrl?: string;
    repositoryUrl?: string;
    keywords: string[];
    supportedHosts: Array<'cli' | 'desktop'>;
    requestedCapabilities: string[];
    iconUrl?: string;
    publishedAt?: string;
    tarballUrl?: string;
    integrity?: string;
    shasum?: string;
    changelog?: {
      summary: string;
      body: string;
    };
  }>;
}): DesktopMarketplaceDetail {
  return {
    extensionId: detail.extensionId,
    packageName: detail.packageName,
    status: detail.status,
    featured: detail.featured,
    defaultVersion: detail.defaultVersion,
    readmePath: detail.readmePath,
    versions: detail.versions.map((item) => ({
      version: item.version,
      channel: item.channel,
      reviewStatus: item.reviewStatus,
      displayName: item.displayName,
      description: item.description,
      ...(item.author ? { author: item.author } : {}),
      ...(item.homepageUrl ? { homepageUrl: item.homepageUrl } : {}),
      ...(item.repositoryUrl ? { repositoryUrl: item.repositoryUrl } : {}),
      keywords: [...item.keywords],
      supportedHosts: [...item.supportedHosts],
      requestedCapabilities: [...item.requestedCapabilities],
      ...(item.iconUrl ? { iconUrl: item.iconUrl } : {}),
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
      ...(item.tarballUrl ? { tarballUrl: item.tarballUrl } : {}),
      ...(item.integrity ? { integrity: item.integrity } : {}),
      ...(item.shasum ? { shasum: item.shasum } : {}),
      ...(item.changelog
        ? {
            changelog: {
              summary: item.changelog.summary,
              body: item.changelog.body,
            },
          }
        : {}),
    })),
  };
}

function toDesktopMarketplacePreparedInstall(prepared: {
  extensionId: string;
  packageName: string;
  displayName: string;
  description: string;
  version: string;
  channel: 'stable' | 'preview' | 'experimental';
  reviewStatus: 'unverified' | 'verified' | 'revoked';
  supportedHosts: Array<'cli' | 'desktop'>;
  supportsCurrentHost: boolean;
  tarballUrl?: string;
  integrity?: string;
  shasum?: string;
  sourceFileName: string;
}): DesktopMarketplacePreparedInstall {
  return {
    extensionId: prepared.extensionId,
    packageName: prepared.packageName,
    displayName: prepared.displayName,
    description: prepared.description,
    version: prepared.version,
    channel: prepared.channel,
    reviewStatus: prepared.reviewStatus,
    supportedHosts: [...prepared.supportedHosts],
    supportsCurrentHost: prepared.supportsCurrentHost,
    ...(prepared.tarballUrl ? { tarballUrl: prepared.tarballUrl } : {}),
    ...(prepared.integrity ? { integrity: prepared.integrity } : {}),
    ...(prepared.shasum ? { shasum: prepared.shasum } : {}),
    sourceFileName: prepared.sourceFileName,
  };
}

function parseDesktopMcpMetadata(
  input: string,
  kind: DesktopMcpMetadataKind,
): Record<string, string> {
  const trimmed = input.trim();
  if (!trimmed) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const item of trimmed.split(';')) {
    const pair = item.trim();
    if (!pair) {
      continue;
    }

    const parsed = kind === 'env'
      ? pair.split(/=(.*)/su, 2)
      : pair.includes(':')
        ? pair.split(/:(.*)/su, 2)
        : pair.split(/=(.*)/su, 2);

    if (parsed.length < 2) {
      throw new Error(kind === 'env'
        ? '环境变量格式应为 KEY=value；多个条目用分号分隔。'
        : 'Header 格式应为 Key: Value；多个条目用分号分隔。');
    }

    const key = parsed[0]?.trim() ?? '';
    if (!key) {
      throw new Error(kind === 'env' ? '环境变量名不能为空。' : 'Header 名不能为空。');
    }

    result[key] = (parsed[1] ?? '').trim();
  }

  return result;
}

function splitDesktopCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index]!;
    if (quote) {
      if (ch === quote) {
        quote = undefined;
        continue;
      }
      if (ch === '\\' && index + 1 < input.length) {
        current += input[index + 1]!;
        index += 1;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/u.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    if (ch === '\\' && index + 1 < input.length) {
      current += input[index + 1]!;
      index += 1;
      continue;
    }
    current += ch;
  }

  if (quote) {
    throw new Error('命令格式错误：存在未闭合的引号。');
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

const ACTIVE_SKILL_CONTENT_MAX_CHARS = 12_000;
const ACTIVE_SKILL_RESOURCE_MAX_ENTRIES = 24;
const ACTIVE_SKILL_RESOURCE_DIRS: ReadonlyArray<{
  kind: OpenAiActiveSkillResourceEntry['kind'];
  dirname: string;
}> = [
  { kind: 'scripts', dirname: 'scripts' },
  { kind: 'references', dirname: 'references' },
  { kind: 'assets', dirname: 'assets' },
];

function buildActivateSkillUserTurn(skillName: string, extraNote: string): string {
  const trimmed = extraNote.trim();
  if (!trimmed) {
    return `请按 skill "${skillName}" 处理当前任务。`;
  }
  return trimmed;
}

const CREATE_SKILL_PROMPT_HINT =
  '请在 /create-skill 后描述你想生成或收紧的 Skill，例如：/create-skill 做一个用于排查 Electron 白屏的 Skill';

function parseCreateSkillSlashPrompt(input: string): string | Error {
  const trimmed = input.trim();
  const prompt = trimmed.startsWith('/create-skill')
    ? trimmed.slice('/create-skill'.length).trim()
    : trimmed;
  if (!prompt) {
    return new Error(CREATE_SKILL_PROMPT_HINT);
  }

  return prompt;
}

function buildCreateSkillUserTurn(
  workspaceRoot: string,
  instructionPaths: ReturnType<typeof resolveInstructionPaths>,
  prompt: string,
): string {
  const workspaceTargetRoot = instructionPaths.workspaceSpiritSkillsDir;
  const userTargetRoot = instructionPaths.userSkillsDir;

  return `你现在在处理一个 /create-skill 请求。

目标:
- default_scope: 工作区
- workspace_skill_root: ${workspaceTargetRoot}
- user_skill_root: ${userTargetRoot}
- workspace_root: ${workspaceRoot}

用户需求:
${prompt}

要求:
- 先把它当成一次正常的 assistant 对话来处理，正常流式输出，不要伪装成后台静默生成器。
- 默认创建到工作区 skill 根目录 ${workspaceTargetRoot}；只有在用户明确要求“用户级 / 全局 / 跨仓库复用 / 写到用户目录”这类语义时，才改为用户目录 ${userTargetRoot}。
- 你需要先根据用户需求自行决定一个合适的 skill_name；名称必须是 1-64 个字符，只能使用小写字母、数字和连字符，不能以连字符开头或结尾，也不能包含连续连字符。
- 最终目标目录名与 frontmatter \`name\` 必须完全等于你决定的 skill_name。
- 最终文件路径必须是 \`<选定根目录>/<skill_name>/SKILL.md\`；不要写到其他位置。
- 如果目标 Skill 已存在，先读取原有 \`SKILL.md\`，再基于现有内容压缩重写或收紧，不要在旧内容后面继续堆砌模板化废话。
- \`SKILL.md\` 必须以 YAML frontmatter 开头，至少包含 \`name\` 和 \`description\`；正文使用 Markdown，重点写清“做什么、何时用、怎么做”。
- \`description\` 要具体说明适用场景，便于 agent 在 catalog 中识别。
- Skill 是给后续 agent/LLM 直接消费的能力说明，不是给人类流程管理看的。
- 正文优先写步骤、输入输出示例、边界条件；避免空话、组织治理废话和泛泛 checklist。
- 需要事实时先读取仓库内相关文件，不要臆造项目结构、技术栈、目录或既有工作流。
- 如果技能需要引用其他文件，正文里使用相对路径表达，不要假设这些文件已经存在。
- 如果你选择工作区 scope，优先提炼当前仓库内可复用的流程知识、约束和操作步骤，避免写成泛化的团队治理文档。
- 如果你选择用户 scope，优先提炼跨仓库稳定复用的个人工作流、判断标准与执行步骤。
- 写入仍会经过正常审批；不要假设自己已经拿到权限，也不要在工具成功前声称“已创建”或“已更新”。

交付方式:
- 如果你能直接在目标路径落盘，就在确认内容后使用文件工具写入。
- 如果不能直接落盘，就把最终 \`SKILL.md\` 完整贴在回复里，并明确说明未写入。`;
}

async function buildActiveSkillPayload(
  entry: HostMetadataSummary['skills']['entries'][number],
): Promise<OpenAiActiveSkill> {
  const skillRoot = path.dirname(entry.source.path);
  const { content, truncated } = truncateActiveSkillContent(entry.content);
  const { resources, truncated: resourcesTruncated } = await collectSkillResources(skillRoot);

  return {
    id: entry.source.id,
    scope: entry.source.scope,
    name: entry.source.name,
    description: entry.source.description,
    path: entry.source.path,
    content,
    truncated,
    resources,
    resourcesTruncated,
  };
}

function truncateActiveSkillContent(content: string): {
  content: string;
  truncated: boolean;
} {
  const chars = [...content];
  if (chars.length <= ACTIVE_SKILL_CONTENT_MAX_CHARS) {
    return {
      content: content.trim(),
      truncated: false,
    };
  }

  return {
    content: `${chars.slice(0, ACTIVE_SKILL_CONTENT_MAX_CHARS).join('').trimEnd()}\n\n...<skill content truncated>`,
    truncated: true,
  };
}

async function collectSkillResources(skillRoot: string): Promise<{
  resources: OpenAiActiveSkillResourceEntry[];
  truncated: boolean;
}> {
  const resources: OpenAiActiveSkillResourceEntry[] = [];
  let truncated = false;

  for (const { kind, dirname } of ACTIVE_SKILL_RESOURCE_DIRS) {
    const root = path.join(skillRoot, dirname);
    if (!existsSync(root)) {
      continue;
    }

    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      const entries = await readdir(current, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        if (resources.length >= ACTIVE_SKILL_RESOURCE_MAX_ENTRIES) {
          truncated = true;
          return { resources, truncated };
        }

        resources.push({
          kind,
          path: path.relative(skillRoot, fullPath).replace(/\\/gu, '/'),
        });
      }
    }
  }

  return { resources, truncated };
}

function cloneActiveSkills(skills: OpenAiActiveSkill[]): OpenAiActiveSkill[] {
  return skills.map((skill) => ({
    ...skill,
    resources: skill.resources.map((resource) => ({ ...resource })),
  }));
}

/** 环境变量 `SPIRIT_DESKTOP_MESSAGE_ORDER_DEBUG`：不设为关；`1`/compact/on 紧凑；`2`/verbose 更详并节流纯 preview；`0`/off 显式关闭。 */
type MessageOrderDebugLevel = 'off' | 'compact' | 'verbose';

function messageOrderDebugLevel(): MessageOrderDebugLevel {
  const raw = process.env.SPIRIT_DESKTOP_MESSAGE_ORDER_DEBUG?.trim().toLowerCase() ?? '';
  if (raw === '') {
    return 'off';
  }
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on' || raw === 'compact') {
    return 'compact';
  }
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') {
    return 'off';
  }
  if (raw === '2' || raw === 'verbose' || raw === 'debug' || raw === 'all') {
    return 'verbose';
  }
  return 'off';
}

function summarizeMessagesTailForOrderDebug(
  messages: ConversationMessageSnapshot[],
  max: number,
): string {
  if (messages.length === 0) {
    return '∅';
  }
  const slice = messages.slice(Math.max(0, messages.length - max));
  return slice.map(formatMessageOrderToken).join('«');
}

function formatMessageOrderToken(m: ConversationMessageSnapshot): string {
  if (m.role === 'user') {
    return 'U';
  }
  const toolName = m.tool?.toolName;
  if (toolName) {
    const phase = m.tool?.phase ?? '?';
    const p =
      phase === 'running' ? '~' : phase === 'succeeded' ? '=' : phase === 'failed' ? '!' : phase === 'pending-approval' ? '?' : '.';
    return `${p}${truncateOneLineForDebug(toolName, 20)}`;
  }
  if (m.aux?.thinking && !m.content.trim()) {
    return `H#${m.id}`;
  }
  if (m.aux?.compaction && !m.content.trim()) {
    return `C#${m.id}`;
  }
  const c = m.content.trim();
  if (!c) {
    return 'Aε';
  }
  const hasThinking = Boolean(m.aux?.thinking?.trim());
  const hasCompaction = Boolean(m.aux?.compaction?.trim());
  const prefix = hasThinking ? (hasCompaction ? 'aTC' : 'aT') : hasCompaction ? 'aC' : 'a';
  return `${prefix}#${m.id}:${truncateOneLineForDebug(c, 18)}`;
}

function truncateOneLineForDebug(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max)}…`;
}

/** 自 history 尾部向前找**最后一条**非空 `assistant` 正文（OpenAI 路径下 `historyStore` 常无 `role: tool`，需用此作待审批时的兜底）。 */
function lastAssistantPlainTextInHistory(
  hist: ReadonlyArray<{ role: string; content: string }>,
): string | undefined {
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    const m = hist[i];
    if (m?.role === 'assistant' && m.content.trim()) {
      return m.content.trim();
    }
  }
  return undefined;
}

/**
 * 自「最后一条 user」起至首条 `tool` 前，取**第一个**非空 assistant 正文。
 * OpenAI 路径下 tool 结果通常不在 `history()` 的 LlmMessage 里，若仍用「最后一个」assistant
 * 会误取工具执行后的终稿，从而覆盖/错配流式阶段已显示的前缀（如「好的，我来查看…」）。
 */
function assistantPrefixBeforeFirstToolInCurrentTurn(
  hist: ReadonlyArray<{ role: string; content: string }>,
): string | undefined {
  let lastUserIdx = -1;
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    if (hist[i]?.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  let firstToolIdx = -1;
  for (let i = lastUserIdx + 1; i < hist.length; i += 1) {
    if (hist[i]?.role === 'tool') {
      firstToolIdx = i;
      break;
    }
  }

  const end = firstToolIdx >= 0 ? firstToolIdx : hist.length;
  for (let i = lastUserIdx + 1; i < end; i += 1) {
    const m = hist[i];
    if (!m) {
      continue;
    }
    if (m.role === 'assistant' && m.content.trim()) {
      return m.content.trim();
    }
  }

  return undefined;
}

function latestUnsyncedAssistantTextInCurrentTurn(
  hist: ReadonlyArray<{ role: string; content: string }>,
  messages: ReadonlyArray<ConversationMessageSnapshot>,
): string | undefined {
  const historyTexts = assistantPlainTextsInCurrentTurnHistory(hist);
  if (historyTexts.length === 0) {
    return undefined;
  }

  const existing = new Set(assistantPlainTextsInCurrentTurnMessages(messages));
  for (let i = historyTexts.length - 1; i >= 0; i -= 1) {
    const text = historyTexts[i]!;
    if (!existing.has(text)) {
      return text;
    }
  }

  return undefined;
}

function assistantPlainTextsInCurrentTurnHistory(
  hist: ReadonlyArray<{ role: string; content: string }>,
): string[] {
  let lastUserIdx = -1;
  for (let i = hist.length - 1; i >= 0; i -= 1) {
    if (hist[i]?.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  const texts: string[] = [];
  for (let i = lastUserIdx + 1; i < hist.length; i += 1) {
    const item = hist[i];
    if (!item || item.role !== 'assistant') {
      continue;
    }
    const text = item.content.trim();
    if (text) {
      texts.push(text);
    }
  }
  return texts;
}

function assistantPlainTextsInCurrentTurnMessages(
  messages: ReadonlyArray<ConversationMessageSnapshot>,
): string[] {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  const texts: string[] = [];
  for (let i = lastUserIdx + 1; i < messages.length; i += 1) {
    const item = messages[i];
    if (!item || item.role !== 'assistant' || item.tool) {
      continue;
    }
    const text = item.content.trim();
    if (text) {
      texts.push(text);
    }
  }
  return texts;
}

function formatYamlScalarForSkillFrontmatter(value: string): string {
  const flat = value.replace(/\r?\n/g, ' ').trim() || '说明';
  return `"${flat.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

function parseAddModelProvider(value: unknown): DesktopModelProvider | undefined {
  if (value === 'deepseek' || value === 'kimi' || value === 'minimax' || value === 'custom') {
    return value;
  }
  return undefined;
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

function buildWebHostSnapshot(config: DesktopWebHostConfigFile): DesktopWebHostSnapshot {
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

function currentApiBase(config: DesktopConfigFile): string {
  return (
    config.models.find((model) => model.name === config.activeModel)?.apiBase ||
    config.models[0]?.apiBase ||
    ''
  );
}

function cloneChatArchive(archive: ChatArchive): ChatArchive {
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

function archiveBeforeLastUser(archive: ChatArchive): ChatArchive {
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

function parseApprovalDecision(message: string): RuntimeApprovalDecision {
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

function toRuntimeAskQuestionsResult(
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

function mapPendingQuestions(
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

function stripPendingThinkingMatchingFinalized(
  aux: MessageAuxSnapshot | undefined,
  finalizedText: string,
): MessageAuxSnapshot | undefined {
  if (!aux?.thinking) {
    return aux;
  }
  if (aux.thinking.trim() !== finalizedText.trim()) {
    return aux;
  }
  const { thinking: _t, ...rest } = aux;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function stripThinkingFromAux(aux: MessageAuxSnapshot | undefined): MessageAuxSnapshot | undefined {
  if (!aux?.thinking) {
    return normalizeMessageAuxSnapshot(aux);
  }
  const { thinking: _thinking, ...rest } = aux;
  return normalizeMessageAuxSnapshot(rest);
}

function isStandaloneThinkingMessage(
  message: ConversationMessageSnapshot | undefined,
): boolean {
  return Boolean(
    message?.role === 'assistant' &&
      !message.tool &&
      !message.content.trim() &&
      message.aux?.thinking?.trim(),
  );
}

function rewindStandalonePendingAuxInsertIndexForThinking(
  messages: ReadonlyArray<ConversationMessageSnapshot>,
  anchorIndex: number,
): number {
  let index = anchorIndex;
  while (index > 0 && isStandaloneThinkingMessage(messages[index - 1])) {
    index -= 1;
  }
  return index;
}

function parsePendingSubagentStatusText(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }

  const status = text
    .trim()
    .replace(/^[|/\\-]\s*/, '')
    .trim();

  if (!status || status === 'Thinking...' || status === 'Compressing...') {
    return undefined;
  }

  return status;
}

function isStandaloneSubagentStatusAux(
  pendingAux: PendingAssistantAux | undefined,
): boolean {
  return Boolean(pendingAux && parsePendingSubagentStatusText(pendingAux.statusText));
}

function shouldHidePendingAssistantThinkingForLiveStandaloneSubagentStatus(
  message: ConversationMessageSnapshot,
  livePendingAux: PendingAssistantAux | undefined,
): boolean {
  return Boolean(
    isStandaloneSubagentStatusAux(livePendingAux) &&
      message.role === 'assistant' &&
      message.pending &&
      !message.tool &&
      !message.content.trim(),
  );
}

function shouldReanchorPersistedStandaloneSubagentStatusOnBeginAssistantResponse(
  lastMessage: ConversationMessageSnapshot | undefined,
  persistedStandalonePendingAux: PendingAssistantAux | undefined,
): boolean {
  return Boolean(
    lastMessage?.role === 'assistant' &&
      isStandaloneSubagentStatusAux(persistedStandalonePendingAux),
  );
}

function messageIndexIsInCurrentTurn(
  messages: ReadonlyArray<ConversationMessageSnapshot>,
  index: number,
): boolean {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  return index > lastUserIdx;
}

function hasStandaloneThinkingMessageInCurrentTurn(
  messages: ReadonlyArray<ConversationMessageSnapshot>,
): boolean {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  for (let i = lastUserIdx + 1; i < messages.length; i += 1) {
    const message = messages[i];
    if (
      message?.role === 'assistant' &&
      !message.tool &&
      !message.content.trim() &&
      Boolean(message.aux?.thinking?.trim())
    ) {
      return true;
    }
  }

  return false;
}

function describeAuxForDebug(aux: MessageAuxSnapshot): string {
  const parts: string[] = [];
  if (aux.thinking?.trim()) {
    parts.push(`T≈${truncateOneLineForDebug(aux.thinking, 28)}`);
  }
  if (aux.compaction?.trim()) {
    parts.push(`C≈${truncateOneLineForDebug(aux.compaction, 28)}`);
  }
  return parts.join('+') || 'none';
}

function describeOptionalAuxForDebug(aux: MessageAuxSnapshot | undefined): string {
  return aux ? describeAuxForDebug(aux) : 'none';
}

function normalizeToolBlockSnapshot(
  tool: ToolBlockSnapshot | undefined,
): ToolBlockSnapshot | undefined {
  if (!tool) {
    return undefined;
  }

  const toolName = tool.toolName.trim() || 'unknown-tool';
  const headline = tool.headline.trim() || defaultToolHeadline(tool.phase, toolName);
  const detailLines = tool.detailLines.filter((line) => line.trim().length > 0);
  const argsExcerpt = tool.argsExcerpt?.trim() ? tool.argsExcerpt : undefined;
  const outputExcerpt = tool.outputExcerpt?.trim() ? tool.outputExcerpt : undefined;

  return {
    ...tool,
    toolName,
    headline,
    detailLines,
    ...(argsExcerpt ? { argsExcerpt } : {}),
    ...(outputExcerpt ? { outputExcerpt } : {}),
  };
}

function normalizeMessageAuxSnapshot(
  aux: MessageAuxSnapshot | undefined,
): MessageAuxSnapshot | undefined {
  if (!aux) {
    return undefined;
  }

  const thinking = aux.thinking?.trim() ? aux.thinking : undefined;
  const compaction = aux.compaction?.trim() ? aux.compaction : undefined;
  if (!thinking && !compaction) {
    return undefined;
  }

  return {
    ...(thinking ? { thinking } : {}),
    ...(compaction ? { compaction } : {}),
  };
}

function shouldDropEmptyAssistantMessage(
  message: ConversationMessageSnapshot,
  tool: ToolBlockSnapshot | undefined,
  aux: MessageAuxSnapshot | undefined,
): boolean {
  return (
    message.role === 'assistant' &&
    !message.pending &&
    !message.content.trim() &&
    !tool &&
    !aux
  );
}

function shouldHideEmptyPendingAssistantSnapshot(message: ConversationMessageSnapshot): boolean {
  return (
    message.role === 'assistant' &&
    message.pending &&
    !message.content.trim() &&
    !message.tool &&
    !normalizeMessageAuxSnapshot(message.aux)
  );
}

function defaultToolHeadline(
  phase: ToolBlockSnapshot['phase'],
  toolName: string,
): string {
  switch (phase) {
    case 'pending-approval':
      return `等待确认: ${toolName}`;
    case 'running':
      return `调用中: ${toolName}`;
    case 'failed':
      return `工具执行失败: ${toolName}`;
    case 'succeeded':
    default:
      return `工具执行完成: ${toolName}`;
  }
}

/** 最后一条 user 之后、首条助手工具行之前；找不到则返回 `undefined`（由调用方改为插在「最后一条 user」之后）。 */
function indexForThinkingInsertBeforeFirstToolAfterLastUser(
  messages: ConversationMessageSnapshot[],
): number | undefined {
  let lastUser = -1;
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i]?.role === 'user') {
      lastUser = i;
    }
  }
  for (let i = lastUser + 1; i < messages.length; i += 1) {
    const m = messages[i];
    if (m?.role === 'assistant' && m.tool) {
      return i;
    }
  }
  return undefined;
}

/** 与 `historyStore` 中最后一条 user 对齐：在其后插入思考，避免审批指导后尚无新工具行时误用 `push` 落到整段末尾。 */
function indexForThinkingInsertAfterLastUser(messages: ConversationMessageSnapshot[]): number {
  let lastUser = -1;
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i]?.role === 'user') {
      lastUser = i;
    }
  }
  return lastUser < 0 ? 0 : lastUser + 1;
}

/** 末条 user 之后是否已有其它工具卡为「待审批」或「执行中」（不含当前 toolCallId）。 */
function hasBlockingToolAheadOfSameTurnPreview(
  messages: ConversationMessageSnapshot[],
  thisToolCallId: string,
): boolean {
  let lastUser = -1;
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i]?.role === 'user') {
      lastUser = i;
    }
  }
  for (let i = lastUser + 1; i < messages.length; i += 1) {
    const m = messages[i];
    if (m?.role !== 'assistant' || !m.tool) {
      continue;
    }
    if (m.tool.toolCallId === thisToolCallId) {
      continue;
    }
    const p = m.tool.phase;
    if (p === 'pending-approval' || p === 'running') {
      return true;
    }
  }
  return false;
}

function headlineForStreamingToolPreview(
  messages: ConversationMessageSnapshot[],
  toolCallId: string,
  toolName: string,
): string {
  return hasBlockingToolAheadOfSameTurnPreview(messages, toolCallId)
    ? `排队中: ${toolName}`
    : `调用中: ${toolName}`;
}

function restoreMessagesFromArchive(
  archive: StoredDesktopSession,
): ConversationMessageSnapshot[] {
  const auxByIndex = new Map<number, MessageAuxSnapshot>();
  for (const entry of archive.assistantAux) {
    auxByIndex.set(entry.messageIndex, {
      ...(entry.thinking ? { thinking: entry.thinking } : {}),
      ...(entry.compaction ? { compaction: entry.compaction } : {}),
    });
  }

  return archive.messages.map((message, index) => ({
    id: index + 1,
    role: message.role,
    content: message.content,
    ...(auxByIndex.get(index) ? { aux: auxByIndex.get(index) } : {}),
    pending: false,
  }));
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

function deriveDisplayNameFromSeed(seed: string): string {
  const trimmed = seed.trim();
  if (!trimmed) {
    return 'New conversation';
  }
  return trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed;
}

function deriveDisplayNameFromMessages(messages: ConversationMessageSnapshot[]): string {
  const firstUser = messages.find(
    (message) => message.role === 'user' && message.content.trim().length > 0,
  );
  return deriveDisplayNameFromSeed(firstUser?.content ?? 'New conversation');
}

function toolMessageKey(
  pending:
    | RuntimePendingApproval<DesktopToolRequest, string>
    | RuntimePendingQuestions<DesktopToolRequest>,
): string {
  return 'toolCallId' in pending && pending.toolCallId
    ? pending.toolCallId
    : `pending:${pending.toolName}`;
}
