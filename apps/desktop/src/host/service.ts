import { lstat, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import i18n from '../lib/i18n-host.js';
import {
  appendLlmToolResultMessages,
  buildActiveSkillsSystemMessage,
  buildBasicInfoSystemMessage,
  buildDreamCollectorSystemMessage,
  buildDreamsSystemMessage,
  buildExtensionsSystemMessage,
  buildPlanSystemMessage,
  buildRulesSystemMessage,
  buildSkillsCatalogSystemMessage,
  buildToolAgentHostPrompt,
  createLlmTransport,
  McpService,
  invalidateSharedUserMcpToolingCache,
  extractLastLlmAssistantText,
  buildDreamReadHostToolDefinitions,
  startLlmToolAgentState,
  type AssistantAuxArchiveEntry,
  type AnthropicTransportConfig,
  type ChatArchive,
  type LlmActiveSkill,
  type LlmEnabledRule,
  type LlmEnabledSkillCatalogEntry,
  type LlmExtensionSystemPrompt,
  type LlmModelCapabilities,
  type LlmPlanMetadata,
  type LlmToolAgentBasicInfo,
  type LlmTransportConfig,
  type OpenResponsesSdkProvider,
  type OpenAiTransportConfig,
  resolveOpenResponsesReasoningSummary,
  type RuntimeApprovalDecision,
  type RuntimeEvent,
  type PendingWorkspaceFile,
  type RuntimeToolExecution,
  type SpiritLlmTransport,
} from '@spirit-agent/agent-core';
import {
  defaultModelReasoningEffort,
  resolveAnthropicTransportReasoningEffortForContext,
  resolveModelReasoningEffortForContext,
  resolveOpenAiTransportReasoningEffortForContext,
  type ModelReasoningEffort,
} from '@spirit-agent/agent-core/reasoning-effort';
import {
  buildStartImplementingUserTurn,
  extractActivePlanPathFromLlmHistory,
  createHostExtensionMarketplace,
  createHostExtensionManager,
  createHostDreamStore,
  localFileAttachmentFromPath,
  listWorkspaceFileReferenceSuggestions as listWorkspaceFileReferenceSuggestionsFromHostInternal,
  listProviderModels,
  parseModelProviderId,
  parsePresetModelProviderId,
  partitionModelsByProvider,
  PROVIDER_PRESET_API_BASE,
  resolveProviderConnectApiBase,
  restoreHostFileChanges,
  type HostDreamScope,
  type HostTodoRecord,
  type HostTodoScope,
  type HostExtensionMarketplaceManager,
  type HostExtensionEvent,
  type HostRecordedFileChange,
  type ProviderListedModelEntry,
  type ApprovalLevel,
  normalizeApprovalLevel,
  normalizeWorkLocationKind,
  type WorkLocationKind,
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
  CheckoutGitBranchRequest,
  ConversationLocalFileAttachmentSnapshot,
  ConversationMessageSnapshot,
  ConversationTodoSnapshot,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteMcpServerRequest,
  DesktopDreamOverviewItem,
  DesktopApprovalDecision,
  DesktopMcpServerInspection,
  DesktopExtensionListItem,
  DesktopExtensionCssLayer,
  DesktopMarketplaceCatalogItem,
  DesktopMarketplaceDetail,
  DesktopMarketplacePreparedInstall,
  DesktopGitSnapshot,
  DesktopDreamCollectorSnapshot,
  DesktopModelCapability,
  DesktopModelProvider,
  DesktopModelReasoningEffort,
  DesktopTransportKind,
  ModelProfileSnapshot,
  PlanSnapshot,
  PreviewModelCatalogEntry,
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
  RemoveProviderModelsRequest,
  QueryWorkspaceFileReferenceSuggestionsRequest,
  SessionListItem,
  ImportExtensionRequest,
  InstallMarketplaceExtensionRequest,
  PrepareMarketplaceExtensionInstallRequest,
  SubmitUserTurnRequest,
  SubmitCreateSkillSlashRequest,
  SubmitSkillSlashRequest,
  UpdateConfigRequest,
  WorkspaceExplorerListResult,
  WorkspaceFileReferenceSuggestionsResponse,
  WorkspaceReadTextFileResult,
  WriteWorkspaceTextFileRequest,
} from '../types.js';
import type { DesktopToolRequest, HostCommandName } from './contracts.js';
import {
  buildArchiveAssistantAuxFromConversation,
  buildArchiveMessagesFromConversation,
  buildCommitEphemeralSessionRecord,
  buildStoredDesktopSession,
  buildWorktreeEphemeralSessionRecord,
  createEphemeralCommitSessionPath,
  createEphemeralWorktreeSessionPath,
  deriveDisplayNameFromSeed,
  ephemeralSessionsToListItems,
  type EphemeralSessionRecord,
  isEphemeralDebugSessionPath,
  nextMessageIdFromMessages,
  rememberEphemeralSessionRecord,
  rememberEphemeralWorktreeSessionRecord,
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
  previewCatalogMapForTransport,
  previewModelCatalogForTransport,
  usesProviderListedModelCatalogMetadata,
} from './model-catalog-metadata.js';
import {
  DEFAULT_API_BASE,
  defaultNewSessionPath,
  discoverWorkspaceRoot,
  isProvisionalSessionPath,
  provisionalNewSessionPath,
  loadConfig,
  loadHostMetadata,
  normalizeWorkspaceBinding,
  resolveDesktopHomeDirectory,
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
  defaultCustomModelCapabilities,
  normalizeDreamConfig,
  normalizeModelCapabilities,
  normalizeWebHostConfig,
  type DesktopConfigFile,
  type DesktopWebHostConfigFile,
  type DesktopWorkspaceBinding,
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
  buildDreamCollectorPlanMetadata,
  buildDreamContextText,
  clearDreamCollectorIssue,
  DREAM_COLLECTOR_BACKOFF_MS,
  DREAM_COLLECTOR_MONITOR_INTERVAL_MS,
  DREAM_COLLECTOR_TICK_INTERVAL_MS,
  emptyDreamCollectorSnapshot,
  isDreamCollectorDebugSessionPath,
  runDesktopDreamCollectorOnce,
} from './dreams.js';
import {
  buildSessionTodosContextText,
  cloneHostTodoRecords,
  listSessionTodos,
  purgeSessionTodos,
  replaceSessionTodos,
  resolveTodoSessionKey,
  createTodoScope,
  mapHostTodoToDesktopItem,
  migrateSessionTodos,
  createTodoSessionScopeKey,
  normalizeTodoSessionStorageKey,
} from './todos.js';
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
  addMcpServerToDisk,
  buildMcpServerConfigFromRequest,
  deleteMcpServerFromDisk,
  emptyMcpStatusSnapshot,
  listDesktopMcpServersFromDisk,
} from './mcp-config.js';
import {
  archiveBeforeLastUser,
  cloneArchiveHistory,
  cloneArchiveSubagentSessions,
  cloneChatArchive,
  cloneDesktopConfig,
  currentApiBase,
  mapPendingQuestions,
  parseGeneratedCommitMessageResponse,
  parseGeneratedWorktreeNamingResponse,
  sameDreamCollectorSnapshot,
  resolveWorkspaceBindingForRequestedRoot,
  sameWorkspaceRoot,
  toRuntimeAskQuestionsResult,
} from './service-utils.js';
import { DesktopConversationSnapshotView } from './conversation-snapshot.js';
import { buildDesktopSnapshot } from './snapshot.js';
import {
  applyToolCallSummaryCopy,
  displayTitleForTool,
  messageOrderDebugLevel,
  messageIndexIsInCurrentTurn,
  hasActiveRunSubagentToolInMessages,
  isSubagentStatusSurfaceMessage,
  parsePendingSubagentStatusText,
  restoreMessagesFromArchive,
  stripReasonLineFromShellPrompt,
  summarizeMessagesTailForOrderDebug,
  summarizeToolRowsForDebug,
  toolMessageKey,
  truncateOneLineForDebug,
} from './message-ordering.js';
import { DesktopAssistantMessageStateMachine } from './assistant-message-state.js';
import {
  DesktopRuntimeEventOrchestrator,
  runtimeEventsIncludeAppliedFinishTaskPreview,
  splitRuntimeEventsForIncrementalFinishTaskPreview,
} from './runtime-event-orchestrator.js';
import {
  extractSubagentSessionStreamingText,
  findRunSubagentToolPhase,
} from './subagent-stream-sync.js';
import {
  DesktopMessageTimeline,
  type DesktopTimelineSegmentKind,
  type DesktopTimelineTurnSnapshot,
} from './message-timeline.js';
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
  checkoutWorkspaceGitBranch,
  commitWorkspaceChanges,
  createWorkspaceGitWorktree,
  mergeWorktreeBranchToMain,
  readPrimaryRepoRoot,
  readWorkspaceGitSnapshot,
} from './git.js';
import { buildWorktreeNamingPrompt } from './worktree-naming.js';
import { SessionRegistry } from './session-registry.js';
import type { SessionBundle } from './session-bundle.js';
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
  setLoopEnabled: { enabled: boolean };
  setApprovalLevel: { approvalLevel: ApprovalLevel };
  setPendingGitBranch: { branch: string };
  setWorkLocation: { workLocation: WorkLocationKind };
  checkoutGitBranch: CheckoutGitBranchRequest;
  mergeWorktreeToMain: undefined;
  setWebHostAuthTokenHash: { authTokenHash: string };
  addModel: { request: AddModelRequest };
  addProviderModels: { request: AddProviderModelsRequest };
  previewModels: { request: PreviewModelsRequest };
  removeModel: { request: RemoveModelRequest };
  removeProviderModels: { request: RemoveProviderModelsRequest };
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
  submitStartImplementing: undefined;
  exportSessionLog: undefined;
  compactHistory: undefined;
  submitUserTurn: SubmitUserTurnRequest;
  abortConversation: undefined;
  continueAssistantCompletion: { messageId: number };
  poll: undefined;
  listDreamsOverview: undefined;
  replyPendingApproval: { decision: DesktopApprovalDecision };
  replyPendingQuestions: { result: AskQuestionsResult };
  resetSession: undefined;
  listSessions: undefined;
  openSession: { path: string };
  listWorkspaceFileReferenceSuggestions: { request: QueryWorkspaceFileReferenceSuggestionsRequest };
  listWorkspaceExplorerChildren: { relativePath: string };
  readWorkspaceTextFile: { relativePath: string };
  writeWorkspaceTextFile: { request: WriteWorkspaceTextFileRequest };
  rewindAndSubmitMessage: { request: RewindAndSubmitMessageRequest };
};

interface HostState {
  workspaceRoot: string;
  workspaceBinding: DesktopWorkspaceBinding;
  config: DesktopConfigFile;
  git: DesktopGitSnapshot;
  metadata: HostMetadataSummary;
  plan: PlanSnapshot;
  extensionsList: DesktopExtensionListItem[];
  extensionCss: DesktopExtensionCssLayer[];
  ephemeralSessions: EphemeralSessionRecord[];
}

function defaultDisplayTextForUserTurn(
  text: string,
  explicitWorkspaceFiles: readonly PendingWorkspaceFile[],
): string {
  const trimmed = text.trim();
  if (trimmed) {
    return trimmed;
  }

  if (explicitWorkspaceFiles.length === 0) {
    return '';
  }

  return i18n.t('error.attachedFiles', { files: explicitWorkspaceFiles.map((file) => path.basename(file.path)).join(', ') });
}

function pendingWorkspaceFilesToAttachmentSnapshots(
  files: readonly PendingWorkspaceFile[],
): ConversationLocalFileAttachmentSnapshot[] {
  return files.map((file) => ({
    path: file.path,
    name: path.basename(file.path),
    isImage: file.kind === 'image',
  }));
}

function normalizeFsPath(value: string): string {
  return path.normalize(value).replace(/\\/g, '/').toLowerCase();
}

function sameFsPath(left: string, right: string): boolean {
  return normalizeFsPath(left) === normalizeFsPath(right);
}

async function loadDesktopPlanSnapshot(planPath: string, existsHint?: boolean): Promise<PlanSnapshot> {
  try {
    const stat = await lstat(planPath);
    if (!stat.isFile()) {
      return {
        path: planPath,
        exists: false,
      };
    }

    const content = await readFile(planPath, 'utf8');
    return {
      path: planPath,
      exists: true,
      content,
      modifiedAtUnixMs: stat.mtimeMs,
    };
  } catch {
    return {
      path: planPath,
      exists: existsHint === true ? false : false,
    };
  }
}

class DesktopHostService {
  private runtimeTransport: SpiritLlmTransport = createLlmTransport();
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
  private readonly sessionRegistry = new SessionRegistry();
  /** Active bundle runtime mirror for legacy call sites; use `bundle.runtime` in session ticks. */
  private runtime: DesktopRuntime | undefined;
  private toolExecutor: DesktopToolExecutor | undefined;
  private initialized = false;
  private lastRuntimeError = '';
  private activeApiKeyConfigured = false;
  private modelKeyPresence: Record<string, boolean> = {};
  private readonly bundleOrchestrations = new WeakMap<
    SessionBundle,
    {
      assistantMessages: DesktopAssistantMessageStateMachine;
      runtimeEvents: DesktopRuntimeEventOrchestrator;
      conversationSnapshotView: DesktopConversationSnapshotView;
    }
  >();
  private serialized = Promise.resolve();
  private dreamCollectorStatus: DesktopDreamCollectorSnapshot = emptyDreamCollectorSnapshot('disabled');
  private dreamCollectorRunning = false;
  private dreamCollectorLastTickUnixMs = 0;
  private dreamCollectorMonitorTimer: ReturnType<typeof setInterval> | undefined;
  private readonly dreamUpdateListeners = new Set<(snapshot: DesktopSnapshot) => void>();
  private readonly todoClearingBySession = new Map<
    string,
    {
      untilUnixMs: number;
      items: HostTodoRecord[];
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private lastToolSnapshotLogSignature: string | undefined;
  /** One MCP catalog per workspace — survives per-session DesktopToolExecutor rebuilds. */
  private readonly mcpServiceByWorkspaceRoot = new Map<string, McpService>();

  private orchestrationFor(bundle: SessionBundle): {
    assistantMessages: DesktopAssistantMessageStateMachine;
    runtimeEvents: DesktopRuntimeEventOrchestrator;
    conversationSnapshotView: DesktopConversationSnapshotView;
  } {
    let existing = this.bundleOrchestrations.get(bundle);
    if (existing) {
      return existing;
    }
    existing = this.createBundleOrchestration(bundle);
    this.bundleOrchestrations.set(bundle, existing);
    return existing;
  }

  private activeOrchestration() {
    return this.orchestrationFor(this.activeBundle());
  }

  private createBundleOrchestration(bundle: SessionBundle): {
    assistantMessages: DesktopAssistantMessageStateMachine;
    runtimeEvents: DesktopRuntimeEventOrchestrator;
    conversationSnapshotView: DesktopConversationSnapshotView;
  } {
    const allocateMessageId = () => {
      const next = bundle.messageIdCounter;
      bundle.messageIdCounter += 1;
      return next;
    };
    const conversationSnapshotView = new DesktopConversationSnapshotView(allocateMessageId);
    const assistantMessages = new DesktopAssistantMessageStateMachine({
      messages: () => bundle.messages,
      setMessages: (messages) => {
        bundle.messages = messages;
      },
      allocateMessageId,
      isRuntimeBusy: () => bundle.runtime?.isBusy() ?? false,
    });
    const runtimeEvents = new DesktopRuntimeEventOrchestrator({
      runtime: () => bundle.runtime,
      messages: () => bundle.messages,
      allocateMessageId,
      assistantMessages,
      messageTimeline: () => bundle.messageTimeline,
      takeNextAssistantSegmentKind: () => this.takeNextTimelineAssistantSegmentKind(bundle),
      conversationSnapshotView,
      clearCurrentTurnSkills: () => {
        bundle.currentTurnSkills = [];
      },
      setLastRuntimeError: (error) => {
        this.lastRuntimeError = error;
      },
      refreshArchiveFromRuntime: () => this.refreshArchiveFromRuntime(bundle),
      dispatchExtensionEvent: (event) => {
        void this.dispatchExtensionEvent(event);
      },
      bindFileChangesToToolMessage: (execution, messageId) => {
        this.bindFileChangesToToolMessage(bundle, execution, messageId);
      },
      onTodoStoreMutated: () => {
        void this.runSerialized(async () => {
          await this.refreshTodoSnapshotForBundle(bundle);
          if (bundle.id === this.sessionRegistry.activeSessionId()) {
            this.emitLiveSnapshotUpdate();
          }
        });
      },
      requestLiveSnapshotUpdate: () => {
        if (bundle.id === this.sessionRegistry.activeSessionId()) {
          this.emitLiveSnapshotUpdate();
        }
      },
    });
    return { assistantMessages, runtimeEvents, conversationSnapshotView };
  }

  private syncActiveRuntimePointer(): void {
    this.runtime = this.sessionRegistry.getActive()?.runtime;
  }

  async bootstrap(request?: BootstrapRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(request?.workspaceRoot, {
        workspaceBinding: request?.workspaceBinding,
        ...(request?.workspaceBinding === 'none' ? { preserveRecentWorkspaces: true } : {}),
      });
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
        throw new Error(i18n.t('error.workspacePathRequired'));
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
        throw new Error(i18n.t('error.runtimeBusy'));
      }

      const state = this.requireState();
      if (!state.git.isRepository) {
        throw new Error(i18n.t('error.notGitRepo'));
      }
      if (!state.git.hasChanges) {
        throw new Error(i18n.t('error.noChangesToCommit'));
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
      const prevImageGenerationModel = state.config.imageGenerationModel;
      const prevApiBase = currentApiBase(state.config);
      const prevPlanMode = state.config.planMode === true;

      if (this.runtime?.isBusy() && Boolean(request.apiKey?.trim())) {
        throw new Error(i18n.t('error.runtimeBusy'));
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
            ...(existing.transportKind ? { transportKind: existing.transportKind } : {}),
            ...(existing.supportedReasoningEfforts !== undefined
              ? { supportedEfforts: existing.supportedReasoningEfforts }
              : {}),
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
      if (request.imageGenerationModel !== undefined) {
        const imageGenerationModel = request.imageGenerationModel.trim();
        if (!imageGenerationModel) {
          delete state.config.imageGenerationModel;
        } else {
          const imageProfile = state.config.models.find((model) => model.name === imageGenerationModel);
          if (!imageProfile) {
            throw new Error(i18n.t('error.imageGenModelNotFound', { model: imageGenerationModel }));
          }
          if (!supportsImageGeneration(imageProfile)) {
            throw new Error(i18n.t('error.modelNoImageGenCapability', { model: imageGenerationModel }));
          }
          state.config.imageGenerationModel = imageProfile.name;
        }
      }
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
      const imageGenerationModelChanged = state.config.imageGenerationModel !== prevImageGenerationModel;

      if (planModeNow !== prevPlanMode) {
        state.metadata = await loadHostMetadata(state.workspaceRoot, planModeNow, {
          activePlanPath: this.activeBundle().activePlanPath,
          workspaceBinding: state.workspaceBinding,
        });
      }

      const transportOrPlanChanged =
        planModeNow !== prevPlanMode || modelOrEndpointChanged || imageGenerationModelChanged;
      const deferRuntimeRefresh =
        wasBusy &&
        transportOrPlanChanged &&
        !Boolean(request.apiKey?.trim());

      if (deferRuntimeRefresh) {
        this.activeBundle().deferredRuntimeRefreshWhileBusy = true;
      } else {
        this.activeBundle().deferredRuntimeRefreshWhileBusy = false;
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
    const provider = parseModelProviderId(request.provider);
    const transportKind = resolveDesktopTransportKind({
      provider,
      transportKind: request.transportKind,
    });
    const apiBaseRaw = request.apiBase.trim();
    const apiBase = apiBaseRaw || defaultApiBaseForTransport(provider, transportKind);
    const apiKey = request.apiKey.trim();
    if (!apiKey) {
      throw new Error(i18n.t('error.apiKeyRequired'));
    }
    const result = await loadPreviewModelsForTransport({
      provider,
      transportKind,
      apiBase,
      apiKey,
      forceRefresh: request.forceRefresh === true,
    });
    return {
      modelIds: result.modelIds,
      ...(result.modelCatalog ? { models: result.modelCatalog } : {}),
      fromCache: result.fromCache,
    };
  }

  async addProviderModels(request: AddProviderModelsRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const state = this.requireState();

      if (this.runtime?.isBusy()) {
        throw new Error(i18n.t('error.runtimeBusy'));
      }

      const provider = parseModelProviderId(request.provider);
      const transportKind = resolveDesktopTransportKind({
        provider,
        transportKind: request.transportKind,
      });
      const apiBaseRaw = request.apiBase.trim();
      const apiBase = apiBaseRaw || defaultApiBaseForTransport(provider, transportKind);
      const apiKey = request.apiKey.trim();
      if (!apiKey) {
        throw new Error(i18n.t('error.apiKeyRequired'));
      }

      const rawIds = request.modelIds.map((id) => id.trim()).filter((id) => id.length > 0);
      const uniqueIds = [...new Set(rawIds)];
      if (uniqueIds.length === 0) {
        throw new Error(i18n.t('error.emptyModelList'));
      }

      type NewProfile = {
        name: string;
        apiBase: string;
        reasoningEffort: ModelReasoningEffort;
        supportedReasoningEfforts?: DesktopModelReasoningEffort[];
        capabilities?: DesktopModelCapability[];
        provider?: DesktopModelProvider;
        transportKind?: DesktopTransportKind;
      };
      const catalogEntries = previewCatalogMapForAddProviderRequest(request, provider, transportKind);
      const toAdd: NewProfile[] = [];
      for (const name of uniqueIds) {
        if (state.config.models.some((model) => model.name === name)) {
          continue;
        }
        const catalogEntry = catalogEntries.get(name);
        const profile: NewProfile = {
          name,
          apiBase,
          reasoningEffort: defaultModelReasoningEffort({
            ...(reasoningProviderForTransport(provider, transportKind)
              ? { provider: reasoningProviderForTransport(provider, transportKind) }
              : {}),
            model: name,
            ...(catalogEntry?.supportedReasoningEfforts !== undefined
              ? { supportedEfforts: catalogEntry.supportedReasoningEfforts }
              : {}),
          }),
        };
        if (catalogEntry?.supportedReasoningEfforts !== undefined) {
          profile.supportedReasoningEfforts = catalogEntry.supportedReasoningEfforts;
        }
        if (catalogEntry?.capabilities) {
          profile.capabilities = catalogEntry.capabilities;
        }
        if (provider !== undefined) {
          profile.provider = provider;
          if (transportKind === 'anthropic' || transportKind === 'open-responses') {
            profile.transportKind = transportKind;
          }
        }
        toAdd.push(profile);
      }

      if (toAdd.length === 0) {
        throw new Error(i18n.t('error.modelsAlreadyExist'));
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
        throw new Error(i18n.t('error.runtimeBusy'));
      }

      const name = request.name.trim();
      const provider = parseModelProviderId(request.provider);
      const transportKind = resolveDesktopTransportKind({
        provider,
        transportKind: request.transportKind,
      });
      const apiBaseRaw = request.apiBase.trim();
      const apiBase = apiBaseRaw || defaultApiBaseForTransport(provider, transportKind);
      const apiKey = request.apiKey.trim();

      if (!name) {
        throw new Error(i18n.t('error.modelNameRequired'));
      }
      if (!apiKey) {
        throw new Error(i18n.t('error.apiKeyRequired'));
      }
      if (state.config.models.some((model) => model.name === name)) {
        throw new Error(i18n.t('error.modelExists', { name }));
      }

      const catalogEntry = await findCatalogEntryForModel({
        provider,
        transportKind,
        apiBase,
        apiKey,
        model: name,
      });
      const requestedCapabilities = normalizeModelCapabilities(request.capabilities);

      const profile: {
        name: string;
        apiBase: string;
        reasoningEffort: ModelReasoningEffort;
        supportedReasoningEfforts?: DesktopModelReasoningEffort[];
        provider?: DesktopModelProvider;
        transportKind?: DesktopTransportKind;
        capabilities?: DesktopModelCapability[];
      } = {
        name,
        apiBase,
        reasoningEffort: defaultModelReasoningEffort({
          ...(reasoningProviderForTransport(provider, transportKind)
            ? { provider: reasoningProviderForTransport(provider, transportKind) }
            : {}),
          model: name,
          ...(catalogEntry?.supportedReasoningEfforts !== undefined
            ? { supportedEfforts: catalogEntry.supportedReasoningEfforts }
            : {}),
        }),
      };
      if (catalogEntry?.supportedReasoningEfforts !== undefined) {
        profile.supportedReasoningEfforts = catalogEntry.supportedReasoningEfforts;
      }
      if (provider !== undefined) {
        profile.provider = provider;
        if (transportKind === 'anthropic' || transportKind === 'open-responses') {
          profile.transportKind = transportKind;
        }
      }
      const capabilities = resolveAddedModelCapabilities({
        provider,
        requestedCapabilities,
        catalogEntry,
      });
      if (capabilities) {
        profile.capabilities = capabilities;
      }
      state.config.models.push(profile);
      state.config.activeModel = name;
      if (!state.config.imageGenerationModel && supportsImageGeneration(profile)) {
        state.config.imageGenerationModel = name;
      }
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
        throw new Error(i18n.t('error.modelNameRequired'));
      }
      if (name === state.config.activeModel) {
        throw new Error(i18n.t('error.cannotDeleteActiveModel'));
      }

      const before = state.config.models.length;
      state.config.models = state.config.models.filter((model) => model.name !== name);
      if (state.config.models.length === before) {
        throw new Error(i18n.t('error.modelNotFound', { name }));
      }

      return this.finalizeModelRemoval(state, [name]);
    });
  }

  async removeProviderModels(request: RemoveProviderModelsRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const state = this.requireState();

      const provider = parsePresetModelProviderId(request.provider);
      if (!provider) {
        throw new Error(i18n.t('error.providerDeleteOnly'));
      }

      const { matched: targets, unmatched } = partitionModelsByProvider(state.config.models, provider);
      if (targets.length === 0) {
        throw new Error(i18n.t('error.noModelsInProvider'));
      }

      const active = state.config.activeModel;
      const hasActive = targets.some((model) => model.name === active);
      if (hasActive) {
        throw new Error(i18n.t('error.cannotDeleteProviderWithActive'));
      }

      const namesToRemove = targets.map((model) => model.name);
      state.config.models = unmatched;
      return this.finalizeModelRemoval(state, namesToRemove);
    });
  }

  private async finalizeModelRemoval(
    state: HostState,
    namesToRemove: readonly string[],
  ): Promise<DesktopSnapshot> {
    if (state.config.imageGenerationModel && namesToRemove.includes(state.config.imageGenerationModel)) {
      delete state.config.imageGenerationModel;
    }
    await saveConfig(state.config);
    for (const name of namesToRemove) {
      await removeModelApiKey(name);
    }
    await this.refreshModelKeyPresence();
    await this.persistCurrentSessionIfNeeded();
    return this.buildSnapshot();
  }

  async createSkill(request: CreateSkillRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      if (this.runtime?.isBusy()) {
        throw new Error(i18n.t('error.runtimeBusySkill'));
      }
      const state = this.requireState();
      const rootKind = request.rootKind ?? 'workspaceSpirit';
      if (
        state.workspaceBinding === 'none'
        && (rootKind === 'workspaceSpirit' || rootKind === 'workspaceAgents')
      ) {
        throw new Error(
          'Workspace-scoped skills are unavailable when workspace binding is disabled.',
        );
      }
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
      const state = this.requireState();

      const name = request.name.trim();
      if (!name) {
        throw new Error(i18n.t('error.mcpNameRequired'));
      }
      if (/\s/u.test(name)) {
        throw new Error(i18n.t('error.mcpNameWhitespace'));
      }

      const endpoint = request.endpoint.trim();
      if (!endpoint) {
        throw new Error(request.transportType === 'http' ? i18n.t('error.urlRequired') : i18n.t('error.commandRequired'));
      }

      const scope = request.scope ?? 'workspace';
      if (scope === 'workspace' && state.workspaceBinding === 'none') {
        throw new Error(
          'Workspace-scoped MCP servers are unavailable when workspace binding is disabled.',
        );
      }
      const serverConfig = buildMcpServerConfigFromRequest({ ...request, scope });
      await addMcpServerToDisk(scope, state.workspaceRoot, name, serverConfig);
      if (scope === 'user') {
        invalidateSharedUserMcpToolingCache();
      }
      this.sharedMcpServiceForWorkspace(state.workspaceRoot, state.workspaceBinding)
        .startBackgroundRefreshInBackground(true);
      this.toolExecutor?.startMcpBackgroundRefresh();
      return this.buildSnapshot();
    });
  }

  async deleteMcpServer(request: DeleteMcpServerRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const state = this.requireState();

      const name = request.name.trim();
      if (!name) {
        throw new Error(i18n.t('error.mcpNameRequired'));
      }

      const scope = request.scope ?? 'user';
      await deleteMcpServerFromDisk(scope, state.workspaceRoot, name);
      if (scope === 'user') {
        invalidateSharedUserMcpToolingCache();
      }
      this.sharedMcpServiceForWorkspace(state.workspaceRoot, state.workspaceBinding)
        .startBackgroundRefreshInBackground(true);
      this.toolExecutor?.startMcpBackgroundRefresh();
      return this.buildSnapshot();
    });
  }

  async inspectMcpServer(name: string): Promise<DesktopMcpServerInspection> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error(i18n.t('error.mcpNameRequired'));
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
        throw new Error(i18n.t('error.extensionZipRequired'));
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
        throw new Error(i18n.t('error.extensionIdRequired'));
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
        throw new Error(i18n.t('error.extensionIdRequired'));
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
        throw new Error(i18n.t('error.extensionIdRequired'));
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
        throw new Error(i18n.t('error.extensionIdRequired'));
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
        throw new Error(i18n.t('error.extensionIdRequired'));
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
        throw new Error(i18n.t('error.extensionIdRequired'));
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
        throw new Error(i18n.t('error.extensionIdRequired'));
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
        throw new Error(i18n.t('error.extensionIdRequired'));
      }
      if (!key) {
        throw new Error(i18n.t('error.secretKeyRequired'));
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
        throw new Error(i18n.t('error.runtimeBusyDeleteSkill'));
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
        throw new Error(i18n.t('error.runtimeBusy'));
      }

      const skillName = request.skillName.trim();
      if (!skillName) {
        throw new Error(i18n.t('error.skillNameRequired'));
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
        throw new Error(i18n.t('error.runtimeBusy'));
      }

      const rawText = request.rawText.trim();
      if (!rawText) {
        throw new Error(i18n.t('error.messageRequired'));
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

  async submitStartImplementing(): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const runtime = this.requireRuntime();
      if (runtime.isBusy()) {
        throw new Error(i18n.t('error.runtimeBusy'));
      }

      const state = this.requireState();
      const bundle = this.activeBundle();
      return this.submitUserTurnAfterInitialized(
        buildStartImplementingUserTurn(
          {
            workspaceRoot: state.workspaceRoot,
            spiritDataDir: spiritAgentDataDir(),
          },
          bundle.activePlanPath,
        ),
        {
          displayText: i18n.t('workspace.startImplementing'),
        },
      );
    });
  }

  async compactHistory(): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const runtime = this.requireRuntime();
      if (this.activeBundle().activeSession?.readOnly) {
        throw new Error(i18n.t('error.readonlySessionCompact'));
      }
      if (runtime.currentPendingApproval() || runtime.currentPendingQuestions()) {
        throw new Error(i18n.t('error.pendingApprovalCompact'));
      }
      if (runtime.isBusy()) {
        throw new Error(i18n.t('error.runtimeBusy'));
      }

      // Match CLI `/compact`: start async compaction and let poll() stream aux updates.
      await runtime.startManualHistoryCompaction();
      try {
        await runtime.poll();
        this.activeOrchestration().runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
      } catch (error) {
        runtime.abort();
        this.activeBundle().messageTimeline.abortActiveAssistantSegment();
        this.activeOrchestration().runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
        throw error;
      }

      this.activeOrchestration().runtimeEvents.consumeCompletedTurnResult();
      this.activeOrchestration().runtimeEvents.syncPendingToolStates();
      this.activeOrchestration().runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
      await this.flushDeferredRuntimeRefreshIfIdle();
      return this.buildSnapshot();
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
      const activeSkillsSystemPrompt = buildActiveSkillsSystemMessage(this.activeBundle().currentTurnSkills);
      const extensionsSystemPrompt = buildExtensionsSystemMessage(extensionSystemPrompts);
      const dreamsSystemPrompt = buildDreamsSystemMessage(
        await buildDreamContextText({
          workspaceRoot: state.workspaceRoot,
          gitBranch: state.git.branch,
        }),
      );
      const basicInfoSystemPrompt = buildBasicInfoSystemMessage(
        this.buildRuntimeBasicInfo(state.workspaceRoot, this.requireToolExecutor()),
      );
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
          ...(this.runtimeTransport.llmSystemPromptsForExport() as Record<string, unknown>),
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
          ...(dreamsSystemPrompt === undefined ? {} : { dreams: dreamsSystemPrompt }),
          ...(basicInfoSystemPrompt === undefined ? {} : { basicInfo: basicInfoSystemPrompt }),
        },
        note: i18n.t('error.logSessionNote'),
        message_count: runtime.history().length,
        messages: this.runtimeTransport.llmHistoryAsApiMessages([...runtime.history()]),
        api_request_trace_count: runtime.requestTrace().length,
        api_request_trace: [...runtime.requestTrace()],
      };

      await writeFile(filePath, `${JSON.stringify(exportPayload, null, 2)}\n`, 'utf8');

      const snapshot = await this.appendInlineAssistantReply(
        '/log-session',
        [
          i18n.t('error.logSessionExported'),
          filePath,
        ].join('\n'),
      );

      return {
        snapshot,
        path: filePath,
      };
    });
  }

  async submitUserTurn(request: SubmitUserTurnRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const trimmed = request.text.trim();
      const bundle = this.activeBundle();
      const hasLocalFiles = Array.isArray(request.localFilePaths) && request.localFilePaths.length > 0;
      if (!trimmed && !hasLocalFiles) {
        throw new Error(i18n.t('error.messageRequired'));
      }

      const isFirstTurn = bundle.messages.length === 0;
      if (isFirstTurn && bundle.workLocation === 'worktree') {
        await this.bootstrapWorktreeForFirstTurn(trimmed);
      }

      return this.submitUserTurnAfterInitialized(request.text, {
        explicitWorkspaceFiles: await this.resolveExplicitLocalFileAttachments(request.localFilePaths),
      });
    });
  }

  async setLoopEnabled(enabled: boolean): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const state = this.requireState();
      const bundle = this.activeBundle();
      bundle.loopEnabled = enabled;
      const toolExecutor = await this.ensureToolExecutor(bundle);
      toolExecutor.setLoopToolExposure(enabled);
      this.runtime?.setLoopEnabled(enabled);
      await this.persistCurrentSessionIfNeeded();
      return this.buildSnapshot();
    });
  }

  async setApprovalLevel(approvalLevel: ApprovalLevel): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const normalized = normalizeApprovalLevel(approvalLevel);
      const bundle = this.activeBundle();
      bundle.approvalLevel = normalized;
      const toolExecutor = await this.ensureToolExecutor(bundle);
      toolExecutor.setApprovalLevel(normalized);
      await this.persistCurrentSessionIfNeeded();
      return this.buildSnapshot();
    });
  }

  async setPendingGitBranch(branch: string): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const state = this.requireState();
      const normalized = branch.trim();
      if (!state.git.isRepository) {
        throw new Error(i18n.t('error.notGitRepo'));
      }
      if (!normalized) {
        throw new Error(i18n.t('error.branchNameRequired'));
      }
      if (!state.git.branches.includes(normalized)) {
        throw new Error(i18n.t('error.branchNotFound', { branch: normalized }));
      }
      this.activeBundle().pendingGitBranch = normalized;
      return this.buildSnapshot();
    });
  }

  async setWorkLocation(workLocation: WorkLocationKind): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      this.activeBundle().workLocation = normalizeWorkLocationKind(workLocation);
      return this.buildSnapshot();
    });
  }

  async checkoutGitBranch(request: CheckoutGitBranchRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      if (this.runtime?.isBusy()) {
        throw new Error(i18n.t('error.runtimeBusy'));
      }

      const state = this.requireState();
      const normalized = request.branch.trim();
      if (!state.git.isRepository) {
        throw new Error(i18n.t('error.notGitRepo'));
      }
      if (!normalized) {
        throw new Error(i18n.t('error.branchNameRequired'));
      }
      if (!state.git.branches.includes(normalized)) {
        throw new Error(i18n.t('error.branchNotFound', { branch: normalized }));
      }

      state.git = await checkoutWorkspaceGitBranch(state.workspaceRoot, normalized, {
        discardLocalChanges: request.discardLocalChanges === true,
      });
      this.activeBundle().pendingGitBranch = undefined;
      await this.refreshRuntimeForBundle(this.activeBundle());
      this.syncActiveRuntimePointer();
      this.startDreamCollectorIfNeeded();
      return this.buildSnapshot();
    });
  }

  async mergeWorktreeToMain(): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      if (this.runtime?.isBusy()) {
        throw new Error(i18n.t('error.runtimeBusy'));
      }

      const state = this.requireState();
      const git = state.git;
      if (!git.isWorktreeSession || !git.primaryRepoRoot || !git.worktreeBranch) {
        throw new Error(i18n.t('error.notInWorktree'));
      }

      await mergeWorktreeBranchToMain(git.primaryRepoRoot, git.worktreeBranch);
      state.git = await readWorkspaceGitSnapshot(state.workspaceRoot);
      return this.buildSnapshot();
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
      this.activeBundle().messageTimeline.abortActiveAssistantSegment();
      this.activeBundle().currentTurnSkills = [];
      this.activeOrchestration().runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
      this.activeOrchestration().runtimeEvents.consumeCompletedTurnResult();
      this.activeOrchestration().runtimeEvents.syncPendingToolStates();
      this.activeOrchestration().runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
      this.markInterruptedToolsInCurrentTurn();
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
        throw new Error(i18n.t('error.runtimeBusy'));
      }
      if (!Number.isFinite(messageId)) {
        throw new Error(i18n.t('error.invalidMessageId'));
      }

      const state = this.requireState();
      if (this.activeBundle().activeSession?.readOnly) {
        throw new Error(i18n.t('error.readonlySessionContinue'));
      }

      await this.ensureToolExecutor();

      const continuable = this.latestContinuableAssistantMessage();
      if (!continuable || continuable.id !== messageId) {
        throw new Error(i18n.t('error.messageNotContinuable'));
      }

      const previousContinuationIds = this.activeBundle().messages
        .filter((message) => message.canContinue === true)
        .map((message) => message.id);
      try {
        this.clearAssistantContinuationMarkers();
        this.resetStreamingPlacementState(false);
        await this.persistCurrentSessionIfNeeded();
        this.activeBundle().nextTimelineAssistantSegmentKind = 'continuation';
        await runtime.continueAssistantCompletionStreaming();
      } catch (error) {
        this.activeBundle().nextTimelineAssistantSegmentKind = 'initial';
        for (const message of this.activeBundle().messages) {
          if (previousContinuationIds.includes(message.id)) {
            message.canContinue = true;
          }
        }
        throw error;
      }
      this.refreshArchiveFromRuntime();
      await runtime.poll();
      this.activeOrchestration().runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
      this.activeOrchestration().runtimeEvents.consumeCompletedTurnResult();
      this.activeOrchestration().runtimeEvents.syncPendingToolStates();
      this.activeOrchestration().runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
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
        throw new Error(i18n.t('error.runtimeBusy'));
      }
      if (!Number.isFinite(request.messageId)) {
        throw new Error(i18n.t('error.invalidMessageId'));
      }

      const checkpoint = this.activeBundle().rewind.checkpoints.find(
        (candidate) => candidate.messageId === request.messageId,
      );
      if (!checkpoint) {
        throw new Error(i18n.t('error.noCheckpoint'));
      }

      const snapshot = await loadRewindCheckpointSnapshot(
        spiritAgentDataDir(),
        this.activeBundle().rewind.sessionId,
        checkpoint.id,
      );
      if (!snapshot) {
        throw new Error(i18n.t('error.checkpointFileMissing'));
      }

      const changesToRestore = this.activeBundle().rewind.fileChanges
        .filter((change) => change.sequence > checkpoint.sequence)
        .sort((left, right) => left.sequence - right.sequence);
      const loadedChanges: HostRecordedFileChange[] = [];
      const missingWarnings: FileRewindWarning[] = [];
      for (const metadata of changesToRestore) {
        const stored = await loadRewindFileChange(
          spiritAgentDataDir(),
          this.activeBundle().rewind.sessionId,
          metadata.id,
        );
        if (stored) {
          loadedChanges.push(stored);
        } else {
          missingWarnings.push({
            changeId: metadata.id,
            path: metadata.resolvedPath,
            action: metadata.kind,
            message: i18n.t('error.fileChangeSnapshotMissing'),
          });
        }
      }

      const restoreResult = await restoreHostFileChanges(loadedChanges);
      this.activeBundle().rewindWarnings = [
        ...missingWarnings,
        ...restoreResult.warnings.map((warning) => ({ ...warning })),
      ];

      this.restoreBeforeRewindCheckpoint(snapshot, checkpoint.sequence);
      await this.applyTodosAfterRewind(snapshot);
      return this.submitUserTurnAfterInitialized(request.text, {
        preserveRewindWarnings: true,
        explicitWorkspaceFiles: await this.resolveExplicitLocalFileAttachments(request.localFilePaths),
      });
    });
  }

  private async submitUserTurnAfterInitialized(
    text: string,
    options: {
      preserveRewindWarnings?: boolean;
      displayText?: string;
      turnSkills?: LlmActiveSkill[];
      explicitWorkspaceFiles?: PendingWorkspaceFile[];
    } = {},
  ): Promise<DesktopSnapshot> {
    const bundle = this.activeBundle();
    if (!bundle.runtime) {
      await this.refreshRuntimeForBundle(bundle);
      this.syncActiveRuntimePointer();
    }
    const trimmed = text.trim();
    const explicitWorkspaceFiles = options.explicitWorkspaceFiles ?? [];
    const displayText = (options.displayText ?? defaultDisplayTextForUserTurn(text, explicitWorkspaceFiles)).trim();
    if (!trimmed && explicitWorkspaceFiles.length === 0) {
      throw new Error(i18n.t('error.messageRequired'));
    }
    if (!displayText) {
      throw new Error(i18n.t('error.messageRequired'));
    }

    const state = this.requireState();
    if (this.activeBundle().activeSession?.readOnly) {
      throw new Error(i18n.t('error.readonlySessionSend'));
    }
    if (!options.preserveRewindWarnings) {
      this.activeBundle().rewindWarnings = [];
    }
    this.clearAssistantContinuationMarkers();
    bundle.currentTurnSkills = cloneActiveSkills(options.turnSkills ?? []);
    const todoSessionKeyBeforeEnsure = this.resolveTodoSessionKeyForBundle(bundle);
    this.ensureActiveSession(displayText);
    await this.reconcileTodoScopeAfterSessionPathChange(bundle, todoSessionKeyBeforeEnsure);
    await this.maybeRefreshRuntimeAfterTodoScopeChange(bundle, todoSessionKeyBeforeEnsure);
    const beforeUserCheckpoint = await this.buildRewindCheckpointSnapshot();
    const localFileAttachments =
      explicitWorkspaceFiles.length > 0
        ? pendingWorkspaceFilesToAttachmentSnapshots(explicitWorkspaceFiles)
        : undefined;
    const userMessage: ConversationMessageSnapshot = {
      id: this.allocateMessageId(),
      role: 'user',
      content: displayText,
      pending: false,
      ...(localFileAttachments ? { localFileAttachments } : {}),
    };
    this.activeBundle().messages.push(userMessage);
    this.activeBundle().messageTimeline.beginUserTurn(userMessage.content, {
      messageId: userMessage.id,
      ...(localFileAttachments ? { localFileAttachments } : {}),
    });
    this.resetStreamingPlacementState(false);
    const todoSessionKeyBeforePersist = this.resolveTodoSessionKeyForBundle(bundle);
    await this.persistCurrentSessionIfNeeded();
    await this.reconcileTodoScopeAfterSessionPathChange(bundle, todoSessionKeyBeforePersist);
    await this.maybeRefreshRuntimeAfterTodoScopeChange(bundle, todoSessionKeyBeforePersist);
    await this.dispatchExtensionEvent({
      type: 'onUserMessage',
      detail: {
        text: trimmed,
        displayText,
        messageId: userMessage.id,
      },
    });

    // Re-resolve after promote/persist may have replaced bundle.runtime (todo scope refresh).
    const runtime = this.requireRuntime();
    await this.ensureToolExecutor(bundle);
    try {
      await runtime.startUserTurnStreaming(trimmed, [], explicitWorkspaceFiles);
      this.refreshArchiveFromRuntime();
      await this.recordRewindCheckpoint(userMessage.id, beforeUserCheckpoint);
      await runtime.poll();
      this.activeOrchestration().runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
    } catch (error) {
      this.activeBundle().currentTurnSkills = [];
      this.activeOrchestration().assistantMessages.handleMessageRemoved(this.activeBundle().messages.length - 1, userMessage.id, 'send-user-rollback');
      this.activeBundle().messages.pop();
      this.rebuildMessageTimelineFromMessages();
      throw error;
    }

    this.activeOrchestration().runtimeEvents.consumeCompletedTurnResult();
    this.activeOrchestration().runtimeEvents.syncPendingToolStates();
    this.activeOrchestration().runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
    await this.flushDeferredRuntimeRefreshIfIdle(bundle);
    await this.refreshTodoSnapshotForBundle(bundle);
    if (!runtime.isBusy()) {
      await this.refreshGitState();
    }
    return this.buildSnapshot();
  }

  private async resolveExplicitLocalFileAttachments(
    localFilePaths: readonly string[] | undefined,
  ): Promise<PendingWorkspaceFile[]> {
    if (!Array.isArray(localFilePaths) || localFilePaths.length === 0) {
      return [];
    }

    const attachments: PendingWorkspaceFile[] = [];
    for (const localFilePath of localFilePaths) {
      try {
        attachments.push(await localFileAttachmentFromPath(localFilePath));
      } catch {
        // 与 @ 文件引用保持一致：不存在、不可读或不支持的文件静默忽略。
      }
    }
    return attachments;
  }

  private async appendInlineAssistantReply(
    displayText: string,
    assistantText: string,
  ): Promise<DesktopSnapshot> {
    const state = this.requireState();
    this.activeBundle().rewindWarnings = [];
    this.clearAssistantContinuationMarkers();
    this.ensureActiveSession(displayText);
    const userMessage: ConversationMessageSnapshot = {
      id: this.allocateMessageId(),
      role: 'user',
      content: displayText,
      pending: false,
    };
    this.activeBundle().messages.push(userMessage);
    this.activeBundle().messageTimeline.beginUserTurn(userMessage.content, { messageId: userMessage.id });
    this.resetStreamingPlacementState(false);
    this.activeOrchestration().assistantMessages.appendAssistantMessage(assistantText);
    this.activeBundle().messageTimeline.beginAssistantSegment('initial');
    this.activeBundle().messageTimeline.materializeCompletedAssistantText(assistantText);
    await this.persistCurrentSessionIfNeeded();
    await this.refreshGitState();
    return this.buildSnapshot();
  }

  async poll(): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      for (const bundle of this.sessionRegistry.all()) {
        if (bundle.runtime?.isBusy()) {
          await this.tickSession(bundle);
        }
      }
      const active = this.sessionRegistry.getActive();
      if (active && !active.runtime?.isBusy()) {
        await this.tickSession(active, { light: true });
      }
      this.syncActiveRuntimePointer();
      if (this.sessionRegistry.allBusy((bundle) => bundle.runtime?.isBusy() === true).length === 0) {
        await this.refreshGitState();
      }
      this.startDreamCollectorIfNeeded();
      return this.buildSnapshot();
    });
  }

  private async tickSession(
    bundle: SessionBundle,
    options: { light?: boolean } = {},
  ): Promise<void> {
    const orchestration = this.orchestrationFor(bundle);
    if (bundle.runtime) {
      bundle.runtime.tickThinkingSpinner();
      if (!options.light) {
        await bundle.runtime.poll();
        const drained = bundle.runtime.drainEvents();
        const queued = [...bundle.deferredRuntimeHostEvents, ...drained];
        bundle.deferredRuntimeHostEvents = [];
        const { toApply, deferred } = splitRuntimeEventsForIncrementalFinishTaskPreview(queued);
        bundle.deferredRuntimeHostEvents = deferred;
        orchestration.runtimeEvents.applyRuntimeHostEvents(toApply);
        if (
          runtimeEventsIncludeAppliedFinishTaskPreview(toApply) &&
          bundle.id === this.sessionRegistry.activeSessionId()
        ) {
          this.emitLiveSnapshotUpdate();
        }
      }
    }
    if (options.light) {
      return;
    }
    orchestration.runtimeEvents.consumeCompletedTurnResult();
    orchestration.runtimeEvents.syncPendingToolStates();
    this.syncSubagentToolStreamingOutput(bundle);
    orchestration.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
    await this.persistSessionBundle(bundle, {
      fromRuntime: bundle.runtime,
      bumpListSortAt: false,
    });
    await this.flushDeferredRuntimeRefreshIfIdle(bundle);
    await this.refreshTodoSnapshotForBundle(bundle);
  }

  async replyPendingApproval(decision: DesktopApprovalDecision): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const runtime = this.requireRuntime();
      const pendingApproval = runtime.currentPendingApproval();
      const runtimeDecision = normalizeApprovalDecision(decision);
      if (runtimeDecision.kind === 'guidance' && runtimeDecision.userMessage.trim()) {
        this.insertUserApprovalReplyMessage(
          runtimeDecision.userMessage.trim(),
          pendingApproval ? toolMessageKey(pendingApproval) : undefined,
        );
        this.resetStreamingPlacementState(false);
      }
      await runtime.continuePendingApproval(runtimeDecision);
      this.activeOrchestration().runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
      this.activeOrchestration().runtimeEvents.consumeCompletedTurnResult();
      this.activeOrchestration().runtimeEvents.syncPendingToolStates();
      this.activeOrchestration().runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
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
      this.activeOrchestration().runtimeEvents.applyRuntimeHostEvents(runtime.drainEvents());
      this.activeOrchestration().runtimeEvents.consumeCompletedTurnResult();
      this.activeOrchestration().runtimeEvents.syncPendingToolStates();
      this.activeOrchestration().runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
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
      await this.ensureInitialized(undefined, { fastPath: true });

      const state = this.requireState();
      const leaving = this.sessionRegistry.getActive();
      const leavingMessageCount = leaving?.messageTimeline.toMessages().length ?? 0;
      if (leaving?.activeSession && leavingMessageCount > 0) {
        await this.persistSessionBundle(leaving, {
          fromRuntime: this.sessionRegistry.activeSessionId() === leaving.id ? this.runtime : undefined,
          bumpListSortAt: false,
        });
      }
      const bundle = this.sessionRegistry.beginNewActive(state.workspaceRoot);
      await this.finalizeTodoScopeForNewActiveBundle(bundle, state.workspaceRoot);
      this.resetStreamingPlacementState(true, bundle);
      await this.finishSessionActivation(bundle);
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
      await this.ensureInitialized(undefined, { fastPath: true });
      const state = this.requireState();
      const activeId = this.sessionRegistry.activeSessionId();
      const stored = await listStoredSessions();
      const ephemeral: SessionListItem[] = ephemeralSessionsToListItems(state.ephemeralSessions);
      const merged = [...stored, ...ephemeral].sort((left, right) => right.modifiedAtUnixMs - left.modifiedAtUnixMs);
      return merged.map((item) => {
        const bundle = this.sessionRegistry.get(item.path);
        return {
          ...item,
          ...(bundle?.runtime?.isBusy() ? { isBusy: true } : {}),
          ...(item.path === activeId ? { isActive: true } : {}),
        };
      });
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

  async listWorkspaceFileReferenceSuggestions(
    request: QueryWorkspaceFileReferenceSuggestionsRequest,
  ): Promise<WorkspaceFileReferenceSuggestionsResponse> {
    return this.runSerialized(async () => {
      await this.ensureInitialized();
      const state = this.requireState();
      return (
        (await listWorkspaceFileReferenceSuggestionsFromHostInternal(
          state.workspaceRoot,
          request.input,
          request.cursorChars,
        )) ?? null
      );
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
      const leaving = this.sessionRegistry.getActive();
      const leavingMessageCount = leaving?.messageTimeline.toMessages().length ?? 0;
      if (
        leaving?.activeSession
        && leaving.activeSession.kind !== 'ephemeral'
        && leavingMessageCount > 0
      ) {
        await this.persistSessionBundle(leaving, {
          fromRuntime:
            leaving.runtime?.isBusy() && this.sessionRegistry.activeSessionId() === leaving.id
              ? this.runtime
              : undefined,
          bumpListSortAt: false,
        });
      }

      if (isEphemeralDebugSessionPath(filePath)) {
        const ephemeral = this.findEphemeralSession(filePath);
        if (!ephemeral) {
          throw new Error(i18n.t('error.ephemeralSessionExpired'));
        }
        const ephemeralSameWorkspace = Boolean(
          this.initialized
          && this.state?.workspaceRoot
          && sameWorkspaceRoot(this.state.workspaceRoot, ephemeral.workspaceRoot),
        );
        await this.ensureInitialized(ephemeral.workspaceRoot, {
          preserveRecentWorkspaces: true,
          ...(ephemeralSameWorkspace ? { fastPath: true } : { deferRuntimeRefresh: true }),
        });
        const restored = restoreEphemeralSessionState(ephemeral);
        const bundle = this.sessionRegistry.upsertFromRestored(
          ephemeral.workspaceRoot,
          restored,
          (messages, timelineSnapshot) => this.createMessageTimelineFromMessages(messages, timelineSnapshot),
        );
        await this.finishSessionActivation(bundle);
        this.lastRuntimeError = '';
        return this.buildSnapshot();
      }

      const resolvedPath = path.resolve(filePath);
      const warmBundle = this.sessionRegistry.findBySessionPath(resolvedPath);
      const warmMessageCount = warmBundle?.messageTimeline.toMessages().length ?? 0;
      if (warmBundle?.activeSession && warmMessageCount > 0) {
        await this.ensureInitialized(warmBundle.workspaceRoot, { fastPath: true });
        this.sessionRegistry.activateExisting(warmBundle);
        await this.finishSessionActivation(warmBundle);
        this.lastRuntimeError = '';
        await this.dispatchExtensionEvent({
          type: 'onSessionOpened',
          detail: {
            filePath: resolvedPath,
            displayName: warmBundle.activeSession.displayName,
          },
        });
        return this.buildSnapshot();
      }

      const loaded = await loadStoredSession(filePath);
      const workspaceRoot = loaded.workspaceRoot ?? this.requireState().workspaceRoot;
      const sameWorkspace =
        this.initialized
        && Boolean(this.state?.workspaceRoot)
        && sameWorkspaceRoot(this.state!.workspaceRoot, workspaceRoot);
      await this.ensureInitialized(workspaceRoot, {
        ...(sameWorkspace ? { fastPath: true } : { deferRuntimeRefresh: true }),
        preserveRecentWorkspaces: true,
      });
      const restored = restoreStoredSessionState({
        filePath,
        loaded,
        fallbackMessages: restoreMessagesFromArchive(loaded),
      });
      const bundle = this.sessionRegistry.upsertFromRestored(
        workspaceRoot,
        restored,
        (messages, timelineSnapshot) => this.createMessageTimelineFromMessages(messages, timelineSnapshot),
      );
      bundle.listSortSavedAtUnixMs = loaded.savedAtUnixMs;
      await this.finishSessionActivation(bundle);
      this.lastRuntimeError = '';
      await this.dispatchExtensionEvent({
        type: 'onSessionOpened',
        detail: {
          filePath: path.resolve(filePath),
          displayName: bundle.activeSession!.displayName,
        },
      });
      return this.buildSnapshot();
    });
  }

  private runtimeActivationSignature(bundle: SessionBundle): string {
    const state = this.requireState();
    return JSON.stringify({
      model: state.config.activeModel,
      imageModel: state.config.imageGenerationModel ?? '',
      apiBase: currentApiBase(state.config),
      workspaceRoot: bundle.workspaceRoot || state.workspaceRoot,
      planMode: state.config.planMode === true,
      approvalLevel: bundle.approvalLevel,
      loopEnabled: bundle.loopEnabled,
      todoSessionKey: this.resolveTodoSessionKeyForBundle(bundle),
    });
  }

  private isBundleRuntimeFresh(bundle: SessionBundle): boolean {
    if (!bundle.runtime || bundle.runtime.isBusy() || !bundle.runtimeTransport) {
      return false;
    }
    if (!bundle.runtimeActivationSignature) {
      return false;
    }
    return bundle.runtimeActivationSignature === this.runtimeActivationSignature(bundle);
  }

  /** After registry switch: wire runtime for new loads, resume in-flight runs without resetting timeline. */
  private async finishSessionActivation(bundle: SessionBundle): Promise<void> {
    await this.syncPlanStateForBundle(bundle);
    if (bundle.runtime?.isBusy()) {
      await this.tickSession(bundle);
      this.syncActiveRuntimePointer();
      return;
    }
    this.resetStreamingPlacementState(true, bundle);
    if (this.isBundleRuntimeFresh(bundle)) {
      await this.refreshTodoSnapshotForBundle(bundle);
      await this.flushDeferredRuntimeRefreshIfIdle(bundle);
      this.syncActiveRuntimePointer();
      return;
    }
    await this.ensureToolExecutor(bundle);
    await this.refreshTodoSnapshotForBundle(bundle);
    await this.refreshRuntimeForBundle(bundle);
    await this.flushDeferredRuntimeRefreshIfIdle(bundle);
    this.syncActiveRuntimePointer();
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
      case 'removeProviderModels': {
        const typedPayload = payload as CommandPayloads['removeProviderModels'];
        return this.removeProviderModels(typedPayload.request);
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
      case 'submitStartImplementing':
        return this.submitStartImplementing();
      case 'exportSessionLog':
        return this.exportSessionLog();
      case 'compactHistory':
        return this.compactHistory();
      case 'submitUserTurn': {
        const typedPayload = payload as CommandPayloads['submitUserTurn'];
        return this.submitUserTurn(typedPayload);
      }
      case 'setLoopEnabled': {
        const typedPayload = payload as CommandPayloads['setLoopEnabled'];
        return this.setLoopEnabled(typedPayload.enabled === true);
      }
      case 'setApprovalLevel': {
        const typedPayload = payload as CommandPayloads['setApprovalLevel'];
        return this.setApprovalLevel(typedPayload.approvalLevel);
      }
      case 'setPendingGitBranch': {
        const typedPayload = payload as CommandPayloads['setPendingGitBranch'];
        return this.setPendingGitBranch(typedPayload.branch);
      }
      case 'setWorkLocation': {
        const typedPayload = payload as CommandPayloads['setWorkLocation'];
        return this.setWorkLocation(typedPayload.workLocation);
      }
      case 'checkoutGitBranch': {
        const typedPayload = payload as CommandPayloads['checkoutGitBranch'];
        return this.checkoutGitBranch(typedPayload);
      }
      case 'mergeWorktreeToMain':
        return this.mergeWorktreeToMain();
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
        return this.replyPendingApproval(typedPayload.decision);
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
      case 'listWorkspaceFileReferenceSuggestions': {
        const typedPayload = payload as CommandPayloads['listWorkspaceFileReferenceSuggestions'];
        return this.listWorkspaceFileReferenceSuggestions(typedPayload.request);
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
    options: {
      fastPath?: boolean;
      preserveRecentWorkspaces?: boolean;
      /** Skip global runtime rebuild after workspace switch; caller will activate a session bundle. */
      deferRuntimeRefresh?: boolean;
      workspaceBinding?: DesktopWorkspaceBinding;
    } = {},
  ): Promise<void> {
    const requestedWorkspaceRoot = workspaceRootOverride?.trim()
      ? path.resolve(workspaceRootOverride.trim())
      : undefined;

    const loadedConfig = await loadConfig();
    const previousState = this.state;
    const previousBinding = normalizeWorkspaceBinding(
      previousState?.workspaceBinding ?? loadedConfig.workspaceBinding,
    );
    const workspaceBinding = resolveWorkspaceBindingForRequestedRoot({
      requestedWorkspaceRoot,
      explicitBinding: options.workspaceBinding,
      previousBinding,
      persistedBinding: normalizeWorkspaceBinding(loadedConfig.workspaceBinding),
    });

    const workspaceRoot =
      workspaceBinding === 'none'
        ? resolveDesktopHomeDirectory()
        : requestedWorkspaceRoot
          ?? (previousState?.workspaceBinding === 'project' ? previousState.workspaceRoot : undefined)
          ?? loadedConfig.lastProjectWorkspaceRoot
          ?? loadedConfig.recentWorkspaces?.[0]
          ?? discoverWorkspaceRoot();

    if (
      options.fastPath === true &&
      this.initialized &&
      previousState?.workspaceRoot &&
      sameWorkspaceRoot(previousState.workspaceRoot, workspaceRoot) &&
      previousBinding === workspaceBinding
    ) {
      return;
    }

    const git = await readWorkspaceGitSnapshot(workspaceRoot);
    let lastProjectWorkspaceRoot = loadedConfig.lastProjectWorkspaceRoot;
    if (
      workspaceBinding === 'none'
      && previousBinding === 'project'
      && previousState?.workspaceRoot
      && !sameWorkspaceRoot(previousState.workspaceRoot, resolveDesktopHomeDirectory())
    ) {
      lastProjectWorkspaceRoot = previousState.workspaceRoot;
    }

    const preserveRecent =
      workspaceBinding === 'none'
      || options.preserveRecentWorkspaces === true;
    const config = {
      ...loadedConfig,
      workspaceBinding,
      ...(lastProjectWorkspaceRoot ? { lastProjectWorkspaceRoot } : {}),
      recentWorkspaces: preserveRecent
        ? (loadedConfig.recentWorkspaces ?? [])
        : mergeRecentWorkspaceRoots(
            loadedConfig.recentWorkspaces,
            git.primaryRepoRoot ?? workspaceRoot,
          ),
    } satisfies DesktopConfigFile;

    const recentWorkspacesChanged =
      !loadedConfig.recentWorkspaces ||
      config.recentWorkspaces.length !== loadedConfig.recentWorkspaces.length ||
      config.recentWorkspaces.some((entry, index) => entry !== loadedConfig.recentWorkspaces?.[index]);
    const bindingChanged = normalizeWorkspaceBinding(loadedConfig.workspaceBinding) !== workspaceBinding;
    const lastProjectChanged = loadedConfig.lastProjectWorkspaceRoot !== config.lastProjectWorkspaceRoot;
    if (recentWorkspacesChanged || bindingChanged || lastProjectChanged) {
      await saveConfig(config);
    }

    if (
      this.initialized
      && previousState?.workspaceRoot
      && sameWorkspaceRoot(previousState.workspaceRoot, workspaceRoot)
      && previousBinding === workspaceBinding
    ) {
      const currentState = this.requireState();
      currentState.config = config;
      currentState.git = git;
      currentState.workspaceBinding = workspaceBinding;
      currentState.plan = await loadDesktopPlanSnapshot(
        currentState.metadata.planMetadata.path,
        currentState.metadata.planMetadata.exists,
      );
      return;
    }

    const metadata = await loadHostMetadata(workspaceRoot, config.planMode === true, {
      workspaceBinding,
    });
    const plan = await loadDesktopPlanSnapshot(metadata.planMetadata.path, metadata.planMetadata.exists);
    const state = this.state;
    const previousWorkspaceRoot = state?.workspaceRoot;
    const switchingWorkspace = Boolean(
      previousWorkspaceRoot && !sameWorkspaceRoot(previousWorkspaceRoot, workspaceRoot),
    );
    if (switchingWorkspace) {
      await this.extensionManager().deactivateAll();
    }

    if (switchingWorkspace) {
      this.lastRuntimeError = '';
      this.toolExecutor = undefined;
      this.sessionRegistry.clearForWorkspaceSwitch(workspaceRoot);
      this.resetStreamingPlacementState(true);
    } else if (!this.sessionRegistry.hasActive()) {
      this.sessionRegistry.ensureDraft(workspaceRoot);
    } else {
      this.sessionRegistry.requireActive().workspaceRoot = workspaceRoot;
    }

    this.state = {
      workspaceRoot,
      workspaceBinding,
      config,
      git,
      metadata,
      plan,
      extensionsList: state?.extensionsList ?? [],
      extensionCss: state?.extensionCss ?? [],
      ephemeralSessions: state?.ephemeralSessions ?? [],
    };
    this.initialized = true;
    await this.refreshExtensionsList();
    const skipRuntimeRefresh = switchingWorkspace && options.deferRuntimeRefresh === true;
    if (!skipRuntimeRefresh) {
      await this.refreshRuntime();
    }
    await this.dispatchExtensionEvent({
      type: 'onStartup',
      detail: {
        workspaceRoot,
      },
    });
  }

  private async refreshRuntime(): Promise<void> {
    await this.refreshRuntimeForBundle(this.activeBundle());
    this.syncActiveRuntimePointer();
  }

  private resolveBundleActivePlanPath(bundle: SessionBundle): string | undefined {
    const existing = bundle.activePlanPath?.trim();
    if (existing) {
      return existing;
    }
    const fromArchive = extractActivePlanPathFromLlmHistory(bundle.archiveHistory);
    if (fromArchive) {
      bundle.activePlanPath = fromArchive;
    }
    return fromArchive;
  }

  private async syncPlanStateForBundle(bundle: SessionBundle): Promise<void> {
    const state = this.requireState();
    const activePlanPath = this.resolveBundleActivePlanPath(bundle);
    state.metadata = await loadHostMetadata(
      state.workspaceRoot,
      state.config.planMode === true,
      { activePlanPath, workspaceBinding: state.workspaceBinding },
    );
    state.plan = await loadDesktopPlanSnapshot(
      state.metadata.planMetadata.path,
      state.metadata.planMetadata.exists,
    );
  }

  private async refreshRuntimeForBundle(bundle: SessionBundle): Promise<void> {
    const state = this.requireState();
    await this.syncPlanStateForBundle(bundle);
    await this.ensureToolExecutor(bundle);
    bundle.currentTurnSkills = [];
    const apiKey = await resolveApiKeyForModel(state.config.activeModel);
    this.activeApiKeyConfigured = Boolean(apiKey);
    const extensionSystemPrompts = await this.collectExtensionSystemPrompts();
    const activeProfile = state.config.models.find((m) => m.name === state.config.activeModel);
    const imageGenerationProfile = state.config.imageGenerationModel
      ? state.config.models.find((model) => model.name === state.config.imageGenerationModel)
      : undefined;
    const imageGenerationApiKey = imageGenerationProfile
      ? await resolveApiKeyForModel(imageGenerationProfile.name)
      : undefined;
    bundle.runtimeTransport = createLlmTransport();
    if (!apiKey) {
      bundle.runtime = undefined;
      if (bundle.id === this.sessionRegistry.activeSessionId()) {
        this.runtime = undefined;
      }
      this.lastRuntimeError = i18n.t('error.apiKeyNotConfigured');
      await this.refreshModelKeyPresence();
      return;
    }

    let runtimeTransportConfig = buildPrimaryTransportConfig({
      apiKey,
      model: state.config.activeModel,
      baseUrl: currentApiBase(state.config),
      workspaceRoot: bundle.workspaceRoot || state.workspaceRoot,
      profile: activeProfile,
    });
    if (
      runtimeTransportConfig.transportKind === 'openai-compatible'
      && imageGenerationProfile
      && imageGenerationApiKey
      && supportsImageGeneration(imageGenerationProfile)
      && resolveDesktopTransportKind(imageGenerationProfile) === 'openai-compatible'
    ) {
      const imageGenerationVendor = openAiCompatibleVendorFromProvider(imageGenerationProfile.provider);
      runtimeTransportConfig = {
        ...runtimeTransportConfig,
        imageGeneration: {
          apiKey: imageGenerationApiKey,
          model: imageGenerationProfile.name,
          baseUrl: imageGenerationProfile.apiBase || DEFAULT_API_BASE,
          ...(imageGenerationVendor ? { llmVendor: imageGenerationVendor } : {}),
          ...(imageGenerationProfile.capabilities
            ? { modelCapabilities: modelCapabilitiesFromConfig(imageGenerationProfile.capabilities) }
            : {}),
        },
      };
    }
    bundle.runtimeTransport = createLlmTransport(runtimeTransportConfig);

    const desktopMessages = bundle.messageTimeline.toMessages();
    const runtime = this.createRuntime(
      runtimeTransportConfig,
      bundle.archiveHistory,
      state.metadata.rules.enabledRules,
      state.metadata.skills.enabledSkillCatalog,
      state.metadata.planMetadata,
      extensionSystemPrompts,
      await buildDreamContextText({
        workspaceRoot: bundle.workspaceRoot || state.workspaceRoot,
        gitBranch: state.git.branch,
      }),
      (await buildSessionTodosContextText(this.resolveTodoSessionKeyForBundle(bundle))) || undefined,
      await this.ensureToolExecutor(bundle),
      bundle.runtimeTransport,
      bundle,
    );
    if (bundle.archiveSubagentSessions.length > 0 || bundle.archiveHistory.length > 0) {
      runtime.replaceFromArchive({
        messages: buildArchiveMessagesFromConversation(desktopMessages),
        assistantAux: buildArchiveAssistantAuxFromConversation(desktopMessages),
        llmHistory: bundle.archiveHistory,
        subagentSessions: bundle.archiveSubagentSessions ?? [],
        loopEnabled: bundle.loopEnabled,
      });
    }
    runtime.setLoopEnabled(bundle.loopEnabled);
    const toolExecutor = await this.ensureToolExecutor(bundle);
    toolExecutor.setApprovalLevel(bundle.approvalLevel);
    bundle.runtime = runtime;
    if (bundle.id === this.sessionRegistry.activeSessionId()) {
      this.runtime = runtime;
    }
    this.lastRuntimeError = '';
    await this.refreshModelKeyPresence();
    await this.refreshTodoSnapshotForBundle(bundle);
    bundle.runtimeActivationSignature = this.runtimeActivationSignature(bundle);
  }

  private async ensureToolExecutor(bundle: SessionBundle = this.activeBundle()): Promise<DesktopToolExecutor> {
    const state = this.requireState();
    const isActive = bundle.id === this.sessionRegistry.activeSessionId();
    const workspaceRoot = bundle.workspaceRoot || state.workspaceRoot;
    const dreamScope: HostDreamScope | undefined =
      isActive && state.git.branch
        ? {
            workspaceRoot,
            gitBranch: state.git.branch,
          }
        : undefined;
    const todoScope: HostTodoScope = createTodoScope(this.resolveTodoSessionKeyForBundle(bundle));

    const needsRebuild =
      !bundle.toolExecutor
      || bundle.toolExecutorWorkspaceRoot !== workspaceRoot
      || !bundle.toolExecutor.matchesDreamAccess(dreamScope, dreamScope ? 'read-only' : undefined)
      || !bundle.toolExecutor.matchesTodoAccess(todoScope);

    if (needsRebuild) {
      bundle.toolExecutor = await this.buildToolExecutorForBundle(bundle, dreamScope, todoScope);
      bundle.toolExecutorWorkspaceRoot = workspaceRoot;
      bundle.toolExecutorTodoSessionKey = todoScope.sessionKey;
    } else if (bundle.toolExecutor) {
      await this.refreshExtensionToolDefinitions(bundle.toolExecutor);
    }
    if (isActive) {
      this.toolExecutor = bundle.toolExecutor;
    }
    if (!bundle.toolExecutor) {
      throw new Error(i18n.t('error.mcpExecutorNotInitialized'));
    }
    bundle.toolExecutor.setApprovalLevel(bundle.approvalLevel);
    bundle.toolExecutor.setLoopToolExposure(bundle.loopEnabled);
    bundle.toolExecutor.setPlanModeToolExposure(this.requireState().config.planMode === true);
    await bundle.toolExecutor.ensureMcpToolingReady();
    return bundle.toolExecutor;
  }

  private sharedMcpServiceForWorkspace(
    workspaceRoot: string,
    workspaceBinding: DesktopWorkspaceBinding = 'project',
  ): McpService {
    const includeWorkspaceConfig = workspaceBinding === 'project';
    const key = `${path.resolve(workspaceRoot)}|${includeWorkspaceConfig ? 'project' : 'none'}`;
    let service = this.mcpServiceByWorkspaceRoot.get(key);
    if (!service) {
      service = new McpService(path.resolve(workspaceRoot), includeWorkspaceConfig);
      service.startBackgroundRefreshInBackground(false);
      this.mcpServiceByWorkspaceRoot.set(key, service);
    }
    return service;
  }

  private async buildToolExecutorForBundle(
    bundle: SessionBundle,
    dreamScope?: HostDreamScope,
    todoScope?: HostTodoScope,
  ): Promise<DesktopToolExecutor> {
    const state = this.requireState();
    const workspaceRoot = bundle.workspaceRoot || state.workspaceRoot;
    const extensions = await this.extensionManager().list();
    return new DesktopToolExecutor(workspaceRoot, {
      mcp: this.sharedMcpServiceForWorkspace(workspaceRoot, state.workspaceBinding),
      extensionToolDefinitions: buildDesktopExtensionToolDefinitions(extensions),
      fileChangeObserver: {
        recordFileChange: (change) => {
          void this.recordHostFileChange(bundle, change);
        },
      },
      extensions: {
        manager: this.extensionManager(),
        getHost: () => {
          const adapter = desktopExtensionHostAdapter;
          if (!adapter) {
            throw new Error(i18n.t('error.extensionHostNotConnected'));
          }
          return adapter;
        },
        logger: console,
      },
      ...(dreamScope
        ? {
            dreamScope,
            dreamToolMode: 'read-only' as const,
          }
        : {}),
      ...(todoScope ? { todoScope } : {}),
    });
  }

  private buildClientGitSnapshot(): DesktopGitSnapshot {
    const state = this.requireState();
    const bundle = this.activeBundle();
    const selectedBranch = bundle.pendingGitBranch ?? state.git.branch;
    return {
      ...state.git,
      ...(selectedBranch ? { selectedBranch } : {}),
      workLocation: bundle.workLocation,
    };
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
        lastError: i18n.t('error.dreamCollectorModelNotConfigured'),
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
      planMetadata: buildDreamCollectorPlanMetadata(state.metadata.planMetadata),
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
            extensionName: i18n.t('error.dreamCollector'),
            content: buildDreamCollectorSystemMessage(),
          },
        ],
        undefined,
        undefined,
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
        void this.runSerialized(async () => {
          if (!this.initialized || !this.state) {
            return;
          }
          if (this.runtime?.isBusy()) {
            this.activeBundle().deferredRuntimeRefreshWhileBusy = true;
            return;
          }
          this.activeBundle().deferredRuntimeRefreshWhileBusy = false;
          await this.refreshRuntime();
          this.lastRuntimeError = '';
        });
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

  private emitLiveSnapshotUpdate(): void {
    if (!this.state || this.dreamUpdateListeners.size === 0) {
      return;
    }
    const snapshot = this.buildSnapshot();
    for (const listener of this.dreamUpdateListeners) {
      listener(snapshot);
    }
  }

  private async flushDeferredRuntimeRefreshIfIdle(bundle: SessionBundle = this.activeBundle()): Promise<void> {
    if (!bundle.deferredRuntimeRefreshWhileBusy) {
      return;
    }
    if (bundle.runtime?.isBusy()) {
      return;
    }
    bundle.deferredRuntimeRefreshWhileBusy = false;
    await this.refreshRuntimeForBundle(bundle);
    if (bundle.id === this.sessionRegistry.activeSessionId()) {
      this.syncActiveRuntimePointer();
    }
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
    transportConfig: LlmTransportConfig,
    history: ChatArchive['llmHistory'],
    enabledRules: LlmEnabledRule[],
    enabledSkillCatalog: LlmEnabledSkillCatalogEntry[],
    planMetadata: LlmPlanMetadata,
    extensionSystemPrompts: LlmExtensionSystemPrompt[],
    dreamsContextText?: string,
    todosContextText?: string,
    toolExecutor: DesktopToolExecutor = this.requireToolExecutor(),
    llmTransport: SpiritLlmTransport = createLlmTransport(transportConfig),
    bundle: SessionBundle = this.activeBundle(),
  ): DesktopRuntime {
    const workspaceRoot = transportConfig.workspaceRoot ?? this.requireState().workspaceRoot;
    toolExecutor.setActiveTransportConfig(transportConfig);
    return createDesktopRuntime({
      transportConfig,
      history,
      enabledRules,
      enabledSkillCatalog,
      planMetadata,
      extensionSystemPrompts,
      ...(dreamsContextText === undefined ? {} : { dreamsContextText }),
      ...(todosContextText === undefined ? {} : { todosContextText }),
      toolExecutor,
      llmTransport,
      activeSkills: bundle.currentTurnSkills,
      workspaceRoot,
      basicInfo: this.buildRuntimeBasicInfo(workspaceRoot, toolExecutor),
    });
  }

  private resolveTodoSessionKeyForBundle(bundle: SessionBundle): string {
    return resolveTodoSessionKey({
      sessionFilePath: bundle.activeSession?.filePath,
      bundleId: bundle.id,
      todoSessionScopeKey: bundle.todoSessionScopeKey,
    });
  }

  private async maybeRefreshRuntimeAfterTodoScopeChange(
    bundle: SessionBundle,
    previousSessionKey: string,
  ): Promise<void> {
    const nextSessionKey = this.resolveTodoSessionKeyForBundle(bundle);
    if (
      normalizeTodoSessionStorageKey(previousSessionKey)
      === normalizeTodoSessionStorageKey(nextSessionKey)
    ) {
      return;
    }
    if (!bundle.runtime) {
      return;
    }
    await this.refreshRuntimeForBundle(bundle);
    if (bundle.id === this.sessionRegistry.activeSessionId()) {
      this.syncActiveRuntimePointer();
    }
  }

  private async finalizeTodoScopeForNewActiveBundle(
    bundle: SessionBundle,
    workspaceRoot: string,
  ): Promise<void> {
    if (!bundle.todoSessionScopeKey) {
      bundle.todoSessionScopeKey = createTodoSessionScopeKey();
    }
    bundle.cachedTodoSnapshot = undefined;
    const legacyProvisionalKey = path.resolve(provisionalNewSessionPath(workspaceRoot));
    this.cancelTodoClearing(legacyProvisionalKey);
    await purgeSessionTodos(legacyProvisionalKey);
    await this.ensureToolExecutor(bundle);
    await this.refreshTodoSnapshotForBundle(bundle);
  }

  private async reconcileTodoScopeAfterSessionPathChange(
    bundle: SessionBundle,
    previousSessionKey: string,
  ): Promise<void> {
    const nextSessionKey = this.resolveTodoSessionKeyForBundle(bundle);
    if (
      normalizeTodoSessionStorageKey(previousSessionKey)
      === normalizeTodoSessionStorageKey(nextSessionKey)
    ) {
      return;
    }

    this.cancelTodoClearing(previousSessionKey);
    this.cancelTodoClearing(nextSessionKey);
    await migrateSessionTodos(previousSessionKey, nextSessionKey);
    await this.ensureToolExecutor(bundle);
    await this.refreshTodoSnapshotForBundle(bundle);
  }

  private cancelTodoClearing(sessionKey: string): void {
    const pending = this.todoClearingBySession.get(sessionKey);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.todoClearingBySession.delete(sessionKey);
  }

  private scheduleTodoClearing(sessionKey: string, items: HostTodoRecord[]): void {
    this.cancelTodoClearing(sessionKey);
    const untilUnixMs = Date.now() + 1000;
    const timer = setTimeout(() => {
      void this.runSerialized(async () => {
        const pending = this.todoClearingBySession.get(sessionKey);
        if (!pending || pending.timer !== timer) {
          return;
        }
        this.todoClearingBySession.delete(sessionKey);
        await purgeSessionTodos(sessionKey);
        const active = this.sessionRegistry.getActive();
        if (active) {
          await this.refreshTodoSnapshotForBundle(active);
        }
        this.emitLiveSnapshotUpdate();
      });
    }, 1000);
    this.todoClearingBySession.set(sessionKey, { untilUnixMs, items: cloneHostTodoRecords(items), timer });
  }

  private async refreshTodoSnapshotForBundle(bundle: SessionBundle): Promise<void> {
    bundle.cachedTodoSnapshot = await this.buildConversationTodoSnapshot(bundle);
  }

  private async buildConversationTodoSnapshot(
    bundle: SessionBundle,
  ): Promise<ConversationTodoSnapshot | undefined> {
    const sessionKey = this.resolveTodoSessionKeyForBundle(bundle);
    const executorKey = bundle.toolExecutorTodoSessionKey;
    const pendingClearing = this.todoClearingBySession.get(sessionKey);
    if (pendingClearing) {
      return {
        items: pendingClearing.items.map(mapHostTodoToDesktopItem),
        clearingUntilUnixMs: pendingClearing.untilUnixMs,
      };
    }

    const records = await listSessionTodos(sessionKey);
    if (records.length === 0) {
      return undefined;
    }

    const allCompleted = records.every((record) => record.status === 'completed');
    if (allCompleted) {
      this.scheduleTodoClearing(sessionKey, records);
      return {
        items: records.map(mapHostTodoToDesktopItem),
        clearingUntilUnixMs: Date.now() + 1000,
      };
    }

    return {
      items: records.map(mapHostTodoToDesktopItem),
    };
  }

  private buildRuntimeBasicInfo(
    workspaceRoot: string,
    toolExecutor: DesktopToolExecutor,
  ): LlmToolAgentBasicInfo {
    const shell = toolExecutor.toolDefinitionEnvironment();
    return {
      workspaceRoot,
      terminal: shell.shellDisplayName,
      system: toolExecutor.operatingSystemInfo(),
    };
  }

  private buildSnapshot(): DesktopSnapshot {
    const state = this.requireState();
    const pendingApproval = this.runtime?.currentPendingApproval();
    const pendingQuestions = this.runtime?.currentPendingQuestions();
    const pendingAux = this.runtime?.pendingAuxState();
    const standaloneAnchorState = this.activeOrchestration().assistantMessages.standaloneAnchorState();
    this.activeOrchestration().conversationSnapshotView.syncStandalonePendingAux({
      livePendingAux: pendingAux,
      pendingAssistantMessageId: standaloneAnchorState.pendingAssistantMessageId,
      lastSettledAssistantMessageId: standaloneAnchorState.lastSettledAssistantMessageId,
    });
    if (pendingAux && !parsePendingSubagentStatusText(pendingAux.statusText)) {
      const auxText = pendingAux.detailText?.trim();
      if (auxText) {
        this.activeOrchestration().assistantMessages.updatePendingAssistantAux(
          pendingAux.kind,
          auxText,
        );
        if (!this.activeBundle().messageTimeline.hasFinalizedAuxInActiveSegment(pendingAux.kind, auxText)) {
          this.activeBundle().messageTimeline.updatePendingAssistantAux(
            pendingAux.kind,
            auxText,
          );
        }
      }
    }

    const rawMessages = this.activeBundle().messages;
    const rawConversationMessages = this.desktopMessages();

    const conversationMessages = this.activeOrchestration().conversationSnapshotView.buildMessagesWithPendingAssistant({
      messages: rawConversationMessages,
      livePendingAux: pendingAux,
      rewind: this.activeBundle().rewind,
    });
    this.logContinuationSnapshotState({
      rawMessages: rawConversationMessages,
      visibleMessages: conversationMessages,
      isBusy: this.runtime?.isBusy() ?? false,
      pendingAux,
    });
    this.logToolSnapshotState({
      rawMessages,
      timelineMessages: rawConversationMessages,
      visibleMessages: conversationMessages,
      isBusy: this.runtime?.isBusy() ?? false,
    });
    const activeBundle = this.activeBundle();

    return buildDesktopSnapshot({
      workspaceRoot: state.workspaceRoot,
      config: state.config,
      git: this.buildClientGitSnapshot(),
      metadata: state.metadata,
      plan: state.plan,
      extensionsList: state.extensionsList,
      extensionCss: state.extensionCss,
      dreamCollectorStatus: this.dreamCollectorStatus,
      runtimeReady: this.runtime !== undefined,
      runtimeError: this.lastRuntimeError,
      modelKeyPresence: this.modelKeyPresence,
      activeApiKeyConfigured: this.activeApiKeyConfigured,
      mcpStatus:
        this.activeBundle().toolExecutor?.mcpStatusSnapshot()
        ?? this.toolExecutor?.mcpStatusSnapshot()
        ?? emptyMcpStatusSnapshot(),
      mcpServers: listDesktopMcpServersFromDisk(state.workspaceRoot, state.workspaceBinding),
      conversation: {
        revision: activeBundle.conversationRevision,
        messages: conversationMessages,
        loopEnabled: this.activeBundle().loopEnabled,
        approvalLevel: this.activeBundle().approvalLevel,
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
                toolName: displayTitleForTool(
                  pendingApproval.toolName,
                  pendingApproval.request,
                ),
                prompt: stripReasonLineFromShellPrompt(
                  pendingApproval.toolName,
                  pendingApproval.prompt,
                ),
                ...(typeof pendingApproval.trustTarget === 'string'
                  ? { trustTarget: pendingApproval.trustTarget }
                  : {}),
              },
            }
          : {}),
        ...(pendingQuestions
          ? { pendingQuestions: mapPendingQuestions(pendingQuestions) }
          : {}),
        isBusy: this.runtime?.isBusy() ?? false,
        ...(this.activeBundle().rewindWarnings.length > 0
          ? { rewindWarnings: this.activeBundle().rewindWarnings.map((warning) => ({ ...warning })) }
          : {}),
        ...(activeBundle.cachedTodoSnapshot ? { todos: activeBundle.cachedTodoSnapshot } : {}),
      },
      ...(activeBundle.activeSession ? { activeSession: activeBundle.activeSession } : {}),
      composerSessionKey: this.resolveTodoSessionKeyForBundle(activeBundle),
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
      throw new Error(i18n.t('error.autoCommitFailedNoKey'));
    }

    const extensionSystemPrompts = await this.collectExtensionSystemPrompts();
    const commitContext = await buildWorkspaceGitCommitMessageContext(state.workspaceRoot);
    const dreamContextText = await buildDreamContextText({
      workspaceRoot: state.workspaceRoot,
      gitBranch: state.git.branch,
    });
    const prompt = buildCommitMessageGenerationPrompt({
      workspaceRoot: state.workspaceRoot,
      branch: state.git.branch,
      statusText: commitContext.statusText,
      diffStatText: commitContext.diffStatText,
      diffText: commitContext.diffText,
    });
    const transportConfig = buildPrimaryTransportConfig({
      apiKey,
      model: state.config.activeModel,
      baseUrl: currentApiBase(state.config),
      workspaceRoot: state.workspaceRoot,
      profile: activeProfile,
    });
    const llmTransport = createLlmTransport(transportConfig);
    const toolExecutor = await this.ensureToolExecutor();
    toolExecutor.setActiveTransportConfig(transportConfig);
    const dreamToolDefinitions = state.git.branch ? buildDreamReadHostToolDefinitions() : [];
    let toolState = startLlmToolAgentState(
      [],
      prompt,
      state.workspaceRoot,
      state.metadata.rules.enabledRules,
      state.metadata.skills.enabledSkillCatalog,
      [],
      transportConfig.model,
      state.metadata.planMetadata,
      extensionSystemPrompts,
      dreamContextText || undefined,
      undefined,
      this.buildRuntimeBasicInfo(state.workspaceRoot, toolExecutor),
    );
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
      for (let round = 0; round < 6; round += 1) {
        const completion = await llmTransport.startToolAgentRound(
          transportConfig,
          toolState,
          dreamToolDefinitions,
        );

        if (completion.kind !== 'success') {
          throw new Error(i18n.t('error.autoCommitFailed', { error: completion.error }));
        }

        toolState = completion.result.state;

        if (completion.result.step.kind === 'final-response-ready') {
          const assistantText = extractLastLlmAssistantText(toolState)?.trim();
          if (!assistantText) {
            throw new Error(i18n.t('error.autoCommitFailedNoBody'));
          }

          const message = parseGeneratedCommitMessageResponse(assistantText);
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
        }

        const toolResults = [];
        for (const call of completion.result.step.calls) {
          const request = await toolExecutor.requestFromFunctionCall(call.name, call.argumentsJson);
          const requestWithMetadata = toolExecutor.attachRequestMetadata
            ? toolExecutor.attachRequestMetadata(request, {
                toolCallId: call.id,
                toolName: call.name,
              })
            : request;
          const authorization = await toolExecutor.authorize(requestWithMetadata);
          if (authorization.kind !== 'allowed') {
            throw new Error(i18n.t('error.autoCommitFailedInteractiveTool', { name: call.name }));
          }
          const output = await toolExecutor.execute(requestWithMetadata);
          toolResults.push({
            toolCallId: call.id,
            content: output.summaryText,
          });
        }

        toolState = appendLlmToolResultMessages(toolState, toolResults);
      }

      throw new Error(i18n.t('error.autoCommitFailedIncomplete'));
    } catch (error) {
      const failureMessage = i18n.t('error.generationFailed', { message: error instanceof Error ? error.message : String(error) });
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
        displayName: i18n.t('error.commitAutoGenFailed'),
        workspaceRoot: state.workspaceRoot,
        messages: finalMessages,
      }));
      throw error;
    }
  }

  private rememberEphemeralWorktreeSession(record: EphemeralSessionRecord): void {
    const state = this.requireState();
    state.ephemeralSessions = rememberEphemeralWorktreeSessionRecord(state.ephemeralSessions, record);
  }

  private async bootstrapWorktreeForFirstTurn(userPrompt: string): Promise<void> {
    const state = this.requireState();
    const bundle = this.activeBundle();

    if (!state.git.isRepository) {
      throw new Error(i18n.t('error.notGitRepoForWorktree'));
    }

    const repoRoot = await readPrimaryRepoRoot(state.workspaceRoot);
    const worktreeContext = await readWorkspaceGitSnapshot(state.workspaceRoot);
    if (worktreeContext.isWorktreeSession) {
      throw new Error(i18n.t('error.alreadyInWorktree'));
    }

    const baseBranch = bundle.pendingGitBranch ?? state.git.branch;
    if (!baseBranch) {
      throw new Error(i18n.t('error.cannotDetermineBaseBranch'));
    }
    if (!state.git.branches.includes(baseBranch)) {
      throw new Error(i18n.t('error.baseBranchNotFound', { branch: baseBranch }));
    }

    const names = await this.generateWorktreeNamesFromModel(userPrompt, baseBranch, repoRoot);
    const created = await createWorkspaceGitWorktree(repoRoot, names, baseBranch);

    bundle.pendingGitBranch = undefined;
    bundle.workLocation = 'local';
    bundle.workspaceRoot = created.worktreePath;

    await this.adoptWorkspaceRootForActiveBundle(created.worktreePath);
    this.startDreamCollectorIfNeeded();
  }

  private async adoptWorkspaceRootForActiveBundle(workspaceRoot: string): Promise<void> {
    const resolved = path.resolve(workspaceRoot);
    const state = this.requireState();
    const bundle = this.activeBundle();
    const switchingWorkspace = !sameWorkspaceRoot(state.workspaceRoot, resolved);

    if (switchingWorkspace) {
      await this.extensionManager().deactivateAll();
      this.lastRuntimeError = '';
      this.toolExecutor = undefined;
      this.resetStreamingPlacementState(true);
    }

    state.workspaceRoot = resolved;
    state.git = await readWorkspaceGitSnapshot(resolved);
    bundle.workspaceRoot = resolved;
    await this.syncPlanStateForBundle(bundle);
    await this.refreshRuntimeForBundle(bundle);
    this.syncActiveRuntimePointer();
    if (switchingWorkspace) {
      await this.refreshExtensionsList();
      await this.dispatchExtensionEvent({
        type: 'onStartup',
        detail: {
          workspaceRoot: resolved,
        },
      });
    }
  }

  private async generateWorktreeNamesFromModel(
    userPrompt: string,
    baseBranch: string,
    repoRoot: string,
  ): Promise<{ worktreeName: string; branchName: string }> {
    const state = this.requireState();
    const activeProfile = state.config.models.find((model) => model.name === state.config.activeModel);
    const apiKey = await resolveApiKeyForModel(state.config.activeModel);
    if (!apiKey) {
      throw new Error(i18n.t('error.autoWorktreeNameFailedNoKey'));
    }

    const extensionSystemPrompts = await this.collectExtensionSystemPrompts();
    const dreamContextText = await buildDreamContextText({
      workspaceRoot: state.workspaceRoot,
      gitBranch: state.git.branch,
    });
    const prompt = buildWorktreeNamingPrompt({
      userPrompt,
      baseBranch,
      repoRoot,
    });
    const transportConfig = buildPrimaryTransportConfig({
      apiKey,
      model: state.config.activeModel,
      baseUrl: currentApiBase(state.config),
      workspaceRoot: state.workspaceRoot,
      profile: activeProfile,
    });
    const llmTransport = createLlmTransport(transportConfig);
    const toolExecutor = await this.ensureToolExecutor();
    toolExecutor.setActiveTransportConfig(transportConfig);
    const dreamToolDefinitions = state.git.branch ? buildDreamReadHostToolDefinitions() : [];
    let toolState = startLlmToolAgentState(
      [],
      prompt,
      state.workspaceRoot,
      state.metadata.rules.enabledRules,
      state.metadata.skills.enabledSkillCatalog,
      [],
      transportConfig.model,
      state.metadata.planMetadata,
      extensionSystemPrompts,
      dreamContextText || undefined,
      undefined,
      this.buildRuntimeBasicInfo(state.workspaceRoot, toolExecutor),
    );
    const sessionPath = createEphemeralWorktreeSessionPath();
    const baseMessages: ConversationMessageSnapshot[] = [
      {
        id: 1,
        role: 'user',
        content: prompt,
        pending: false,
      },
    ];

    try {
      for (let round = 0; round < 6; round += 1) {
        const completion = await llmTransport.startToolAgentRound(
          transportConfig,
          toolState,
          dreamToolDefinitions,
        );

        if (completion.kind !== 'success') {
          throw new Error(i18n.t('error.autoWorktreeNameFailed', { error: completion.error }));
        }

        toolState = completion.result.state;

        if (completion.result.step.kind === 'final-response-ready') {
          const assistantText = extractLastLlmAssistantText(toolState)?.trim();
          if (!assistantText) {
            throw new Error(i18n.t('error.autoWorktreeNameFailedNoBody'));
          }

          const names = parseGeneratedWorktreeNamingResponse(assistantText);
          const summary = JSON.stringify(names);
          const finalMessages = [
            ...baseMessages,
            {
              id: 2,
              role: 'assistant' as const,
              content: summary,
              pending: false,
            },
          ];
          this.rememberEphemeralWorktreeSession(buildWorktreeEphemeralSessionRecord({
            path: sessionPath,
            displayName: `[Worktree] ${names.worktreeName}`,
            workspaceRoot: state.workspaceRoot,
            messages: finalMessages,
          }));
          return names;
        }

        const toolResults = [];
        for (const call of completion.result.step.calls) {
          const request = await toolExecutor.requestFromFunctionCall(call.name, call.argumentsJson);
          const requestWithMetadata = toolExecutor.attachRequestMetadata
            ? toolExecutor.attachRequestMetadata(request, {
                toolCallId: call.id,
                toolName: call.name,
              })
            : request;
          const authorization = await toolExecutor.authorize(requestWithMetadata);
          if (authorization.kind !== 'allowed') {
            throw new Error(i18n.t('error.autoWorktreeNameFailedInteractiveTool', { name: call.name }));
          }
          const output = await toolExecutor.execute(requestWithMetadata);
          toolResults.push({
            toolCallId: call.id,
            content: output.summaryText,
          });
        }

        toolState = appendLlmToolResultMessages(toolState, toolResults);
      }

      throw new Error(i18n.t('error.autoWorktreeNameFailedIncomplete'));
    } catch (error) {
      const failureMessage = i18n.t('error.generationFailed', { message: error instanceof Error ? error.message : String(error) });
      const finalMessages = [
        ...baseMessages,
        {
          id: 2,
          role: 'assistant' as const,
          content: failureMessage,
          pending: false,
        },
      ];
      this.rememberEphemeralWorktreeSession(buildWorktreeEphemeralSessionRecord({
        path: sessionPath,
        displayName: i18n.t('error.worktreeAutoGenFailed'),
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

  private async refreshExtensionToolDefinitions(executor: DesktopToolExecutor = this.requireToolExecutor()): Promise<void> {
    const extensions = await this.extensionManager().list();
    executor.setExtensionToolDefinitions(buildDesktopExtensionToolDefinitions(extensions));
  }

  private async collectExtensionSystemPrompts(): Promise<LlmExtensionSystemPrompt[]> {
    const adapter = desktopExtensionHostAdapter;
    if (!adapter) {
      return [];
    }

    return collectExtensionSystemPrompts(this.extensionManager(), adapter);
  }

  private async refreshRuntimeAfterExtensionMutation(): Promise<void> {
    if (this.runtime?.isBusy()) {
      this.activeBundle().deferredRuntimeRefreshWhileBusy = true;
      return;
    }

    this.activeBundle().deferredRuntimeRefreshWhileBusy = false;
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
    const bundle = this.activeBundle();
    if (bundle.activeSession) {
      this.promoteProvisionalSessionIfNeeded(seedText);
      return;
    }

    bundle.activeSession = {
      filePath: defaultNewSessionPath(),
      displayName: deriveDisplayNameFromSeed(seedText),
      kind: 'stored',
    };
  }

  private promoteProvisionalSessionIfNeeded(seedText: string): void {
    const bundle = this.activeBundle();
    const activeSession = bundle.activeSession;
    if (!activeSession || !isProvisionalSessionPath(activeSession.filePath)) {
      return;
    }

    const nextPath = defaultNewSessionPath();
    activeSession.filePath = nextPath;
    activeSession.displayName = deriveDisplayNameFromSeed(seedText);
    this.sessionRegistry.rekeyBundle(bundle, nextPath);
  }

  private archiveMessages(): Array<{ role: 'user' | 'assistant'; content: string }> {
    return buildArchiveMessagesFromConversation(this.desktopMessages());
  }

  private archiveAssistantAux(): AssistantAuxArchiveEntry[] {
    return buildArchiveAssistantAuxFromConversation(this.desktopMessages());
  }

  private desktopMessages(): ConversationMessageSnapshot[] {
    return this.activeBundle().messageTimeline.toMessages();
  }

  private createMessageTimelineFromMessages(
    messages: ConversationMessageSnapshot[],
    timelineSnapshot?: DesktopTimelineTurnSnapshot[],
  ): DesktopMessageTimeline {
    let nextTimelineMessageId = nextMessageIdFromMessages(messages);
    if (timelineSnapshot && timelineSnapshot.length > 0) {
      try {
        return DesktopMessageTimeline.fromSnapshot(timelineSnapshot, {
          allocateMessageId: () => nextTimelineMessageId++,
          reserveMessageId: (messageId) => {
            if (messageId >= nextTimelineMessageId) {
              nextTimelineMessageId = messageId + 1;
            }
          },
        });
      } catch {
        nextTimelineMessageId = nextMessageIdFromMessages(messages);
      }
    }
    return DesktopMessageTimeline.fromMessages(messages, {
      allocateMessageId: () => nextTimelineMessageId++,
      reserveMessageId: (messageId) => {
        if (messageId >= nextTimelineMessageId) {
          nextTimelineMessageId = messageId + 1;
        }
      },
    });
  }

  private rebuildMessageTimelineFromMessages(): void {
    const bundle = this.activeBundle();
    bundle.messageTimeline = this.createMessageTimelineFromMessages(bundle.messages);
  }

  private takeNextTimelineAssistantSegmentKind(bundle: SessionBundle): DesktopTimelineSegmentKind {
    const kind = bundle.nextTimelineAssistantSegmentKind;
    bundle.nextTimelineAssistantSegmentKind = 'initial';
    return kind;
  }

  private markInterruptedToolsInCurrentTurn(): void {
    const messages = this.activeBundle().messages;
    let lastUser = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        lastUser = index;
        break;
      }
    }
    for (let index = lastUser + 1; index < messages.length; index += 1) {
      const message = messages[index];
      const tool = message?.tool;
      if (!tool?.toolCallId) {
        continue;
      }
      if (tool.phase !== 'preview' && tool.phase !== 'running' && tool.phase !== 'pending-approval') {
        continue;
      }
      const headline = i18n.t('error.interrupted', { toolName: tool.toolName });
      const failedTool = applyToolCallSummaryCopy(
        {
          ...tool,
          phase: 'failed',
          headline,
          detailLines: [],
        },
        { headline },
      );
      message.tool = failedTool;
      this.activeBundle().messageTimeline.upsertToolMessage(tool.toolCallId, failedTool);
      const orchestration = this.activeOrchestration();
      orchestration.assistantMessages.upsertToolMessage(tool.toolCallId, failedTool, 0);
    }
    this.activeBundle().messages = this.desktopMessages();
  }

  private clearAssistantContinuationMarkers(): void {
    const messages = this.activeBundle().messages;
    for (const message of messages) {
      delete message.canContinue;
    }
    this.activeBundle().messageTimeline.clearContinuationMarkers();
  }

  private markAssistantMessageContinuable(content: string): void {
    const normalized = content.trim();
    this.clearAssistantContinuationMarkers();

    const messages = this.activeBundle().messages;
    const timelineMessage = this.activeBundle().messageTimeline.markLatestRenderableAssistantRowContinuable({
      content: normalized,
    });
    if (timelineMessage) {
      const cachedMessage = messages.find((message) => message.id === timelineMessage.id);
      if (cachedMessage) {
        cachedMessage.canContinue = true;
      }
      this.logContinuationMarker('marked', cachedMessage ?? timelineMessage, normalized, messages);
      return;
    }

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
      this.activeBundle().messageTimeline.markRowContinuable(message.id);
      this.logContinuationMarker('marked', message, normalized, messages);
      return;
    }

    this.logContinuationMarker('missing', undefined, normalized, messages);
  }

  private latestContinuableAssistantMessage(): ConversationMessageSnapshot | undefined {
    const timelineContinuable = this.activeBundle().messageTimeline.latestContinuableAssistantMessage();
    if (timelineContinuable) {
      return timelineContinuable;
    }
    const messages = this.activeBundle().messages;
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

    const messages = this.activeBundle().messages;
    const timelineMessage = this.activeBundle().messageTimeline.markLatestRenderableAssistantRowContinuableInActiveTurn();
    if (timelineMessage) {
      const cachedMessage = messages.find((message) => message.id === timelineMessage.id);
      if (cachedMessage) {
        cachedMessage.canContinue = true;
      }
      this.logContinuationMarker('marked-fallback', cachedMessage ?? timelineMessage, '', messages);
      return;
    }

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
      this.activeBundle().messageTimeline.markRowContinuable(message.id);
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

  private logToolSnapshotState(input: {
    rawMessages: ConversationMessageSnapshot[];
    timelineMessages: ConversationMessageSnapshot[];
    visibleMessages: ConversationMessageSnapshot[];
    isBusy: boolean;
  }): void {
    if (messageOrderDebugLevel() !== 'verbose') {
      return;
    }

    const rawTools = summarizeToolRowsForDebug(input.rawMessages, 8);
    const timelineTools = summarizeToolRowsForDebug(input.timelineMessages, 8);
    const visibleTools = summarizeToolRowsForDebug(input.visibleMessages, 8);
    if (rawTools === '∅' && timelineTools === '∅' && visibleTools === '∅') {
      this.lastToolSnapshotLogSignature = undefined;
      return;
    }

    const rawTail = summarizeMessagesTailForOrderDebug(input.rawMessages, 8);
    const timelineTail = summarizeMessagesTailForOrderDebug(input.timelineMessages, 8);
    const visibleTail = summarizeMessagesTailForOrderDebug(input.visibleMessages, 8);
    const signature = [
      input.isBusy ? '1' : '0',
      rawTools,
      timelineTools,
      visibleTools,
      rawTail,
      timelineTail,
      visibleTail,
    ].join('|');
    if (signature === this.lastToolSnapshotLogSignature) {
      return;
    }
    this.lastToolSnapshotLogSignature = signature;

    console.log(
      `[desktop-host][tool-flow] snapshot busy=${input.isBusy} raw=${rawTools} timeline=${timelineTools} visible=${visibleTools} rawTail=${rawTail} timelineTail=${timelineTail} visibleTail=${visibleTail}`,
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

  private purgeSubagentLeakTextInCurrentTurn(bundle: SessionBundle): void {
    const messages = bundle.messageTimeline.toMessages();
    if (!hasActiveRunSubagentToolInMessages(messages)) {
      return;
    }

    let lastUserIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        lastUserIndex = index;
        break;
      }
    }

    let activeSubagentToolIndex = -1;
    for (let index = lastUserIndex + 1; index < messages.length; index += 1) {
      const message = messages[index];
      if (
        message?.role === 'assistant' &&
        message.tool?.toolName === 'run_subagent' &&
        (message.tool.phase === 'preview' || message.tool.phase === 'running')
      ) {
        activeSubagentToolIndex = index;
      }
    }

    if (activeSubagentToolIndex < 0) {
      return;
    }

    for (let index = activeSubagentToolIndex + 1; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.role !== 'assistant' || message.tool || !message.content.trim()) {
        break;
      }
      if (!isSubagentStatusSurfaceMessage(message)) {
        continue;
      }
      bundle.messageTimeline.clearSubagentStatusLeak(message.id);
    }
  }

  private syncSubagentToolStreamingOutput(bundle: SessionBundle): void {
    const runtime = bundle.runtime;
    if (!runtime?.isBusy()) {
      return;
    }

    this.refreshArchiveFromRuntime(bundle);

    this.purgeSubagentLeakTextInCurrentTurn(bundle);

    const sessions = bundle.archiveSubagentSessions;
    if (sessions.length === 0) {
      return;
    }

    const timelineMessages = bundle.messageTimeline.toMessages();
    const orchestration = this.orchestrationFor(bundle);
    for (const session of sessions) {
      if (session.summary.status !== 'running' && session.summary.status !== 'blocked') {
        continue;
      }

      const toolCallId = session.summary.parentToolCallId?.trim();
      if (!toolCallId) {
        continue;
      }

      const existing = timelineMessages.find((message) => message.tool?.toolCallId === toolCallId)?.tool;
      if (!existing) {
        continue;
      }

      const streamingText = extractSubagentSessionStreamingText(session)?.trim();
      const phase = findRunSubagentToolPhase(timelineMessages, toolCallId) ?? 'running';
      const nextPhase = phase === 'preview' || phase === 'running' ? phase : 'running';
      const nextTool = {
        ...existing,
        phase: nextPhase,
        ...(streamingText
          ? {
              outputExcerpt:
                streamingText.length > 4_000 ? streamingText.slice(0, 4_000) : streamingText,
            }
          : {}),
      };

      orchestration.assistantMessages.upsertToolMessage(toolCallId, nextTool, 0);
      bundle.messageTimeline.upsertToolMessage(toolCallId, nextTool);
    }
  }

  private refreshArchiveFromRuntime(bundle: SessionBundle = this.activeBundle()): void {
    if (!bundle.runtime) {
      return;
    }

    const desktopMessages = bundle.messageTimeline.toMessages();
    const archive = bundle.runtime.toArchive(
      buildArchiveMessagesFromConversation(desktopMessages),
      buildArchiveAssistantAuxFromConversation(desktopMessages),
    );
    bundle.archiveHistory = archive.llmHistory;
    bundle.archiveSubagentSessions = archive.subagentSessions ?? [];
  }

  private async recordHostFileChange(bundle: SessionBundle, change: HostRecordedFileChange): Promise<void> {
    const state = this.state;
    if (!state) {
      return;
    }

    if (
      change.toolName === 'create_plan'
      && change.after.exists
      && change.after.file
    ) {
      bundle.activePlanPath = change.resolvedPath;
    }

    if (
      bundle.id === this.sessionRegistry.activeSessionId()
      && (
        (bundle.activePlanPath && sameFsPath(change.resolvedPath, bundle.activePlanPath))
        || sameFsPath(change.resolvedPath, state.plan.path)
      )
    ) {
      if (bundle.activePlanPath && sameFsPath(change.resolvedPath, bundle.activePlanPath)) {
        state.metadata = await loadHostMetadata(state.workspaceRoot, state.config.planMode === true, {
          activePlanPath: bundle.activePlanPath,
          workspaceBinding: state.workspaceBinding,
        });
      }
      state.metadata.planMetadata.exists = change.after.exists && change.after.file;
      state.plan = {
        path: change.resolvedPath,
        exists: change.after.exists && change.after.file,
        ...(change.after.content !== undefined ? { content: change.after.content } : {}),
        ...(typeof change.after.mtimeMs === 'number'
          ? { modifiedAtUnixMs: change.after.mtimeMs }
          : {}),
      };
    }

    if (!bundle.activeSession) {
      return;
    }

    const stored = toDesktopFileChange(change, nextDesktopRewindSequence(bundle.rewind));
    await saveRewindFileChange(spiritAgentDataDir(), bundle.rewind.sessionId, stored);
    const metadata = fileChangeMetadata(stored);
    bundle.rewind.fileChanges.push(metadata);
    if (!metadata.toolCallId) {
      bundle.pendingUnboundFileChangeIds.push(metadata.id);
    }
  }

  private bindFileChangesToToolMessage(
    bundle: SessionBundle,
    execution: RuntimeToolExecution<DesktopToolRequest>,
    messageId: number,
  ): void {
    bundle.pendingUnboundFileChangeIds = bindRewindFileChangesToToolMessage(
      bundle.rewind,
      bundle.pendingUnboundFileChangeIds,
      execution,
      messageId,
    );
  }

  private async recordRewindCheckpoint(
    messageId: number,
    beforeUserCheckpoint?: DesktopRewindCheckpointSnapshot,
  ): Promise<void> {
    const state = this.requireState();
    if (!this.activeBundle().activeSession) {
      return;
    }
    const desktopMessages = this.desktopMessages();
    const messageIndex = desktopMessages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) {
      return;
    }

    const checkpoint = createRewindCheckpointMetadata(
      messageId,
      messageIndex,
      nextDesktopRewindSequence(this.activeBundle().rewind),
    );
    const archive = this.runtime
      ? this.runtime.toArchive(this.archiveMessages(), this.archiveAssistantAux())
      : {
          messages: this.archiveMessages(),
          assistantAux: this.archiveAssistantAux(),
          llmHistory: this.activeBundle().archiveHistory,
          subagentSessions: this.activeBundle().archiveSubagentSessions ?? [],
          loopEnabled: this.activeBundle().loopEnabled,
        } satisfies ChatArchive;
    const sessionKey = this.resolveTodoSessionKeyForBundle(this.activeBundle());
    const currentTodos = cloneHostTodoRecords(await listSessionTodos(sessionKey));
    await saveRewindCheckpointSnapshot(
      spiritAgentDataDir(),
      this.activeBundle().rewind.sessionId,
      checkpoint.id,
      {
        archive,
        desktopMessages: sanitizeConversationMessagesForPersistence(desktopMessages),
        todos: currentTodos,
        ...(beforeUserCheckpoint
          ? {
              beforeArchive: cloneChatArchive(beforeUserCheckpoint.archive),
              beforeDesktopMessages: beforeUserCheckpoint.desktopMessages.map((message) => ({ ...message })),
              ...(beforeUserCheckpoint.todos
                ? { beforeTodos: cloneHostTodoRecords(beforeUserCheckpoint.todos) }
                : {}),
            }
          : {}),
      },
    );

    upsertRewindCheckpointMetadata(this.activeBundle().rewind, checkpoint);
  }

  private async applyTodosAfterRewind(snapshot: DesktopRewindCheckpointSnapshot): Promise<void> {
    const bundle = this.activeBundle();
    const sessionKey = this.resolveTodoSessionKeyForBundle(bundle);
    this.cancelTodoClearing(sessionKey);
    const restored = snapshot.beforeTodos ?? snapshot.todos ?? [];
    await replaceSessionTodos(sessionKey, restored);
    await this.refreshTodoSnapshotForBundle(bundle);
  }

  private async buildRewindCheckpointSnapshot(): Promise<DesktopRewindCheckpointSnapshot> {
    const state = this.requireState();
    const desktopMessages = this.desktopMessages();
    const archive = this.runtime
      ? this.runtime.toArchive(this.archiveMessages(), this.archiveAssistantAux())
      : {
          messages: this.archiveMessages(),
          assistantAux: this.archiveAssistantAux(),
          llmHistory: this.activeBundle().archiveHistory,
          subagentSessions: this.activeBundle().archiveSubagentSessions ?? [],
          loopEnabled: this.activeBundle().loopEnabled,
        } satisfies ChatArchive;
    const sessionKey = this.resolveTodoSessionKeyForBundle(this.activeBundle());
    const todos = cloneHostTodoRecords(await listSessionTodos(sessionKey));
    return {
      archive,
      desktopMessages: sanitizeConversationMessagesForPersistence(desktopMessages),
      todos,
    };
  }

  private restoreBeforeRewindCheckpoint(
    snapshot: DesktopRewindCheckpointSnapshot,
    checkpointSequence: number,
  ): void {
    const state = this.requireState();
    const archive = snapshot.beforeArchive ?? archiveBeforeLastUser(snapshot.archive);
    const desktopMessages = snapshot.beforeDesktopMessages ?? snapshot.desktopMessages.slice(0, -1);

    this.activeBundle().messages = desktopMessages.map((message) => ({ ...message }));
    this.activeBundle().messageTimeline = this.createMessageTimelineFromMessages(this.activeBundle().messages);
    this.activeBundle().archiveHistory = cloneArchiveHistory(archive.llmHistory);
    this.activeBundle().archiveSubagentSessions = cloneArchiveSubagentSessions(archive.subagentSessions ?? []);
    this.activeBundle().loopEnabled = archive.loopEnabled === true;
    pruneRewindMetadataAfterCheckpoint(this.activeBundle().rewind, checkpointSequence);
    this.activeBundle().pendingUnboundFileChangeIds = [];
    this.activeBundle().messageIdCounter = nextMessageIdFromMessages(this.activeBundle().messages);
    this.activeBundle().conversationRevision += 1;
    this.resetStreamingPlacementState(true);
    this.requireRuntime().replaceFromArchive(archive);
  }

  private async persistCurrentSessionIfNeeded(): Promise<void> {
    const bundle = this.sessionRegistry.getActive();
    if (!bundle) {
      return;
    }
    await this.persistSessionBundle(bundle, {
      fromRuntime: this.runtime,
      bumpListSortAt: true,
    });
  }

  private async persistSessionBundle(
    bundle: SessionBundle,
    options: {
      fromRuntime?: DesktopRuntime;
      bumpListSortAt?: boolean;
    } = {},
  ): Promise<void> {
    const state = this.requireState();
    const activeSession = bundle.activeSession;
    if (!activeSession || activeSession.kind === 'ephemeral') {
      return;
    }

    const desktopMessages = bundle.messageTimeline.toMessages();
    if (desktopMessages.length === 0) {
      return;
    }
    const archiveMessages = buildArchiveMessagesFromConversation(desktopMessages);
    const archiveAssistantAux = buildArchiveAssistantAuxFromConversation(desktopMessages);
    const archive = options.fromRuntime
      ? options.fromRuntime.toArchive(archiveMessages, archiveAssistantAux)
      : {
          messages: archiveMessages,
          assistantAux: archiveAssistantAux,
          llmHistory: bundle.archiveHistory,
          subagentSessions: bundle.archiveSubagentSessions ?? [],
          loopEnabled: bundle.loopEnabled,
        } satisfies ChatArchive;

    bundle.archiveHistory = archive.llmHistory;
    bundle.archiveSubagentSessions = archive.subagentSessions ?? [];
    bundle.loopEnabled = archive.loopEnabled === true;

    const bumpListSortAt = options.bumpListSortAt === true;
    const savedAtUnixMs = bumpListSortAt
      ? Date.now()
      : (bundle.listSortSavedAtUnixMs ?? Date.now());
    const stored = buildStoredDesktopSession({
      archive,
      savedAtUnixMs,
      sessionDisplayName: activeSession.displayName,
      workspaceRoot: bundle.workspaceRoot || state.workspaceRoot,
      gitBranch: state.git.branch,
      ...(bundle.activePlanPath ? { activePlanPath: bundle.activePlanPath } : {}),
      desktopMessages: sanitizeConversationMessagesForPersistence(desktopMessages),
      desktopMessageTimeline: bundle.messageTimeline.snapshot(),
      rewind: bundle.rewind,
      loopEnabled: bundle.loopEnabled,
      approvalLevel: bundle.approvalLevel,
    });
    if (bumpListSortAt) {
      bundle.listSortSavedAtUnixMs = savedAtUnixMs;
    }
    const previousId = bundle.id;
    activeSession.filePath = await saveStoredSession(activeSession.filePath, stored);
    if (path.resolve(previousId) !== path.resolve(activeSession.filePath)) {
      this.sessionRegistry.rekeyBundle(bundle, activeSession.filePath);
    } else {
      bundle.id = activeSession.filePath;
    }
    bundle.lastPersistedAtUnixMs = Date.now();
  }

  private activeBundle(): SessionBundle {
    return this.sessionRegistry.requireActive();
  }

  private requireState(): HostState {
    if (!this.state) {
      throw new Error(i18n.t('error.hostNotInitialized'));
    }
    return this.state;
  }

  private requireRuntime(): DesktopRuntime {
    const runtime = this.activeBundle().runtime ?? this.runtime;
    if (!runtime) {
      throw new Error(this.lastRuntimeError || i18n.t('error.runtimeNotReady'));
    }
    return runtime;
  }

  private allocateMessageId(): number {
    const bundle = this.activeBundle();
    const next = bundle.messageIdCounter;
    bundle.messageIdCounter += 1;
    return next;
  }

  private insertUserApprovalReplyMessage(content: string, pendingToolCallId?: string): void {
    const trimmed = content.trim();
    if (!trimmed) {
      return;
    }

    const state = this.requireState();
    const nextMessage: ConversationMessageSnapshot = {
      id: this.allocateMessageId(),
      role: 'user',
      content: trimmed,
      pending: false,
    };

    if (!pendingToolCallId) {
      this.activeBundle().messages.push(nextMessage);
      this.rebuildMessageTimelineFromMessages();
      return;
    }

    const toolIndex = this.activeBundle().messages.findIndex(
      (message) => message.role === 'assistant' && message.tool?.toolCallId === pendingToolCallId,
    );
    if (toolIndex < 0) {
      this.activeBundle().messages.push(nextMessage);
      this.rebuildMessageTimelineFromMessages();
      return;
    }

    const insertAt = toolIndex + 1;
    this.activeBundle().messages.splice(insertAt, 0, nextMessage);
    this.rebuildMessageTimelineFromMessages();
  }

  /**
   * @param full `false`：仅清思考插入锚点（新用户轮次，避免误插旧工具链）。`true`：另清 finalize 去重与 apply 批次计数（重置会话 / 打开存档）。
   */
  private resetStreamingPlacementState(full: boolean, bundle: SessionBundle = this.activeBundle()): void {
    const orchestration = this.orchestrationFor(bundle);
    orchestration.assistantMessages.resetStreamingPlacementState(full);
    bundle.nextTimelineAssistantSegmentKind = 'initial';
    if (!full) {
      return;
    }
    orchestration.conversationSnapshotView.clearStandalonePendingAuxState();
    orchestration.runtimeEvents.reset();
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
      throw new Error(i18n.t('error.skillNotFound', { name: normalized }));
    }
    return entry;
  }

  private requireToolExecutor(): DesktopToolExecutor {
    const executor = this.activeBundle().toolExecutor ?? this.toolExecutor;
    if (!executor) {
      throw new Error(i18n.t('error.mcpExecutorNotInitialized'));
    }
    return executor;
  }

  private requireExtensionHostAdapter(): DesktopExtensionHostAdapter {
    if (!desktopExtensionHostAdapter) {
      throw new Error(i18n.t('error.extensionHostNotAvailable'));
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

function normalizeApprovalDecision(
  decision: DesktopApprovalDecision | undefined,
): RuntimeApprovalDecision {
  switch (decision?.kind) {
    case 'allow':
      return {
        kind: 'allow',
        ...(decision.persistTrust ? { persistTrust: true } : {}),
      };
    case 'deny':
      return {
        kind: 'deny',
        ...(decision.resultText?.trim() ? { resultText: decision.resultText.trim() } : {}),
      };
    case 'guidance': {
      const userMessage = decision.userMessage.trim();
      if (!userMessage) {
        throw new Error(i18n.t('error.enterGuidance'));
      }
      return {
        kind: 'guidance',
        userMessage,
        ...(decision.resultText?.trim() ? { resultText: decision.resultText.trim() } : {}),
      };
    }
    default:
      throw new Error(i18n.t('error.invalidApproval'));
  }
}

function modelCapabilitiesFromConfig(
  capabilities: readonly DesktopModelCapability[],
): LlmModelCapabilities {
  return {
    ...(capabilities.includes('chat') ? { chat: true } : {}),
    ...(capabilities.includes('image') ? { imageInput: true } : {}),
    ...(capabilities.includes('video') ? { videoInput: true } : {}),
    ...(capabilities.includes('imageGeneration') ? { imageGeneration: true } : {}),
  };
}

function resolveDesktopTransportKind(
  profile?: Pick<ModelProfileSnapshot, 'provider' | 'transportKind'>,
): DesktopTransportKind {
  if (profile?.transportKind) {
    return profile.transportKind;
  }

  return profile?.provider === 'anthropic' ? 'anthropic' : 'openai-compatible';
}

function defaultApiBaseForTransport(
  provider?: DesktopModelProvider,
  transportKind?: DesktopTransportKind,
): string {
  if (!provider) {
    return DEFAULT_API_BASE;
  }

  return resolveProviderConnectApiBase(
    provider,
    transportKind ?? resolveDesktopTransportKind({ provider }),
  );
}

function reasoningProviderForTransport(
  provider: DesktopModelProvider | undefined,
  transportKind: DesktopTransportKind,
): DesktopModelProvider | undefined {
  if (transportKind === 'anthropic') {
    return 'anthropic';
  }

  if (transportKind === 'open-responses' && provider === 'openai') {
    return 'openai';
  }

  return provider;
}

function openAiCompatibleVendorFromProvider(
  provider?: DesktopModelProvider,
): Exclude<DesktopModelProvider, 'anthropic'> | undefined {
  return provider && provider !== 'anthropic' ? provider : undefined;
}

function buildPrimaryTransportConfig(input: {
  apiKey: string;
  model: string;
  baseUrl: string;
  workspaceRoot: string;
  profile?: Pick<
    ModelProfileSnapshot,
    'provider' | 'transportKind' | 'capabilities' | 'reasoningEffort' | 'supportedReasoningEfforts'
  >;
}): LlmTransportConfig {
  const transportKind = resolveDesktopTransportKind(input.profile);
  if (transportKind === 'open-responses') {
    const llmVendor = openAiCompatibleVendorFromProvider(input.profile?.provider);
    const normalizedReasoningEffort = resolveOpenAiTransportReasoningEffortForContext(
      input.profile?.reasoningEffort,
      {
        ...(input.profile?.provider ? { provider: input.profile.provider } : {}),
        transportKind: 'open-responses',
        ...(input.profile?.supportedReasoningEfforts !== undefined
          ? { supportedEfforts: input.profile.supportedReasoningEfforts }
          : {}),
        model: input.model,
      },
    );
    const responsesProvider: OpenResponsesSdkProvider | undefined =
      input.profile?.provider === 'openai'
        ? 'openai'
        : input.profile?.provider === 'xai'
          ? 'xai'
          : input.profile?.provider === 'vercel-ai-gateway'
            ? undefined
            : 'open-responses-compatible';
    const reasoningSummary = resolveOpenResponsesReasoningSummary({
      ...(llmVendor ? { llmVendor } : {}),
      model: input.model,
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
    });

    return {
      transportKind: 'open-responses',
      apiKey: input.apiKey,
      model: input.model,
      baseUrl: input.baseUrl,
      workspaceRoot: input.workspaceRoot,
      ...(responsesProvider ? { responsesProvider } : {}),
      store: false,
      ...(llmVendor ? { llmVendor } : {}),
      ...(input.profile?.capabilities
        ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
        : {}),
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
      ...(reasoningSummary ? { reasoningSummary } : {}),
    };
  }

  if (transportKind === 'anthropic') {
    const supportedAnthropicEfforts = normalizeAnthropicSupportedEfforts(
      input.profile?.supportedReasoningEfforts,
    );
    const anthropicEffort = resolveAnthropicTransportReasoningEffortForContext(
      input.profile?.reasoningEffort,
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
        ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
        : {}),
      ...(supportedAnthropicEfforts !== undefined
        ? { supportedEfforts: supportedAnthropicEfforts }
        : {}),
      ...(anthropicEffort ? { effort: anthropicEffort } : {}),
    };
  }

  const llmVendor = openAiCompatibleVendorFromProvider(input.profile?.provider);
  const normalizedReasoningEffort = resolveOpenAiTransportReasoningEffortForContext(
    input.profile?.reasoningEffort,
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
      ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
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

function supportsImageGeneration(model: { capabilities?: readonly DesktopModelCapability[] }): boolean {
  return model.capabilities?.includes('imageGeneration') === true;
}

interface LoadedPreviewModelsResult {
  modelIds: string[];
  modelCatalog?: PreviewModelCatalogEntry[];
  fromCache: boolean;
}

async function loadPreviewModelsForTransport(input: {
  provider?: DesktopModelProvider;
  transportKind: DesktopTransportKind;
  apiBase: string;
  apiKey: string;
  forceRefresh: boolean;
}): Promise<LoadedPreviewModelsResult> {
  const cached = await readModelCatalogCache(
    input.apiBase,
    input.apiKey,
    input.provider,
    input.transportKind,
  );
  const now = Date.now();
  if (cached && isModelCatalogCacheFresh(cached, now, input.forceRefresh)) {
    return {
      modelIds: cached.modelIds,
      ...(cached.modelCatalog ? { modelCatalog: cached.modelCatalog } : {}),
      fromCache: true,
    };
  }

  const listedModels = await listProviderModels({
    provider: input.provider,
    transportKind: input.transportKind,
    baseUrl: input.apiBase,
    apiKey: input.apiKey,
  });
  const modelCatalog = previewModelCatalogForProvider(input.provider, input.transportKind, listedModels);
  const modelIds = listedModels.map((entry) => entry.id);
  await writeModelCatalogCache(
    input.apiBase,
    modelIds,
    input.apiKey,
    modelCatalog,
    input.provider,
    input.transportKind,
  );
  return {
    modelIds,
    ...(modelCatalog ? { modelCatalog } : {}),
    fromCache: false,
  };
}

function previewModelCatalogForProvider(
  provider: DesktopModelProvider | undefined,
  transportKind: DesktopTransportKind,
  listedModels: readonly ProviderListedModelEntry[],
): PreviewModelCatalogEntry[] | undefined {
  return previewModelCatalogForTransport({ provider, transportKind, listedModels });
}

function previewCatalogMapForAddProviderRequest(
  request: AddProviderModelsRequest,
  provider: DesktopModelProvider | undefined,
  transportKind: DesktopTransportKind,
): Map<string, PreviewModelCatalogEntry> {
  return previewCatalogMapForTransport({
    provider,
    transportKind,
    modelCatalog: request.modelCatalog,
  });
}

async function findCatalogEntryForModel(input: {
  provider?: DesktopModelProvider;
  transportKind: DesktopTransportKind;
  apiBase: string;
  apiKey: string;
  model: string;
}): Promise<PreviewModelCatalogEntry | undefined> {
  if (!usesProviderListedModelCatalogMetadata(input)) {
    return undefined;
  }

  try {
    const preview = await loadPreviewModelsForTransport({
      provider: input.provider,
      transportKind: input.transportKind,
      apiBase: input.apiBase,
      apiKey: input.apiKey,
      forceRefresh: false,
    });
    return preview.modelCatalog?.find((entry) => entry.id === input.model);
  } catch {
    return undefined;
  }
}

function resolveAddedModelCapabilities(input: {
  provider?: DesktopModelProvider;
  requestedCapabilities?: DesktopModelCapability[];
  catalogEntry?: PreviewModelCatalogEntry;
}): DesktopModelCapability[] | undefined {
  if (input.catalogEntry?.capabilities) {
    const merged = [...input.catalogEntry.capabilities];
    if (
      input.requestedCapabilities?.includes('imageGeneration') === true
      && !merged.includes('imageGeneration')
    ) {
      merged.push('imageGeneration');
    }
    return merged;
  }

  if (input.requestedCapabilities) {
    return input.requestedCapabilities;
  }

  return input.provider === 'custom' ? defaultCustomModelCapabilities() : undefined;
}

