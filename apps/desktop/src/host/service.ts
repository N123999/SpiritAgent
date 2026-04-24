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
  type RuntimeToolExecution,
} from '@spirit-agent/agent-core';

import type {
  ActiveSessionSnapshot,
  AddModelRequest,
  AskQuestionsResult,
  BootstrapRequest,
  ConversationMessageSnapshot,
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
  private messageIdCounter = 1;
  private serialized = Promise.resolve();

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

      if (
        this.runtime?.isBusy() &&
        (request.activeModel.trim() !== state.config.activeModel ||
          request.apiBase.trim() !== currentApiBase(state.config) ||
          Boolean(request.apiKey?.trim()))
      ) {
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
      await saveConfig(state.config);
      if (request.apiKey?.trim()) {
        await saveApiKeyForModel(activeModel, request.apiKey);
      }

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
      await this.persistCurrentSessionIfNeeded();

      try {
        await runtime.startUserTurnStreaming(trimmed);
      } catch (error) {
        state.messages.pop();
        throw error;
      }

      this.consumeCompletedTurnResult();
      this.syncPendingToolStates();
      return this.buildSnapshot();
    });
  }

  async poll(): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      if (this.runtime) {
        this.runtime.tickThinkingSpinner();
        await this.runtime.poll();
      }
      this.consumeCompletedTurnResult();
      this.syncPendingToolStates();
      await this.persistCurrentSessionIfNeeded();
      return this.buildSnapshot();
    });
  }

  async replyPendingApproval(message: string): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const runtime = this.requireRuntime();
      await runtime.continuePendingApproval(parseApprovalDecision(message));
      this.consumeCompletedTurnResult();
      this.syncPendingToolStates();
      return this.buildSnapshot();
    });
  }

  async replyPendingQuestions(result: AskQuestionsResult): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const runtime = this.requireRuntime();
      await runtime.continuePendingQuestions(toRuntimeAskQuestionsResult(result));
      this.consumeCompletedTurnResult();
      this.syncPendingToolStates();
      await this.persistCurrentSessionIfNeeded();
      return this.buildSnapshot();
    });
  }

  async resetSession(): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      if (this.runtime?.isBusy()) {
        throw new Error('当前已有响应或审批在处理中，请稍候。');
      }

      const state = this.requireState();
      state.messages = [];
      state.activeSession = undefined;
      state.archiveHistory = [];
      state.archiveSubagentSessions = [];
      this.latestPendingAssistantAux = undefined;
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
    const metadata = await loadHostMetadata(workspaceRoot);
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
    state.metadata = await loadHostMetadata(state.workspaceRoot);
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
      },
      rules: {
        discovered: state.metadata.rules.discovered,
        enabled: state.metadata.rules.enabled,
      },
      skills: {
        discovered: state.metadata.skills.discovered,
        enabled: state.metadata.skills.enabled,
      },
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
    if (pendingMessage) {
      messages.push(pendingMessage);
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
      id: 0,
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

    state.messages.push({
      id: this.allocateMessageId(),
      role: 'assistant',
      content: '',
      tool,
      pending: false,
    });
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

  private takeLatestPendingAux(): MessageAuxSnapshot | undefined {
    const current = this.latestPendingAssistantAux;
    this.latestPendingAssistantAux = undefined;
    return current;
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