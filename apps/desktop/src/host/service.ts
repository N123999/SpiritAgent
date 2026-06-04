import { lstat, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  deleteFileBaselineTextForPath,
  lineDeltaForDeleteFilePath,
} from './delete-file-line-delta.js';
import i18n from '../lib/i18n-host.js';
import { resolveDesktopAgentMode } from '../lib/agent-mode.js';
import {
  buildActiveSkillsSystemMessage,
  buildBasicInfoSystemMessage,
  buildDreamCollectorSystemMessage,
  buildDreamsSystemMessage,
  buildExtensionsSystemMessage,
  buildAgentModeSystemMessage,
  buildPlanSystemMessage,
  buildRulesSystemMessage,
  buildSkillsCatalogSystemMessage,
  buildToolAgentHostPrompt,
  createLlmTransport,
  type AssistantAuxArchiveEntry,
  type ChatArchive,
  type LlmEnabledRule,
  type LlmEnabledSkillCatalogEntry,
  type LlmExtensionSystemPrompt,
  type LlmPlanMetadata,
  type LlmTransportConfig,
  type McpService,
  type RuntimeApprovalDecision,
  type RuntimeEvent,
  type PendingWorkspaceFile,
  type RuntimeToolExecution,
  type SpiritLlmTransport,
} from '@spirit-agent/agent-core';
import {
  buildStartImplementingUserTurn,
  extractActivePlanPathFromLlmHistory,
  createHostExtensionMarketplace,
  createHostExtensionManager,
  localFileAttachmentFromPath,
  restoreHostFileChanges,
  type HostDreamScope,
  type HostTodoRecord,
  type HostTodoScope,
  type HostExtensionMarketplaceManager,
  type HostExtensionEvent,
  type HostRecordedFileChange,
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
  GitHistorySnapshot,
  GitWorkingTreeSnapshot,
  ReadGitHistoryRequest,
  DesktopDreamCollectorSnapshot,
  PlanSnapshot,
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
import { createHostInvokeDispatch } from './host-invoke-dispatch.js';
import {
  addModelCommand,
  addProviderModelsCommand,
  previewModelsCommand,
  removeModelCommand,
  removeProviderModelsCommand,
  updateConfigCommand,
  type HostModelCommandContext,
} from './host-model-commands.js';
import {
  addMcpServerCommand,
  createSkillCommand,
  deleteExtensionCommand,
  deleteMcpServerCommand,
  deleteSkillCommand,
  getMarketplaceExtensionDetailCommand,
  getMarketplaceExtensionReadmeCommand,
  importExtensionCommand,
  inspectMcpServerCommand,
  installMarketplaceExtensionCommand,
  listMarketplaceExtensionsCommand,
  prepareMarketplaceExtensionInstallCommand,
  runExtensionCommand,
  submitCreateSkillSlashCommand,
  submitSkillSlashCommand,
  updateExtensionSecretCommand,
  updateExtensionSettingsCommand,
  type HostExtensionCommandContext,
} from './host-extension-commands.js';
import {
  checkoutGitBranchCommand,
  commitChangesCommand,
  listDreamsOverviewCommand,
  listSessionsCommand,
  listWorkspaceExplorerChildrenCommand,
  listWorkspaceFileReferenceSuggestionsCommand,
  mergeWorktreeToMainCommand,
  pushGitBranchCommand,
  readGitHistoryCommand,
  readGitWorkingTreeCommand,
  readWorkspaceTextFileCommand,
  refreshGitSnapshotCommand,
  rememberWorkspaceRootCommand,
  setWebHostAuthTokenHashCommand,
  writeWorkspaceTextFileCommand,
  type HostWorkspaceGitCommandContext,
} from './host-workspace-git-commands.js';
import {
  abortConversationCommand,
  applyDrainedRuntimeHostEvents,
  continueAssistantCompletionCommand,
  pollCommand,
  replyPendingApprovalCommand,
  replyPendingQuestionsCommand,
  submitUserTurnAfterInitializedCommand,
  tickSessionCommand,
  type SessionTurnOrchestratorContext,
  type SubmitUserTurnAfterInitializedOptions,
} from './session-turn-orchestrator.js';
import {
  buildArchiveAssistantAuxFromConversation,
  buildArchiveMessagesFromConversation,
  deriveDisplayNameFromSeed,
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
  buildPrimaryTransportConfig,
  modelCapabilitiesFromConfig,
  openAiCompatibleVendorFromProvider,
  resolveDesktopTransportKind,
  supportsImageGeneration,
} from './model-config.js';
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
  resolveApiKeyForConfigModel,
  createDesktopExtensionStateStore,
  saveConfig,
  spiritAgentDataDir,
  type DesktopConfigFile,
  type DesktopWebHostConfigFile,
  type DesktopWorkspaceBinding,
  type HostMetadataSummary,
} from './storage.js';
import { DesktopToolExecutor } from './tool-executor.js';
import {
  buildDesktopRuntimeBasicInfo,
  createDesktopRuntime,
  type DesktopRuntime,
} from './runtime.js';
import {
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
} from './extensions.js';
import {
  getDesktopExtensionHostAdapter,
  requireDesktopExtensionHostAdapter,
  setDesktopExtensionHostAdapter,
  type DesktopExtensionHostAdapter,
} from './extension-host-adapter.js';
import {
  emptyMcpStatusSnapshot,
  listDesktopMcpServersFromDisk,
} from './mcp-config.js';
import {
  sharedMcpServiceForWorkspace,
} from './service-mcp.js';
import {
  archiveBeforeLastUser,
  cloneArchiveHistory,
  cloneArchiveSubagentSessions,
  cloneChatArchive,
  cloneDesktopConfig,
  currentApiBase,
  mapPendingQuestions,
  sameDreamCollectorSnapshot,
  resolveWorkspaceBindingForRequestedRoot,
  sameWorkspaceRoot,
} from './service-utils.js';
import { DesktopConversationSnapshotView } from './conversation-snapshot.js';
import { buildDesktopSnapshot } from './snapshot.js';
import {
  applyToolCallSummaryCopy,
  messageOrderDebugLevel,
  messageIndexIsInCurrentTurn,
  hasActiveRunSubagentToolInMessages,
  isSubagentStatusSurfaceMessage,
  parsePendingSubagentStatusText,
  restoreMessagesFromArchive,
  summarizeMessagesTailForOrderDebug,
  summarizeToolRowsForDebug,
  truncateOneLineForDebug,
} from './message-ordering.js';
import {
  mapPendingAuxState,
  mapPendingMcpResources,
  mapPendingToolApproval,
} from './snapshot-mappers.js';
import { DesktopAssistantMessageStateMachine } from './assistant-message-state.js';
import {
  DesktopRuntimeEventOrchestrator,
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
  createWorkspaceGitWorktree,
  applyGitRevision,
  readPrimaryRepoRoot,
  readWorkspaceGitSnapshot,
} from './git.js';
import {
  generateCommitMessageFromModelTask,
  generateWorktreeNamesFromModelTask,
} from './ephemeral-llm-tasks.js';
import { persistDesktopSessionBundle } from './session-persistence.js';
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

export { setDesktopExtensionHostAdapter };

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
  private readonly invokeDispatch = createHostInvokeDispatch(this);
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
  private gitRefreshInFlight: Promise<void> | null = null;
  private gitRefreshQueued = false;
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

  private modelCommandContext(): HostModelCommandContext {
    return {
      runSerialized: (work) => this.runSerialized(work),
      ensureInitialized: () => this.ensureInitialized(),
      requireState: () => this.requireState(),
      activeBundle: () => this.activeBundle(),
      isRuntimeBusy: () => this.runtime?.isBusy() === true,
      refreshRuntime: () => this.refreshRuntime(),
      refreshModelKeyPresence: () => this.refreshModelKeyPresence(),
      flushDeferredRuntimeRefreshIfIdle: () => this.flushDeferredRuntimeRefreshIfIdle(),
      persistCurrentSessionIfNeeded: () => this.persistCurrentSessionIfNeeded(),
      setLastRuntimeError: (error) => {
        this.lastRuntimeError = error;
      },
      buildSnapshot: () => this.buildSnapshot(),
    };
  }

  private extensionCommandContext(): HostExtensionCommandContext {
    return {
      runSerialized: (work) => this.runSerialized(work),
      ensureInitialized: (workspaceRootOverride, options) => this.ensureInitialized(workspaceRootOverride, options),
      requireState: () => this.requireState(),
      isRuntimeBusy: () => this.runtime?.isBusy() === true,
      requireRuntime: () => this.requireRuntime(),
      requireToolExecutor: () => this.requireToolExecutor(),
      toolExecutor: () => this.toolExecutor,
      sharedMcpServiceForWorkspace: (workspaceRoot, workspaceBinding) =>
        this.sharedMcpServiceForWorkspace(workspaceRoot, workspaceBinding),
      extensionManager: () => this.extensionManager(),
      marketplace: () => this.marketplace(),
      requireExtensionHostAdapter: () => this.requireExtensionHostAdapter(),
      refreshExtensionsList: () => this.refreshExtensionsList(),
      refreshRuntime: () => this.refreshRuntime(),
      refreshRuntimeAfterExtensionMutation: () => this.refreshRuntimeAfterExtensionMutation(),
      persistCurrentSessionIfNeeded: () => this.persistCurrentSessionIfNeeded(),
      dispatchExtensionEvent: (event, options) => this.dispatchExtensionEvent(event, options),
      requireEnabledSkillEntry: (skillName) => this.requireEnabledSkillEntry(skillName),
      submitUserTurnAfterInitialized: (text, options) => this.submitUserTurnAfterInitialized(text, options),
      appendInlineAssistantReply: (displayText, assistantText) =>
        this.appendInlineAssistantReply(displayText, assistantText),
      setLastRuntimeError: (error) => {
        this.lastRuntimeError = error;
      },
      buildSnapshot: () => this.buildSnapshot(),
    };
  }

  private workspaceGitCommandContext(): HostWorkspaceGitCommandContext {
    return {
      runSerialized: (work) => this.runSerialized(work),
      ensureInitialized: (workspaceRootOverride, options) => this.ensureInitialized(workspaceRootOverride, options),
      requireState: () => this.requireState(),
      isRuntimeBusy: () => this.runtime?.isBusy() === true,
      activeBundle: () => this.activeBundle(),
      activeSessionId: () => this.sessionRegistry.activeSessionId(),
      bundleRuntimeIsBusy: (sessionPath) => this.sessionRegistry.get(sessionPath)?.runtime?.isBusy() === true,
      generateCommitMessageFromModel: () => this.generateCommitMessageFromModel(),
      refreshGitState: () => this.refreshGitState(),
      refreshRuntimeForActiveBundle: () => this.refreshRuntimeForBundle(this.activeBundle()),
      syncActiveRuntimePointer: () => this.syncActiveRuntimePointer(),
      startDreamCollectorIfNeeded: () => this.startDreamCollectorIfNeeded(),
      runCoalescedGitRefresh: () => this.runCoalescedGitRefresh(),
      hasState: () => Boolean(this.state),
      buildSnapshot: () => this.buildSnapshot(),
    };
  }

  private sessionTurnContext(): SessionTurnOrchestratorContext {
    return {
      runSerialized: (work) => this.runSerialized(work),
      ensureInitialized: (workspaceRootOverride, options) => this.ensureInitialized(workspaceRootOverride, options),
      requireRuntime: () => this.requireRuntime(),
      requireState: () => this.requireState(),
      activeBundle: () => this.activeBundle(),
      allBundles: () => this.sessionRegistry.all(),
      getActiveBundle: () => this.sessionRegistry.getActive(),
      activeSessionId: () => this.sessionRegistry.activeSessionId(),
      emitLiveSnapshotUpdate: () => this.emitLiveSnapshotUpdate(),
      refreshRuntimeForBundle: (bundle) => this.refreshRuntimeForBundle(bundle),
      syncActiveRuntimePointer: () => this.syncActiveRuntimePointer(),
      clearAssistantContinuationMarkers: () => this.clearAssistantContinuationMarkers(),
      resolveTodoSessionKeyForBundle: (bundle) => this.resolveTodoSessionKeyForBundle(bundle),
      ensureActiveSession: (displayText) => this.ensureActiveSession(displayText),
      reconcileTodoScopeAfterSessionPathChange: (bundle, previousSessionKey) =>
        this.reconcileTodoScopeAfterSessionPathChange(bundle, previousSessionKey),
      maybeRefreshRuntimeAfterTodoScopeChange: (bundle, previousSessionKey) =>
        this.maybeRefreshRuntimeAfterTodoScopeChange(bundle, previousSessionKey),
      buildRewindCheckpointSnapshot: () => this.buildRewindCheckpointSnapshot(),
      allocateMessageId: () => this.allocateMessageId(),
      resetStreamingPlacementState: (full) => this.resetStreamingPlacementState(full),
      persistCurrentSessionIfNeeded: () => this.persistCurrentSessionIfNeeded(),
      dispatchUserMessageExtensionEvent: (text, displayText, messageId) =>
        this.dispatchExtensionEvent({
          type: 'onUserMessage',
          detail: {
            text,
            displayText,
            messageId,
          },
        }),
      ensureToolExecutor: (bundle) => this.ensureToolExecutor(bundle),
      refreshArchiveFromRuntime: (bundle) => this.refreshArchiveFromRuntime(bundle),
      recordRewindCheckpoint: (messageId, beforeUserCheckpoint) =>
        this.recordRewindCheckpoint(messageId, beforeUserCheckpoint as DesktopRewindCheckpointSnapshot | undefined),
      orchestrationFor: (bundle) => this.orchestrationFor(bundle),
      rebuildMessageTimelineFromMessages: () => this.rebuildMessageTimelineFromMessages(),
      flushDeferredRuntimeRefreshIfIdle: (bundle) => this.flushDeferredRuntimeRefreshIfIdle(bundle),
      refreshTodoSnapshotForBundle: (bundle) => this.refreshTodoSnapshotForBundle(bundle),
      buildSnapshot: () => this.buildSnapshot(),
      startDreamCollectorIfNeeded: () => this.startDreamCollectorIfNeeded(),
      persistSessionBundle: (bundle, options) => this.persistSessionBundle(bundle, options),
      syncSubagentToolStreamingOutput: (bundle) => this.syncSubagentToolStreamingOutput(bundle),
      markInterruptedToolsInCurrentTurn: () => this.markInterruptedToolsInCurrentTurn(),
      markAssistantMessageContinuable: (content) => this.markAssistantMessageContinuable(content),
      markLatestRenderableAssistantMessageContinuableInCurrentTurn: () =>
        this.markLatestRenderableAssistantMessageContinuableInCurrentTurn(),
      latestContinuableAssistantMessage: () => this.latestContinuableAssistantMessage(),
      insertUserApprovalReplyMessage: (content, pendingToolCallId) =>
        this.insertUserApprovalReplyMessage(content, pendingToolCallId),
      normalizeApprovalDecision,
    };
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
      lineDeltaForDeleteFile: (inputPath) =>
        lineDeltaForDeleteFilePath(
          { workspaceRoot: bundle.workspaceRoot, spiritDataDir: spiritAgentDataDir() },
          inputPath,
        ),
      deleteFileBaselineForPath: (inputPath) =>
        deleteFileBaselineTextForPath(
          { workspaceRoot: bundle.workspaceRoot, spiritDataDir: spiritAgentDataDir() },
          inputPath,
        ),
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
    return rememberWorkspaceRootCommand(this.workspaceGitCommandContext(), request);
  }

  async commitChanges(request: CommitChangesRequest): Promise<DesktopSnapshot> {
    return commitChangesCommand(this.workspaceGitCommandContext(), request);
  }

  async updateConfig(request: UpdateConfigRequest): Promise<DesktopSnapshot> {
    return updateConfigCommand(this.modelCommandContext(), request);
  }

  async setWebHostAuthTokenHash(authTokenHash: string): Promise<DesktopSnapshot> {
    return setWebHostAuthTokenHashCommand(this.workspaceGitCommandContext(), authTokenHash);
  }

  async previewModels(request: PreviewModelsRequest): Promise<PreviewModelsResponse> {
    return previewModelsCommand(request);
  }

  async addProviderModels(request: AddProviderModelsRequest): Promise<DesktopSnapshot> {
    return addProviderModelsCommand(this.modelCommandContext(), request);
  }

  async addModel(request: AddModelRequest): Promise<DesktopSnapshot> {
    return addModelCommand(this.modelCommandContext(), request);
  }

  async removeModel(request: RemoveModelRequest): Promise<DesktopSnapshot> {
    return removeModelCommand(this.modelCommandContext(), request);
  }

  async removeProviderModels(request: RemoveProviderModelsRequest): Promise<DesktopSnapshot> {
    return removeProviderModelsCommand(this.modelCommandContext(), request);
  }

  async createSkill(request: CreateSkillRequest): Promise<DesktopSnapshot> {
    return createSkillCommand(this.extensionCommandContext(), request);
  }

  async addMcpServer(request: AddMcpServerRequest): Promise<DesktopSnapshot> {
    return addMcpServerCommand(this.extensionCommandContext(), request);
  }

  async deleteMcpServer(request: DeleteMcpServerRequest): Promise<DesktopSnapshot> {
    return deleteMcpServerCommand(this.extensionCommandContext(), request);
  }

  async inspectMcpServer(name: string): Promise<DesktopMcpServerInspection> {
    return inspectMcpServerCommand(this.extensionCommandContext(), name);
  }

  async importExtension(request: ImportExtensionRequest): Promise<DesktopSnapshot> {
    return importExtensionCommand(this.extensionCommandContext(), request);
  }

  async listMarketplaceExtensions(): Promise<DesktopMarketplaceCatalogItem[]> {
    return listMarketplaceExtensionsCommand(this.extensionCommandContext());
  }

  async getMarketplaceExtensionDetail(extensionId: string): Promise<DesktopMarketplaceDetail> {
    return getMarketplaceExtensionDetailCommand(this.extensionCommandContext(), extensionId);
  }

  async getMarketplaceExtensionReadme(extensionId: string): Promise<string> {
    return getMarketplaceExtensionReadmeCommand(this.extensionCommandContext(), extensionId);
  }

  async prepareMarketplaceExtensionInstall(
    request: PrepareMarketplaceExtensionInstallRequest,
  ): Promise<DesktopMarketplacePreparedInstall> {
    return prepareMarketplaceExtensionInstallCommand(this.extensionCommandContext(), request);
  }

  async installMarketplaceExtension(
    request: InstallMarketplaceExtensionRequest,
  ): Promise<DesktopSnapshot> {
    return installMarketplaceExtensionCommand(this.extensionCommandContext(), request);
  }

  async deleteExtension(request: DeleteExtensionRequest): Promise<DesktopSnapshot> {
    return deleteExtensionCommand(this.extensionCommandContext(), request);
  }

  async runExtension(request: RunExtensionRequest): Promise<DesktopSnapshot> {
    return runExtensionCommand(this.extensionCommandContext(), request);
  }

  async updateExtensionSettings(request: UpdateExtensionSettingsRequest): Promise<DesktopSnapshot> {
    return updateExtensionSettingsCommand(this.extensionCommandContext(), request);
  }

  async updateExtensionSecret(request: UpdateExtensionSecretRequest): Promise<DesktopSnapshot> {
    return updateExtensionSecretCommand(this.extensionCommandContext(), request);
  }

  async deleteSkill(request: DeleteSkillRequest): Promise<DesktopSnapshot> {
    return deleteSkillCommand(this.extensionCommandContext(), request);
  }

  async submitSkillSlash(request: SubmitSkillSlashRequest): Promise<DesktopSnapshot> {
    return submitSkillSlashCommand(this.extensionCommandContext(), request);
  }

  async submitCreateSkillSlash(request: SubmitCreateSkillSlashRequest): Promise<DesktopSnapshot> {
    return submitCreateSkillSlashCommand(this.extensionCommandContext(), request);
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
      if (resolveDesktopAgentMode(state.config) !== 'agent') {
        state.config.agentMode = 'agent';
        await saveConfig(state.config);
        state.metadata = await loadHostMetadata(state.workspaceRoot, 'agent', {
          activePlanPath: bundle.activePlanPath,
          workspaceBinding: state.workspaceBinding,
        });
        bundle.toolExecutor?.setAgentModeToolExposure('agent');
      }
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
      const agentModeSystemPrompt = buildAgentModeSystemMessage(state.metadata.planMetadata);
      const activeSkillsSystemPrompt = buildActiveSkillsSystemMessage(this.activeBundle().currentTurnSkills);
      const extensionsSystemPrompt = buildExtensionsSystemMessage(extensionSystemPrompts);
      const dreamsSystemPrompt = buildDreamsSystemMessage(
        await buildDreamContextText({
          workspaceRoot: state.workspaceRoot,
          gitBranch: state.git.branch,
        }),
      );
      const basicInfoSystemPrompt = buildBasicInfoSystemMessage(
        buildDesktopRuntimeBasicInfo(state.workspaceRoot, this.requireToolExecutor()),
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
          agentMode: agentModeSystemPrompt,
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
    return checkoutGitBranchCommand(this.workspaceGitCommandContext(), request);
  }

  async mergeWorktreeToMain(): Promise<DesktopSnapshot> {
    return mergeWorktreeToMainCommand(this.workspaceGitCommandContext());
  }

  async pushGitBranch(): Promise<DesktopSnapshot> {
    return pushGitBranchCommand(this.workspaceGitCommandContext());
  }

  async abortConversation(): Promise<DesktopSnapshot> {
    return abortConversationCommand(this.sessionTurnContext());
  }

  async continueAssistantCompletion(messageId: number): Promise<DesktopSnapshot> {
    return continueAssistantCompletionCommand(this.sessionTurnContext(), messageId);
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
    options: SubmitUserTurnAfterInitializedOptions = {},
  ): Promise<DesktopSnapshot> {
    return submitUserTurnAfterInitializedCommand(this.sessionTurnContext(), text, options);
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
    return this.buildSnapshot();
  }

  async poll(): Promise<DesktopSnapshot> {
    return pollCommand(this.sessionTurnContext());
  }

  private applyDrainedRuntimeHostEvents(
    bundle: SessionBundle,
    drained: RuntimeEvent<DesktopToolRequest>[],
  ): void {
    applyDrainedRuntimeHostEvents(this.sessionTurnContext(), bundle, drained);
  }

  private async tickSession(
    bundle: SessionBundle,
    options: { light?: boolean } = {},
  ): Promise<void> {
    return tickSessionCommand(this.sessionTurnContext(), bundle, options);
  }

  async replyPendingApproval(decision: DesktopApprovalDecision): Promise<DesktopSnapshot> {
    return replyPendingApprovalCommand(this.sessionTurnContext(), decision);
  }

  async replyPendingQuestions(result: AskQuestionsResult): Promise<DesktopSnapshot> {
    return replyPendingQuestionsCommand(this.sessionTurnContext(), result);
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
    return listSessionsCommand(this.workspaceGitCommandContext());
  }

  async listDreamsOverview(): Promise<DesktopDreamOverviewItem[]> {
    return listDreamsOverviewCommand(this.workspaceGitCommandContext());
  }

  async listWorkspaceExplorerChildren(relativePath: string): Promise<WorkspaceExplorerListResult> {
    return listWorkspaceExplorerChildrenCommand(this.workspaceGitCommandContext(), relativePath);
  }

  async readGitWorkingTree(): Promise<GitWorkingTreeSnapshot> {
    return readGitWorkingTreeCommand(this.workspaceGitCommandContext());
  }

  async readGitHistory(request: ReadGitHistoryRequest = {}): Promise<GitHistorySnapshot> {
    return readGitHistoryCommand(this.workspaceGitCommandContext(), request);
  }

  async listWorkspaceFileReferenceSuggestions(
    request: QueryWorkspaceFileReferenceSuggestionsRequest,
  ): Promise<WorkspaceFileReferenceSuggestionsResponse> {
    return listWorkspaceFileReferenceSuggestionsCommand(this.workspaceGitCommandContext(), request);
  }

  async readWorkspaceTextFile(relativePath: string): Promise<WorkspaceReadTextFileResult> {
    return readWorkspaceTextFileCommand(this.workspaceGitCommandContext(), relativePath);
  }

  async writeWorkspaceTextFile(request: WriteWorkspaceTextFileRequest): Promise<void> {
    return writeWorkspaceTextFileCommand(this.workspaceGitCommandContext(), request);
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
      agentMode: resolveDesktopAgentMode(state.config),
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
    return this.invokeDispatch(command, payload);
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
      currentState.git = applyGitRevision(git, currentState.git.revision ?? 0);
      currentState.workspaceBinding = workspaceBinding;
      currentState.plan = await loadDesktopPlanSnapshot(
        currentState.metadata.planMetadata.path,
        currentState.metadata.planMetadata.exists,
      );
      return;
    }

    const metadata = await loadHostMetadata(workspaceRoot, resolveDesktopAgentMode(config), {
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
      git: applyGitRevision(git, 0, { reset: true }),
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
      resolveDesktopAgentMode(state.config),
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
    const apiKey = await resolveApiKeyForConfigModel(state.config, state.config.activeModel);
    this.activeApiKeyConfigured = Boolean(apiKey);
    const extensionSystemPrompts = await this.collectExtensionSystemPrompts();
    const activeProfile = state.config.models.find((m) => m.name === state.config.activeModel);
    const imageGenerationProfile = state.config.imageGenerationModel
      ? state.config.models.find((model) => model.name === state.config.imageGenerationModel)
      : undefined;
    const imageGenerationApiKey = imageGenerationProfile
      ? await resolveApiKeyForConfigModel(state.config, imageGenerationProfile.name)
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
      agentMode: resolveDesktopAgentMode(state.config),
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
    bundle.toolExecutor.setAgentModeToolExposure(resolveDesktopAgentMode(this.requireState().config));
    await bundle.toolExecutor.ensureMcpToolingReady();
    return bundle.toolExecutor;
  }

  private sharedMcpServiceForWorkspace(
    workspaceRoot: string,
    workspaceBinding: DesktopWorkspaceBinding = 'project',
  ): McpService {
    return sharedMcpServiceForWorkspace(
      this.mcpServiceByWorkspaceRoot,
      workspaceRoot,
      workspaceBinding,
    );
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
          const adapter = getDesktopExtensionHostAdapter();
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

  private async refreshGitState(options: { resetRevision?: boolean } = {}): Promise<void> {
    const state = this.state;
    if (!state) {
      return;
    }
    const snapshot = await readWorkspaceGitSnapshot(state.workspaceRoot);
    state.git = applyGitRevision(snapshot, state.git.revision ?? 0, {
      reset: options.resetRevision === true,
    });
  }

  private async runCoalescedGitRefresh(options: { resetRevision?: boolean } = {}): Promise<void> {
    if (this.gitRefreshInFlight) {
      this.gitRefreshQueued = true;
      return this.gitRefreshInFlight;
    }

    this.gitRefreshInFlight = (async () => {
      try {
        do {
          this.gitRefreshQueued = false;
          await this.refreshGitState(options);
        } while (this.gitRefreshQueued);
      } finally {
        this.gitRefreshInFlight = null;
      }
    })();

    return this.gitRefreshInFlight;
  }

  async refreshGitSnapshot(): Promise<DesktopSnapshot> {
    return refreshGitSnapshotCommand(this.workspaceGitCommandContext());
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
    this.modelKeyPresence = await modelSecretKeyPresence(state.config.models);
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
      basicInfo: buildDesktopRuntimeBasicInfo(workspaceRoot, toolExecutor),
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
        const alreadyFinalized = this.activeBundle().messageTimeline.hasFinalizedAuxInActiveSegment(
          pendingAux.kind,
          auxText,
        );
        const skipDuplicatePendingThinking =
          pendingAux.kind === 'thinking' &&
          this.activeBundle().messageTimeline.hasPendingThinkingAuxInActiveSegment(auxText);
        if (!alreadyFinalized && !skipDuplicatePendingThinking) {
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
        pendingMcpResources: mapPendingMcpResources(this.runtime?.pendingMcpResources() ?? []),
        ...(pendingAux
          ? { pendingAuxState: mapPendingAuxState(pendingAux)! }
          : {}),
        ...(pendingApproval
          ? { pendingToolApproval: mapPendingToolApproval(pendingApproval) }
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
    const apiKey = await resolveApiKeyForConfigModel(state.config, state.config.activeModel);
    if (!apiKey) {
      throw new Error(i18n.t('error.autoCommitFailedNoKey'));
    }

    const extensionSystemPrompts = await this.collectExtensionSystemPrompts();
    const toolExecutor = await this.ensureToolExecutor();
    return generateCommitMessageFromModelTask({
      workspaceRoot: state.workspaceRoot,
      gitBranch: state.git.branch,
      config: state.config,
      activeProfile,
      apiKey,
      metadata: state.metadata,
      extensionSystemPrompts,
      toolExecutor,
      runtimeBasicInfo: buildDesktopRuntimeBasicInfo(state.workspaceRoot, toolExecutor),
      rememberEphemeralSession: (record) => this.rememberEphemeralSession(record),
    });
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
    state.git = applyGitRevision(
      await readWorkspaceGitSnapshot(resolved),
      0,
      { reset: true },
    );
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
    const apiKey = await resolveApiKeyForConfigModel(state.config, state.config.activeModel);
    if (!apiKey) {
      throw new Error(i18n.t('error.autoWorktreeNameFailedNoKey'));
    }

    const extensionSystemPrompts = await this.collectExtensionSystemPrompts();
    const toolExecutor = await this.ensureToolExecutor();
    return generateWorktreeNamesFromModelTask({
      workspaceRoot: state.workspaceRoot,
      gitBranch: state.git.branch,
      config: state.config,
      activeProfile,
      apiKey,
      metadata: state.metadata,
      extensionSystemPrompts,
      toolExecutor,
      runtimeBasicInfo: buildDesktopRuntimeBasicInfo(state.workspaceRoot, toolExecutor),
      rememberEphemeralSession: (record) => this.rememberEphemeralWorktreeSession(record),
      userPrompt,
      baseBranch,
      repoRoot,
    });
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
    const adapter = getDesktopExtensionHostAdapter();
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
    const adapter = getDesktopExtensionHostAdapter();
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
        state.metadata = await loadHostMetadata(state.workspaceRoot, resolveDesktopAgentMode(state.config), {
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
    const result = await persistDesktopSessionBundle({
      bundle,
      workspaceRoot: bundle.workspaceRoot || state.workspaceRoot,
      gitBranch: state.git.branch,
      fromRuntime: options.fromRuntime,
      bumpListSortAt: options.bumpListSortAt,
    });
    if (!result.nextId) {
      return;
    }
    if (result.rekeyNeeded) {
      this.sessionRegistry.rekeyBundle(bundle, result.nextId);
    } else {
      bundle.id = result.nextId;
    }
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
    return requireDesktopExtensionHostAdapter();
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

