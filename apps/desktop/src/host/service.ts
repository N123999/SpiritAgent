import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AgentRuntime,
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
} from '@spirit-agent/agent-core';
import {
  resolveInstructionPaths,
  SKILL_FILE_NAME,
  validateSkillName,
} from '@spirit-agent/host-internal';

import type {
  ActiveSessionSnapshot,
  AddModelRequest,
  AskQuestionsResult,
  BootstrapRequest,
  ConversationMessageSnapshot,
  CreateSkillRequest,
  DeleteSkillRequest,
  DesktopSkillRootKind,
  DesktopSnapshot,
  MessageAuxSnapshot,
  PendingQuestionsSnapshot,
  RemoveModelRequest,
  SessionListItem,
  ToolBlockSnapshot,
  UpdateConfigRequest,
} from '../types.js';
import type { DesktopToolRequest, HostCommandName, StoredDesktopSession } from './contracts.js';
import {
  DEFAULT_API_BASE,
  defaultNewSessionPath,
  discoverWorkspaceRoot,
  loadConfig,
  loadHostMetadata,
  loadStoredSession,
  modelSecretKeyPresence,
  removeModelApiKey,
  resolveApiKeyForModel,
  saveApiKeyForModel,
  saveConfig,
  saveStoredSession,
  listStoredSessions,
  spiritAgentDataDir,
  type DesktopConfigFile,
  type HostMetadataSummary,
} from './storage.js';
import { DesktopToolExecutor } from './tool-executor.js';

type DesktopRuntime = AgentRuntime<
  OpenAiTransportConfig,
  OpenAiToolAgentState,
  DesktopToolRequest,
  string
>;

type CommandPayloads = {
  bootstrap: { request?: BootstrapRequest };
  updateConfig: { request: UpdateConfigRequest };
  addModel: { request: AddModelRequest };
  removeModel: { request: RemoveModelRequest };
  createSkill: { request: CreateSkillRequest };
  deleteSkill: { request: DeleteSkillRequest };
  submitUserTurn: { text: string };
  poll: undefined;
  replyPendingApproval: { message: string };
  replyPendingQuestions: { result: AskQuestionsResult };
  resetSession: undefined;
  listSessions: undefined;
  openSession: { path: string };
};

interface HostState {
  workspaceRoot: string;
  config: DesktopConfigFile;
  metadata: HostMetadataSummary;
  messages: ConversationMessageSnapshot[];
  activeSession?: ActiveSessionSnapshot;
  archiveHistory: ChatArchive['llmHistory'];
  archiveSubagentSessions: NonNullable<ChatArchive['subagentSessions']>;
}

class DesktopHostService {
  private readonly transport = new OpenAiTransport();
  private state: HostState | undefined;
  private runtime: DesktopRuntime | undefined;
  private initialized = false;
  private lastRuntimeError = '';
  private activeApiKeyConfigured = false;
  private modelKeyPresence: Record<string, boolean> = {};
  private latestPendingAssistantAux: MessageAuxSnapshot | undefined;
  /** 思考段 finalize 去重、插入锚点与 apply 批次（见 `applyRuntimeHostEvents` / `appendAssistantThinkingSegment`）。 */
  private lastFinalizedThinkingSegment = '';
  private streamAssistantThinkingAnchor: number | undefined;
  private streamAssistantAnchorSetInApplyBatchId = 0;
  private lastApplyEventBatchId = 0;
  private messageOrderDebugLastVerboseLogMs = 0;
  private messageIdCounter = 1;
  private serialized = Promise.resolve();
  /** 忙时改 planMode / 模型或 endpoint 时推迟 `refreshRuntime`，避免替换 runtime 导致流式输出丢失；空闲后由 `flushDeferredRuntimeRefreshIfIdle` 应用。 */
  private deferredRuntimeRefreshWhileBusy = false;

  async bootstrap(request?: BootstrapRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(request?.workspaceRoot);
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
      await this.persistCurrentSessionIfNeeded();
      await this.flushDeferredRuntimeRefreshIfIdle();
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

      state.config.models.push({ name, apiBase });
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

  async submitUserTurn(text: string): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const runtime = this.requireRuntime();
      const trimmed = text.trim();
      if (!trimmed) {
        throw new Error('消息不能为空。');
      }

      const state = this.requireState();
      this.ensureActiveSession(trimmed);
      state.messages.push({
        id: this.allocateMessageId(),
        role: 'user',
        content: trimmed,
        pending: false,
      });
      this.resetStreamingPlacementState(false);
      await this.persistCurrentSessionIfNeeded();

      try {
        await runtime.startUserTurnStreaming(trimmed);
        await runtime.poll();
        this.applyRuntimeHostEvents(runtime.drainEvents());
      } catch (error) {
        state.messages.pop();
        throw error;
      }

      this.consumeCompletedTurnResult();
      this.syncPendingToolStates();
      this.syncAssistantPrefixFromHistoryBeforeToolRow();
      await this.flushDeferredRuntimeRefreshIfIdle();
      return this.buildSnapshot();
    });
  }

  async poll(): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
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
      return this.buildSnapshot();
    });
  }

  async replyPendingApproval(message: string): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
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
      return this.buildSnapshot();
    });
  }

  async replyPendingQuestions(result: AskQuestionsResult): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const runtime = this.requireRuntime();
      await runtime.continuePendingQuestions(toRuntimeAskQuestionsResult(result));
      await runtime.poll();
      this.applyRuntimeHostEvents(runtime.drainEvents());
      this.consumeCompletedTurnResult();
      this.syncPendingToolStates();
      this.syncAssistantPrefixFromHistoryBeforeToolRow();
      await this.persistCurrentSessionIfNeeded();
      await this.flushDeferredRuntimeRefreshIfIdle();
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
      this.latestPendingAssistantAux = undefined;
      this.resetStreamingPlacementState(true);
      this.messageIdCounter = 1;
      await this.refreshRuntime();
      this.lastRuntimeError = '';
      return this.buildSnapshot();
    });
  }

  async listSessions(): Promise<SessionListItem[]> {
    return this.runSerialized(async () => listStoredSessions());
  }

  async openSession(filePath: string): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      this.deferredRuntimeRefreshWhileBusy = false;
      const loaded = await loadStoredSession(filePath);
      const state = this.requireState();
      state.messages = loaded.desktopMessages
        ? loaded.desktopMessages.map((message) => ({ ...message }))
        : restoreMessagesFromArchive(loaded);
      state.activeSession = {
        filePath: path.resolve(filePath),
        displayName:
          loaded.sessionDisplayName ?? deriveDisplayNameFromMessages(state.messages),
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
      this.messageIdCounter =
        Math.max(0, ...state.messages.map((message) => message.id)) + 1;
      this.latestPendingAssistantAux = undefined;
      this.resetStreamingPlacementState(true);
      await this.refreshRuntime();
      this.lastRuntimeError = '';
      return this.buildSnapshot();
    });
  }

  async invoke(command: HostCommandName, payload?: unknown): Promise<unknown> {
    switch (command) {
      case 'bootstrap': {
        const typedPayload = payload as CommandPayloads['bootstrap'] | undefined;
        return this.bootstrap(typedPayload?.request);
      }
      case 'updateConfig': {
        const typedPayload = payload as CommandPayloads['updateConfig'];
        return this.updateConfig(typedPayload.request);
      }
      case 'addModel': {
        const typedPayload = payload as CommandPayloads['addModel'];
        return this.addModel(typedPayload.request);
      }
      case 'removeModel': {
        const typedPayload = payload as CommandPayloads['removeModel'];
        return this.removeModel(typedPayload.request);
      }
      case 'createSkill': {
        const typedPayload = payload as CommandPayloads['createSkill'];
        return this.createSkill(typedPayload.request);
      }
      case 'deleteSkill': {
        const typedPayload = payload as CommandPayloads['deleteSkill'];
        return this.deleteSkill(typedPayload.request);
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
      default:
        throw new Error(`Unsupported host command: ${command satisfies never}`);
    }
  }

  private async ensureInitialized(workspaceRootOverride?: string): Promise<void> {
    const workspaceRoot = workspaceRootOverride?.trim()
      ? path.resolve(workspaceRootOverride.trim())
      : discoverWorkspaceRoot();

    if (this.initialized && this.state?.workspaceRoot === workspaceRoot) {
      return;
    }

    const config = await loadConfig();
    const metadata = await loadHostMetadata(workspaceRoot, config.planMode === true);
    const state = this.state;

    this.state = {
      workspaceRoot,
      config,
      metadata,
      messages: state?.messages ?? [],
      activeSession: state?.activeSession,
      archiveHistory: state?.archiveHistory ?? [],
      archiveSubagentSessions: state?.archiveSubagentSessions ?? [],
    };
    this.initialized = true;
    await this.refreshRuntime();
  }

  private async refreshRuntime(): Promise<void> {
    const state = this.requireState();
    state.metadata = await loadHostMetadata(
      state.workspaceRoot,
      state.config.planMode === true,
    );
    const apiKey = await resolveApiKeyForModel(state.config.activeModel);
    this.activeApiKeyConfigured = Boolean(apiKey);
    if (!apiKey) {
      this.runtime = undefined;
      this.lastRuntimeError = '未配置 API Key，请在设置中填写。';
      await this.refreshModelKeyPresence();
      return;
    }

    const runtime = this.createRuntime(
      {
        apiKey,
        model: state.config.activeModel,
        baseUrl: currentApiBase(state.config),
        workspaceRoot: state.workspaceRoot,
      },
      state.archiveHistory,
      state.metadata.rules.enabledRules,
      state.metadata.skills.enabledSkillCatalog,
      state.metadata.planMetadata,
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
  ): DesktopRuntime {
    const workspaceRoot = transportConfig.workspaceRoot ?? this.requireState().workspaceRoot;
    return new AgentRuntime({
      config: transportConfig,
      llmTransport: this.transport,
      toolExecutor: new DesktopToolExecutor(workspaceRoot),
      createToolAgentState: (messages, userInput) =>
        startOpenAiToolAgentState(
          messages,
          userInput,
          workspaceRoot,
          enabledRules,
          enabledSkillCatalog,
          [],
          transportConfig.model,
          planMetadata,
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
          [],
          transportConfig.model,
          planMetadata,
        ),
      resolveWorkspaceFilesFromInput: (input) =>
        pendingWorkspaceFilesFromInput(workspaceRoot, input),
    }, history.map((message) => ({
      role: message.role,
      content: message.content,
      imagePaths: [...message.imagePaths],
    })));
  }

  private buildSnapshot(): DesktopSnapshot {
    const state = this.requireState();
    const pendingApproval = this.runtime?.currentPendingApproval();
    const pendingQuestions = this.runtime?.currentPendingQuestions();
    const pendingAux = this.runtime?.pendingAuxState();
    if (pendingAux) {
      this.latestPendingAssistantAux = mergeAux(
        this.latestPendingAssistantAux,
        pendingAux.kind,
        pendingAux.detailText ?? pendingAux.statusText,
      );
    }

    return {
      workspaceRoot: state.workspaceRoot,
      runtimeReady: this.runtime !== undefined,
      ...(this.lastRuntimeError ? { runtimeError: this.lastRuntimeError } : {}),
      config: {
        models: state.config.models.map((model) => ({
          name: model.name,
          apiBase: model.apiBase,
          keyConfigured: this.modelKeyPresence[model.name] ?? false,
        })),
        activeModel: state.config.activeModel,
        ...(state.config.uiLocale ? { uiLocale: state.config.uiLocale } : {}),
        activeApiKeyConfigured: this.activeApiKeyConfigured,
        windowsMica: state.config.windowsMica !== false,
        planMode: state.config.planMode === true,
      },
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
      plan: {
        path: state.metadata.planMetadata.path,
        exists: state.metadata.planMetadata.exists,
      },
      mcpStatus: {
        revision: 0,
        state: 'idle',
        configuredServers: 0,
        loadedServers: 0,
        cachedTools: 0,
      },
      conversation: {
        messages: this.messagesWithPendingAssistant(),
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
      },
      ...(state.activeSession ? { activeSession: { ...state.activeSession } } : {}),
    };
  }

  private messagesWithPendingAssistant(): ConversationMessageSnapshot[] {
    const state = this.requireState();
    const messages = state.messages.map((message) => ({ ...message }));
    const pendingMessage = this.buildPendingAssistantMessage();
    if (!pendingMessage) {
      return messages;
    }
    /** 有 running/待审批工具则插在首条之前；否则接在末尾（避免挂起思考盖住已完成工具卡）。 */
    const beforeFirstRunning = indexForPendingInsertBeforeFirstActiveToolAfterLastUser(messages);
    if (beforeFirstRunning === undefined) {
      messages.push(pendingMessage);
    } else {
      messages.splice(beforeFirstRunning, 0, pendingMessage);
    }
    return messages;
  }

  private buildPendingAssistantMessage(): ConversationMessageSnapshot | undefined {
    if (!this.runtime?.isBusy()) {
      return undefined;
    }

    const pendingText = this.runtime.pendingAssistantText();
    const pendingAux = this.runtime.pendingAuxState();
    const aux = pendingAux
      ? mapPendingAuxToMessageAux(pendingAux.kind, pendingAux.detailText ?? pendingAux.statusText)
      : this.latestPendingAssistantAux;

    if (!pendingText && !aux) {
      return undefined;
    }

    if (aux) {
      this.latestPendingAssistantAux = aux;
    }

    return {
      id: -1,
      role: 'assistant',
      content: pendingText,
      ...(aux ? { aux } : {}),
      pending: true,
    };
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
        if (result.assistantText.trim()) {
          this.appendAssistantMessage(result.assistantText, this.takeLatestPendingAux());
        }
        this.lastRuntimeError = '';
        break;
      case 'failed':
        this.appendAssistantMessage(result.error, this.takeLatestPendingAux());
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

  private integrateToolExecutions(executions: RuntimeToolExecution<DesktopToolRequest>[]): void {
    for (const execution of executions) {
      this.upsertToolMessage(execution.toolCallId || `tool:${execution.toolName}`, {
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
        this.streamAssistantThinkingAnchor =
          this.streamAssistantThinkingAnchor === undefined
            ? at
            : Math.min(this.streamAssistantThinkingAnchor, at);
        this.streamAssistantAnchorSetInApplyBatchId = batchId;
        continue;
      }
      if (ev.kind === 'assistant-thinking-segment-finalized') {
        if (ev.text.trim()) {
          this.appendAssistantThinkingSegment(ev.text);
        }
        continue;
      }
      if (ev.kind === 'tool-execution-finished') {
        this.integrateToolExecutions([ev.execution]);
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
    const prefixFromBeforeFirst = assistantPrefixBeforeFirstToolInCurrentTurn(hist);
    const prefixFromLastAssistant = lastAssistantPlainTextInHistory(hist);
    const prefix = (
      awaitingInteractive && pendingTrim
        ? pendingTrim
        : awaitingInteractive
          ? (prefixFromLastAssistant ?? prefixFromBeforeFirst)
          : prefixFromBeforeFirst
    )
      ?.trim() ?? '';
    const state = this.requireState();
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

  private upsertToolMessage(toolCallId: string, tool: ToolBlockSnapshot): void {
    const state = this.requireState();
    const existing = state.messages.find(
      (message) => message.tool?.toolCallId === toolCallId,
    );

    if (existing) {
      existing.tool = tool;
      return;
    }

    const batchId = this.lastApplyEventBatchId;
    if (this.streamAssistantThinkingAnchor === undefined) {
      this.streamAssistantThinkingAnchor = state.messages.length;
    }
    this.streamAssistantAnchorSetInApplyBatchId = batchId;
    const pushAt = state.messages.length;
    state.messages.push({
      id: this.allocateMessageId(),
      role: 'assistant',
      content: '',
      tool,
      pending: false,
    });
    this.logMessageOrderToolPreviewNew(tool.toolName, pushAt);
  }

  private appendAssistantMessage(content: string, aux?: MessageAuxSnapshot): void {
    const state = this.requireState();
    state.messages.push({
      id: this.allocateMessageId(),
      role: 'assistant',
      content,
      ...(aux ? { aux } : {}),
      pending: false,
    });
  }

  /** 将本段模型思考固化为独立消息，并从挂起 aux 中剥离同文以避免与终稿重复。 */
  private appendAssistantThinkingSegment(text: string): void {
    this.lastFinalizedThinkingSegment = text.trim();
    const state = this.requireState();
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

  private ensureActiveSession(seedText: string): void {
    const state = this.requireState();
    if (state.activeSession) {
      return;
    }

    state.activeSession = {
      filePath: defaultNewSessionPath(),
      displayName: deriveDisplayNameFromSeed(seedText),
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

  private async persistCurrentSessionIfNeeded(): Promise<void> {
    const state = this.requireState();
    if (!state.activeSession || this.runtime?.isBusy()) {
      return;
    }

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
      desktopMessages: state.messages.map((message) => ({ ...message })),
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
    if (!full) {
      this.streamAssistantThinkingAnchor = undefined;
      return;
    }
    this.lastFinalizedThinkingSegment = '';
    this.streamAssistantThinkingAnchor = undefined;
    this.streamAssistantAnchorSetInApplyBatchId = 0;
    this.lastApplyEventBatchId = 0;
    this.messageOrderDebugLastVerboseLogMs = 0;
  }

  private takeLatestPendingAux(): MessageAuxSnapshot | undefined {
    const current = this.latestPendingAssistantAux;
    this.latestPendingAssistantAux = undefined;
    if (!current) {
      this.lastFinalizedThinkingSegment = '';
      return undefined;
    }
    if (
      this.lastFinalizedThinkingSegment &&
      current.thinking?.trim() === this.lastFinalizedThinkingSegment.trim()
    ) {
      const { thinking: _thinking, ...rest } = current;
      this.lastFinalizedThinkingSegment = '';
      return Object.keys(rest).length > 0 ? rest : undefined;
    }
    this.lastFinalizedThinkingSegment = '';
    return current;
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
      } else if (ev.kind === 'assistant-thinking-segment-finalized') {
        tags.push(ev.text.trim() ? 'finalize' : 'finalize-empty');
      } else if (ev.kind === 'tool-execution-finished') {
        tags.push(`tool-done:${ev.execution.toolName}`);
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
  const c = m.content.trim();
  if (!c) {
    return 'Aε';
  }
  return `a:${truncateOneLineForDebug(c, 18)}`;
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

function formatYamlScalarForSkillFrontmatter(value: string): string {
  const flat = value.replace(/\r?\n/g, ' ').trim() || '说明';
  return `"${flat.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
}

const desktopHostService = new DesktopHostService();

export async function invokeDesktopHostCommand(
  command: HostCommandName,
  payload?: unknown,
): Promise<unknown> {
  return desktopHostService.invoke(command, payload);
}

function currentApiBase(config: DesktopConfigFile): string {
  return (
    config.models.find((model) => model.name === config.activeModel)?.apiBase ||
    config.models[0]?.apiBase ||
    ''
  );
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

function mapPendingAuxToMessageAux(
  kind: 'thinking' | 'compressing',
  text: string,
): MessageAuxSnapshot {
  return kind === 'thinking' ? { thinking: text } : { compaction: text };
}

function mergeAux(
  current: MessageAuxSnapshot | undefined,
  kind: 'thinking' | 'compressing',
  text: string,
): MessageAuxSnapshot {
  return kind === 'thinking'
    ? { ...(current ?? {}), thinking: text }
    : { ...(current ?? {}), compaction: text };
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

function toolPhaseIsActiveForPendingOrder(phase: ToolBlockSnapshot['phase'] | undefined): boolean {
  return phase === 'running' || phase === 'pending-approval';
}

/**
 * 最后一条 user 之后、首条**仍进行中**的助手工具行之前。
 * 无进行中工具时返回 `undefined`，表示挂起助手应接在整段消息末尾（已完成工具之后）。
 */
function indexForPendingInsertBeforeFirstActiveToolAfterLastUser(
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
    if (m?.role === 'assistant' && m.tool && toolPhaseIsActiveForPendingOrder(m.tool.phase)) {
      return i;
    }
  }
  return undefined;
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