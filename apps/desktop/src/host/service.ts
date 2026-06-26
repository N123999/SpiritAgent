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
  buildDreamsSystemMessage,
  buildExtensionsSystemMessage,
  buildAgentModeSystemMessage,
  buildPlanSystemMessage,
  buildRulesSystemMessage,
  buildSkillsCatalogSystemMessage,
  buildMcpCatalogSystemMessage,
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
} from '@spirit-agent/core';
import {
  buildStartImplementingUserTurn,
  extractActivePlanPathFromLlmHistory,
  createHostExtensionMarketplace,
  createHostExtensionManager,
  localFileAttachmentFromPath,
  classifyLocalFileComposerRoute as resolveLocalFileComposerRoute,
  type LocalFileComposerRoute,
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
  gitBranchLabelForBasicInfo,
  setGitHubFetchImplementation,
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
  CreateRuleRequest,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteRuleRequest,
  DeleteMcpServerRequest,
  DeleteHookEntryRequest,
  DesktopAutomationDetail,
  DesktopAutomationListItem,
  DesktopCreateAutomationRequest,
  DesktopDreamOverviewItem,
  DesktopUpdateAutomationRequest,
  DesktopApprovalDecision,
  DesktopMcpServerInspection,
  DesktopExtensionListItem,
  DesktopExtensionCssLayer,
  DesktopMarketplaceCatalogItem,
  DesktopMarketplaceDetail,
  DesktopMarketplacePreparedInstall,
  DesktopGitSnapshot,
  GetGitHubPullRequestDetailRequest,
  GetGitHubPullRequestTabCountsRequest,
  ListGitHubAutomationRepositoriesRequest,
  ListGitHubPullRequestsRequest,
  SearchGitHubAutomationRepositoriesRequest,
  MergeGitHubPullRequestRequest,
  GitHistorySnapshot,
  GitCommitMessageSnapshot,
  GitWorkingTreeSnapshot,
  HostTextFileStatResult,
  ReadGitHistoryRequest,
  ReadGitCommitMessageRequest,
  DesktopDreamCollectorSnapshot,
  PlanSnapshot,
  DeleteSkillRequest,
  DesktopSnapshot,
  FileRewindWarning,
  RunExtensionRequest,
  SaveHookEntryRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  PendingAssistantAux,
  QueuedUserTurnRequest,
  RewindAndSubmitMessageRequest,
  ForkSessionRequest,
  RememberWorkspaceRequest,
  ForgetWorkspaceRequest,
  RemoveModelRequest,
  RemoveProviderModelsRequest,
  QueryWorkspaceFileReferenceSuggestionsRequest,
  RecordCodeCompletionFileStateRequest,
  RequestCodeCompletionRequest,
  CodeCompletionResponse,
  SessionListItem,
  ImportExtensionRequest,
  InstallLspProviderRequest,
  InstallMarketplaceExtensionRequest,
  PrepareMarketplaceExtensionInstallRequest,
  SubmitUserTurnRequest,
  SubmitGitChipRequest,
  SubmitSkillSlashRequest,
  UpdateConfigRequest,
  WorkspaceExplorerListResult,
  WorkspaceFileReferenceSuggestionsResponse,
  WorkspaceReadTextFileResult,
  WriteHostTextFileRequest,
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
  createRuleCommand,
  createSkillCommand,
  deleteExtensionCommand,
  deleteRuleCommand,
  deleteMcpServerCommand,
  deleteHookEntryCommand,
  deleteSkillCommand,
  getMarketplaceExtensionDetailCommand,
  getMarketplaceExtensionReadmeCommand,
  importExtensionCommand,
  inspectMcpServerCommand,
  installMarketplaceExtensionCommand,
  listMarketplaceExtensionsCommand,
  prepareMarketplaceExtensionInstallCommand,
  runExtensionCommand,
  saveHookEntryCommand,
  submitSkillSlashCommand,
  updateExtensionSecretCommand,
  updateExtensionSettingsCommand,
  type HostExtensionCommandContext,
} from './host-extension-commands.js';
import { submitGitChipCommand } from './host-git-chip-commands.js';
import {
  checkoutGitBranchCommand,
  commitChangesCommand,
  listDreamsOverviewCommand,
  listSessionsCommand,
  listWorkspaceExplorerChildrenCommand,
  getWorkspaceFileReferenceIndexCommand,
  listWorkspaceFileReferenceSuggestionsCommand,
  primeWorkspaceFileReferenceIndexCommand,
  mergeWorktreeToMainCommand,
  pushGitBranchCommand,
  readGitHistoryCommand,
  readGitCommitMessageCommand,
  readGitWorkingTreeCommand,
  readHostTextFileCommand,
  readWorkspaceTextFileCommand,
  searchWorkspaceContentCommand,
  refreshGitSnapshotCommand,
  rememberWorkspaceRootCommand,
  forgetWorkspaceRootCommand,
  setWebHostAuthTokenHashCommand,
  statHostTextFileCommand,
  writeHostTextFileCommand,
  writeWorkspaceTextFileCommand,
  revealWorkspaceEntryCommand,
  renameWorkspaceEntryCommand,
  moveWorkspaceEntryCommand,
  trashWorkspaceEntryCommand,
  forceDeleteWorkspaceEntryCommand,
  type HostWorkspaceGitCommandContext,
} from './host-workspace-git-commands.js';
import {
  beginGitHubDeviceLoginCommand,
  cancelGitHubDeviceLoginCommand,
  completeGitHubDeviceLoginCommand,
  disconnectGitHubCommand,
  getGitHubAuthStatusCommand,
  getGitHubPullRequestDetailCommand,
  getGitHubPullRequestConversationCommand,
  getGitHubPullRequestFilesCommand,
  getGitHubPullRequestCommitsCommand,
  getGitHubPullRequestChecksCommand,
  getGitHubPullRequestForCurrentBranchCommand,
  listGitHubAutomationRepositoriesCommand,
  listGitHubPullRequestsCommand,
  searchGitHubAutomationRepositoriesCommand,
  getGitHubPullRequestTabCountsCommand,
  markGitHubPullRequestReadyCommand,
  mergeGitHubPullRequestCommand,
} from './host-github-commands.js';
import {
  abortConversationCommand,
  abortConversationInContext,
  applyDrainedRuntimeHostEvents,
  continueAssistantCompletionCommand,
  pollCommand,
  replyPendingApprovalCommand,
  replyPendingQuestionsCommand,
  sendQueuedUserTurnNowCommand,
  submitUserTurnAfterInitializedCommand,
  tickSessionCommand,
  type SessionTurnOrchestratorContext,
  type SubmitUserTurnAfterInitializedOptions,
} from './session-turn-orchestrator.js';
import {
  startWorktreeBootstrapTurnCommand,
  type WorktreeBootstrapHostContext,
} from './worktree-bootstrap-orchestrator.js';
import { isSessionBundleBusy } from './direct-media-turn.js';
import {
  appendQueuedUserTurnSnapshots,
  canEnqueueUserTurn,
  enqueueUserTurnCommand,
  removeQueuedUserTurnCommand,
  reorderQueuedUserTurnCommand,
} from './message-queue.js';
import {
  openSessionCommand,
  resetSessionCommand,
  type SessionActivationContext,
} from './session-activation.js';
import { forkSessionCommand, type ForkSessionHostContext } from './fork-session-host.js';
import { deleteSessionCommand, type SessionDeleteContext } from './session-delete.js';
import {
  finishSessionActivationCommand,
  isBundleRuntimeFresh,
  runtimeActivationSignature,
} from './runtime-lifecycle.js';
import {
  dreamCollectorExtensionPrompt,
  startDreamCollectorIfNeeded as startDreamCollectorIfNeededFromService,
  startDreamCollectorMonitorIfNeeded as startDreamCollectorMonitorIfNeededFromService,
  type DreamCollectorServiceContext,
} from './dream-collector-service.js';
import {
  startAutomationSchedulerMonitorIfNeeded as startAutomationSchedulerMonitorIfNeededFromService,
  type AutomationSchedulerServiceContext,
} from './automation-scheduler-service.js';
import {
  createAutomationCommand,
  deleteAutomationCommand,
  getAutomationCommand,
  listAutomationsCommand,
  setAutomationEnabledCommand,
  updateAutomationCommand,
} from './host-automation-commands.js';
import {
  clearAssistantContinuationMarkers as clearAssistantContinuationMarkersFromService,
  latestContinuableAssistantMessage as latestContinuableAssistantMessageFromService,
  logContinuationSnapshotState as logContinuationSnapshotStateFromService,
  logToolSnapshotState as logToolSnapshotStateFromService,
  markAssistantMessageContinuable as markAssistantMessageContinuableFromService,
  markLatestRenderableAssistantMessageContinuableInCurrentTurn as markLatestRenderableAssistantMessageContinuableInCurrentTurnFromService,
  refreshArchiveFromRuntime as refreshArchiveFromRuntimeFromService,
  syncSubagentToolStreamingOutput as syncSubagentToolStreamingOutputFromService,
  type ConversationContinuationContext,
} from './conversation-continuation.js';
import { syncLivePendingAuxSnapshot } from './live-snapshot-sync.js';
import {
  buildConversationTodoSnapshot as buildConversationTodoSnapshotFromService,
  cancelTodoClearing as cancelTodoClearingFromService,
  finalizeTodoScopeForNewActiveBundle as finalizeTodoScopeForNewActiveBundleFromService,
  maybeRefreshRuntimeAfterTodoScopeChange as maybeRefreshRuntimeAfterTodoScopeChangeFromService,
  reconcileTodoScopeAfterSessionPathChange as reconcileTodoScopeAfterSessionPathChangeFromService,
  refreshTodoSnapshotForBundle as refreshTodoSnapshotForBundleFromService,
  resolveTodoSessionKeyForBundle as resolveTodoSessionKeyForBundleFromService,
  scheduleTodoClearing as scheduleTodoClearingFromService,
  type SessionTodosHostContext,
} from './session-todos-host.js';
import {
  applyTodosAfterRewind as applyTodosAfterRewindFromService,
  bindFileChangesToToolMessage as bindFileChangesToToolMessageFromService,
  buildRewindCheckpointSnapshot as buildRewindCheckpointSnapshotFromService,
  recordHostFileChange as recordHostFileChangeFromService,
  recordRewindCheckpoint as recordRewindCheckpointFromService,
  restoreBeforeRewindCheckpoint as restoreBeforeRewindCheckpointFromService,
  type RewindHostContext,
} from './rewind-host.js';
import {
  ensureInitializedCommand,
  type HostInitializationContext,
} from './host-initialization.js';
import {
  buildArchiveAssistantAuxFromConversation,
  buildArchiveMessagesFromConversation,
  buildLlmHistoryFallbackFromDesktopMessages,
  deriveDisplayNameFromSeed,
  restoreStoredSessionState,
  type EphemeralSessionRecord,
  nextMessageIdFromMessages,
  removeEphemeralSessionRecord,
} from './sessions.js';
import { generateSessionTitleFromModelTask } from './session-title-generation.js';
import { applyGeneratedSessionTitle } from './session-title-service.js';
import {
  abortCodeCompletionCommand,
  recordCodeCompletionFileStateCommand,
  requestCodeCompletionCommand,
  resetCodeCompletionJournalCommand,
  type CodeCompletionCommandContext,
} from './code-completion-commands.js';
import {
  buildContextUsagePercent,
  type ContextUsageModelProfile,
  resolveModelContextLength,
} from '../lib/context-usage.js';
import {
  attachImageGenerationToTransportConfig,
  attachVideoGenerationToTransportConfig,
  buildPrimaryTransportConfig,
  resolveDesktopTransportKind,
} from './model-config.js';
import { refreshConfiguredModelCatalogsOnStartup, forceRefreshModelCatalogForProfile } from './model-catalog-startup-refresh.js';
import {
  DEFAULT_API_BASE,
  defaultNewSessionPath,
  isProvisionalSessionPath,
  provisionalNewSessionPath,
  loadHostMetadata,
  loadStoredSession,
  modelSecretKeyPresence,
  readBedrockProviderCredentialsFromKeyring,
  readGoogleVertexProviderCredentialsFromKeyring,
  resolveApiKeyForConfigModel,
  createDesktopExtensionStateStore,
  saveConfig,
  spiritAgentDataDir,
  type DesktopConfigFile,
  type DesktopWebHostConfigFile,
  type DesktopWorkspaceBinding,
  type HostMetadataSummary,
} from './storage.js';
import {
  hasBedrockRuntimeCredentials,
  hasGoogleVertexRuntimeCredentials,
  modelProviderKeyScope,
} from './provider-api-key.js';
import { DesktopToolExecutor } from './tool-executor.js';
import {
  buildDesktopRuntimeBasicInfo,
  createDesktopRuntime,
  type DesktopRuntime,
} from './runtime.js';
import { createDesktopSubagentWorkspaceBootstrap } from './subagent-worktree-bootstrap.js';
import {
  buildDreamContextText,
  clearDreamCollectorIssue,
  emptyDreamCollectorSnapshot,
  isDreamCollectorDebugSessionPath,
} from './dreams.js';
import { resolveLightweightChatModelProfile } from './lightweight-chat-model.js';
import {
  createTodoScope,
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
  ExtensionWarmupCoordinator,
  type ExtensionWarmupTrigger,
} from './extension-warmup.js';
import {
  emptyMcpStatusSnapshot,
  listDesktopMcpServersFromDisk,
} from './mcp-config.js';
import { listDesktopHookListItems } from './hooks.js';
import {
  buildDesktopHookSessionContext,
  createDesktopHookRunner,
  runDesktopSessionEndHook,
  runDesktopSessionStartHook,
} from './hook-runtime.js';
import type { HookRunner, SessionEndHookInput, SessionStartHookInput } from '@spirit-agent/core';
import {
  sharedMcpServiceForWorkspace,
} from './service-mcp.js';
import {
  disposeAllLspServices,
  disposeLspServicesExcept,
  ensureLspServiceReady,
  lspUserConfigFromEnabled,
  sharedLspServiceForWorkspace,
} from '@spirit-agent/host-internal/lsp';
import { buildDesktopLspSnapshot, defaultDesktopLspSnapshot } from './lsp-snapshot.js';
import { installLspProviderCommand } from './lsp-commands.js';
import {
  currentApiBase,
  mapPendingQuestions,
  sameDreamCollectorSnapshot,
  sameWorkspaceRoot,
} from './service-utils.js';
import {
  needsHostWorkspaceRootSync,
  resolveEffectiveWorkspaceRoot,
} from './workspace-root-sync.js';
import { DesktopConversationSnapshotView } from './conversation-snapshot.js';
import { buildDesktopSnapshot, buildModelCatalogHints } from './snapshot.js';
import {
  applyToolCallSummaryCopy,
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
import { generateWorktreeNamesFromModelTask } from './ephemeral-llm-tasks.js';
import { buildSubagentViewerSnapshot } from './subagent-viewer.js';
import { persistDesktopSessionBundle } from './session-persistence.js';
import { SessionRegistry } from './session-registry.js';
import type { SessionBundle } from './session-bundle.js';
import {
  createDesktopRewindMetadata,
  loadRewindCheckpointSnapshot,
  loadRewindFileChange,
  type DesktopRewindCheckpointSnapshot,
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
  private readonly extensionWarmup = new ExtensionWarmupCoordinator();
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
  private automationMonitorTimer: ReturnType<typeof setInterval> | undefined;
  private readonly runningAutomationIds = new Set<string>();
  private automationsListCache: DesktopAutomationListItem[] = [];
  private readonly dreamUpdateListeners = new Set<(snapshot: DesktopSnapshot) => void>();
  private readonly automationUpdateListeners = new Set<(snapshot: DesktopSnapshot) => void>();
  private readonly sessionListUpdateListeners = new Set<() => void>();
  private readonly sessionTitleGenerationInFlight = new Set<string>();
  private subagentViewerTargetToolCallId: string | null = null;
  private gitRefreshInFlight: Promise<void> | null = null;
  private contextUsageCatalogRefreshInFlight: Promise<void> | null = null;
  private modelCatalogStartupRefreshInFlight: Promise<void> | null = null;
  private pendingContextUsageCatalogRefresh:
    | {
        bundle: SessionBundle;
        usage: { inputTokens: number };
        activeModel: ContextUsageModelProfile;
      }
    | undefined;
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
  private readonly lspServiceByWorkspaceRoot = new Map<string, import('@spirit-agent/host-internal/lsp').LspService>();
  private lspSnapshot = defaultDesktopLspSnapshot();

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
      clearActiveContextUsage: () => this.clearActiveBundleContextUsage(),
      setLastRuntimeError: (error) => {
        this.lastRuntimeError = error;
      },
      buildSnapshot: () => this.buildSnapshot(),
      disposeAllLspServices: () => this.disposeAllLspServices(),
      invalidateToolExecutors: () => this.invalidateToolExecutors(),
      refreshLspSnapshot: () => this.refreshLspSnapshot(),
    };
  }

  private async refreshLspSnapshot(): Promise<void> {
    const state = this.state;
    this.lspSnapshot = state
      ? await buildDesktopLspSnapshot(state.config)
      : defaultDesktopLspSnapshot();
  }

  private async disposeAllLspServices(): Promise<void> {
    await disposeAllLspServices(this.lspServiceByWorkspaceRoot);
  }

  private invalidateToolExecutors(): void {
    this.toolExecutor = undefined;
    for (const bundle of this.sessionRegistry.all()) {
      bundle.toolExecutor = undefined;
    }
  }

  private extensionCommandContext(): HostExtensionCommandContext {
    return {
      runSerialized: (work) => this.runSerialized(work),
      ensureInitialized: (workspaceRootOverride, options) => this.ensureInitialized(workspaceRootOverride, options),
      isInitialized: () => this.initialized,
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
      bundleRuntimeIsBusy: (sessionPath) =>
        isSessionBundleBusy(this.sessionRegistry.get(sessionPath)),
      bundleForSessionPath: (sessionPath) => this.sessionRegistry.findBySessionPath(sessionPath),
      refreshGitState: () => this.refreshGitState(),
      refreshRuntimeForActiveBundle: () => this.refreshRuntimeForBundle(this.activeBundle()),
      syncActiveRuntimePointer: () => this.syncActiveRuntimePointer(),
      startDreamCollectorIfNeeded: () => this.startDreamCollectorIfNeeded(),
      runCoalescedGitRefresh: () => this.runCoalescedGitRefresh(),
      hasState: () => Boolean(this.state),
      buildSnapshot: () => this.buildSnapshot(),
    };
  }

  private codeCompletionCommandContext(): CodeCompletionCommandContext {
    const state = this.requireState();
    return {
      workspaceRoot: state.workspaceRoot,
      config: state.config,
    };
  }

  private sessionTurnContext(): SessionTurnOrchestratorContext {
    return {
      runSerialized: (work) => this.runSerialized(work),
      ensureInitialized: (workspaceRootOverride, options) => this.ensureInitialized(workspaceRootOverride, options),
      requireRuntime: () => this.requireRuntime(),
      requireState: () => this.requireState(),
      requireConfig: () => this.requireState().config,
      resolveApiKeyForConfigModel: (model) =>
        resolveApiKeyForConfigModel(this.requireState().config, model),
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
      scheduleSessionTitleGenerationIfNeeded: (seedText) =>
        this.scheduleSessionTitleGenerationIfNeeded(seedText),
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
      runSessionEndForActive: (reason) => this.runSessionEndForBundle(this.activeBundle(), reason),
      worktreeBootstrapHost: this.worktreeBootstrapHost(),
    };
  }

  private worktreeBootstrapHost(): WorktreeBootstrapHostContext {
    return {
      validateWorktreeBootstrapPreconditions: () => this.validateWorktreeBootstrapPreconditions(),
      executeWorktreeBootstrap: (userPrompt) => this.executeWorktreeBootstrapForActiveBundle(userPrompt),
      resolveWorktreeBootstrapSessionKey: () => this.activeBundle().id,
      setLastRuntimeError: (error) => {
        this.lastRuntimeError = error;
      },
    };
  }

  private validateWorktreeBootstrapPreconditions(): void {
    const state = this.requireState();
    const bundle = this.activeBundle();

    if (!state.git.isRepository) {
      throw new Error(i18n.t('error.notGitRepoForWorktree'));
    }

    const baseBranch = bundle.pendingGitBranch ?? state.git.branch;
    if (!baseBranch) {
      throw new Error(i18n.t('error.cannotDetermineBaseBranch'));
    }
    if (!state.git.branches.includes(baseBranch)) {
      throw new Error(i18n.t('error.baseBranchNotFound', { branch: baseBranch }));
    }
  }

  private getHookRunner(workspaceRoot: string): HookRunner {
    return createDesktopHookRunner(workspaceRoot);
  }

  private async runSessionEndForBundle(
    bundle: SessionBundle,
    reason: SessionEndHookInput['reason'],
  ): Promise<void> {
    const state = this.state;
    const workspaceRoot = bundle.workspaceRoot || state?.workspaceRoot || '';
    const hookRunner = this.getHookRunner(workspaceRoot);
    const context = buildDesktopHookSessionContext(bundle, state?.config.activeModel);
    await runDesktopSessionEndHook(hookRunner, context, reason);
  }

  private async runSessionStartForBundle(
    bundle: SessionBundle,
    source: SessionStartHookInput['source'],
  ): Promise<void> {
    const state = this.state;
    const workspaceRoot = bundle.workspaceRoot || state?.workspaceRoot || '';
    const hookRunner = this.getHookRunner(workspaceRoot);
    const context = buildDesktopHookSessionContext(bundle, state?.config.activeModel);
    await runDesktopSessionStartHook(bundle.runtime, hookRunner, context, source);
  }

  private sessionActivationContext(): SessionActivationContext {
    return {
      runSerialized: (work) => this.runSerialized(work),
      ensureInitialized: (workspaceRootOverride, options) => this.ensureInitialized(workspaceRootOverride, options),
      requireState: () => this.requireState(),
      isInitialized: () => this.initialized,
      currentWorkspaceRoot: () => this.state?.workspaceRoot,
      currentRuntime: () => this.runtime,
      sessionRegistry: () => this.sessionRegistry,
      persistSessionBundle: (bundle, options) => this.persistSessionBundle(bundle, options),
      finalizeTodoScopeForNewActiveBundle: (bundle, workspaceRoot) =>
        this.finalizeTodoScopeForNewActiveBundle(bundle, workspaceRoot),
      resetStreamingPlacementState: (full, bundle) => this.resetStreamingPlacementState(full, bundle),
      findEphemeralSession: (filePath) => this.findEphemeralSession(filePath),
      createMessageTimelineFromMessages: (messages, timelineSnapshot) =>
        this.createMessageTimelineFromMessages(messages, timelineSnapshot),
      syncPlanStateForBundle: (bundle) => this.syncPlanStateForBundle(bundle),
      syncHostWorkspaceRootToActiveBundle: (bundle) => this.syncHostWorkspaceRootToActiveBundle(bundle),
      tickSession: (bundle) => this.tickSession(bundle),
      syncActiveRuntimePointer: () => this.syncActiveRuntimePointer(),
      refreshTodoSnapshotForBundle: (bundle) => this.refreshTodoSnapshotForBundle(bundle),
      flushDeferredRuntimeRefreshIfIdle: (bundle) => this.flushDeferredRuntimeRefreshIfIdle(bundle),
      ensureToolExecutor: (bundle) => this.ensureToolExecutor(bundle),
      refreshRuntimeForBundle: (bundle) => this.refreshRuntimeForBundle(bundle),
      resolveTodoSessionKeyForBundle: (bundle) => this.resolveTodoSessionKeyForBundle(bundle),
      setLastRuntimeError: (error) => {
        this.lastRuntimeError = error;
      },
      scheduleSessionExtensionWarmup: (event) =>
        this.scheduleExtensionWarmup({ type: 'session', event }),
      buildSnapshot: () => this.buildSnapshot(),
      clearSubagentViewerTarget: () => this.clearSubagentViewerTarget(),
      runSessionEndForBundle: (bundle, reason) => this.runSessionEndForBundle(bundle, reason),
      runSessionStartForBundle: (bundle, source) => this.runSessionStartForBundle(bundle, source),
    };
  }

  private forkSessionContext(): ForkSessionHostContext {
    const activation = this.sessionActivationContext();
    return {
      ...activation,
      requireRuntime: () => this.requireRuntime(),
      isConversationBusy: () => {
        const runtime = this.runtime;
        const bundle = this.sessionRegistry.getActive();
        if (!runtime || !bundle) {
          return false;
        }
        if (runtime.isBusy()) {
          return true;
        }
        const snapshot = this.buildSnapshot();
        return (
          snapshot.conversation.pendingToolApproval !== undefined
          || snapshot.conversation.pendingQuestions !== undefined
        );
      },
      isActiveSessionReadOnly: () => this.activeBundle().activeSession?.readOnly === true,
      notifySessionListUpdated: () => this.notifySessionListUpdated(),
    };
  }

  private dreamCollectorContext(): DreamCollectorServiceContext {
    return {
      state: () => this.state,
      initialized: () => this.initialized,
      runtimeBusy: () => this.runtime?.isBusy() === true,
      running: () => this.dreamCollectorRunning,
      setRunning: (running) => {
        this.dreamCollectorRunning = running;
      },
      lastTickUnixMs: () => this.dreamCollectorLastTickUnixMs,
      setLastTickUnixMs: (value) => {
        this.dreamCollectorLastTickUnixMs = value;
      },
      status: () => this.dreamCollectorStatus,
      setStatus: (next) => this.setDreamCollectorStatus(next),
      createRuntime: (transportConfig, planMetadata, toolExecutor) => this.createRuntime(
        transportConfig,
        [],
        [],
        [],
        planMetadata,
        [dreamCollectorExtensionPrompt()],
        undefined,
        toolExecutor,
      ),
      runSerialized: (work) => this.runSerialized(work),
      activeBundle: () => this.activeBundle(),
      refreshRuntime: () => this.refreshRuntime(),
      clearLastRuntimeError: () => {
        this.lastRuntimeError = '';
      },
    };
  }

  private conversationContinuationContext(): ConversationContinuationContext {
    return {
      activeBundle: () => this.activeBundle(),
      activeSessionId: () => this.sessionRegistry.activeSessionId(),
      orchestrationFor: (bundle) => this.orchestrationFor(bundle),
      lastToolSnapshotLogSignature: () => this.lastToolSnapshotLogSignature,
      setLastToolSnapshotLogSignature: (signature) => {
        this.lastToolSnapshotLogSignature = signature;
      },
    };
  }

  private sessionTodosContext(): SessionTodosHostContext {
    return {
      todoClearingBySession: () => this.todoClearingBySession,
      runSerialized: (work) => this.runSerialized(work),
      getActiveBundle: () => this.sessionRegistry.getActive(),
      ensureToolExecutor: (bundle) => this.ensureToolExecutor(bundle),
      refreshRuntimeForBundle: (bundle) => this.refreshRuntimeForBundle(bundle),
      syncActiveRuntimePointer: () => this.syncActiveRuntimePointer(),
      activeSessionId: () => this.sessionRegistry.activeSessionId(),
      emitLiveSnapshotUpdate: () => this.emitLiveSnapshotUpdate(),
    };
  }

  private rewindHostContext(): RewindHostContext {
    return {
      state: () => this.state,
      requireState: () => this.requireState(),
      activeBundle: () => this.activeBundle(),
      activeSessionId: () => this.sessionRegistry.activeSessionId(),
      runtime: () => this.runtime,
      requireRuntime: () => this.requireRuntime(),
      desktopMessages: () => this.desktopMessages(),
      archiveMessages: () => this.archiveMessages(),
      archiveAssistantAux: () => this.archiveAssistantAux(),
      resolveTodoSessionKeyForBundle: (bundle) => this.resolveTodoSessionKeyForBundle(bundle),
      cancelTodoClearing: (sessionKey) => this.cancelTodoClearing(sessionKey),
      refreshTodoSnapshotForBundle: (bundle) => this.refreshTodoSnapshotForBundle(bundle),
      createMessageTimelineFromMessages: (messages) => this.createMessageTimelineFromMessages(messages),
      resetStreamingPlacementState: (full) => this.resetStreamingPlacementState(full),
    };
  }

  private hostInitializationContext(): HostInitializationContext {
    return {
      initialized: () => this.initialized,
      state: () => this.state,
      setState: (state) => {
        this.state = state;
      },
      setInitialized: (initialized) => {
        this.initialized = initialized;
      },
      setLastRuntimeError: (error) => {
        this.lastRuntimeError = error;
      },
      setToolExecutor: (executor) => {
        this.toolExecutor = executor;
      },
      sessionRegistry: () => this.sessionRegistry,
      resetStreamingPlacementState: (full) => this.resetStreamingPlacementState(full),
      refreshExtensionsList: (options) => this.refreshExtensionsList(options),
      refreshRuntime: () => this.refreshRuntime(),
      refreshLspSnapshot: () => this.refreshLspSnapshot(),
      deactivateExtensions: () => this.extensionManager().deactivateAll(),
      invalidateExtensionWarmup: () => this.invalidateExtensionWarmup(),
      scheduleExtensionWarmup: (trigger) => this.scheduleExtensionWarmup(trigger),
      loadDesktopPlanSnapshot,
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
      currentWorkspaceRoot: () => bundle.workspaceRoot,
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
      todoItemsBeforeWrite: () =>
        bundle.cachedTodoSnapshot?.items.map(({ title, status }) => ({ title, status })) ?? [],
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
      resolveActiveModel: () => {
        const state = this.state;
        if (!state) {
          return undefined;
        }
        const activeModelName = state.config.activeModel.trim();
        return state.config.models.find((model) => model.name === activeModelName);
      },
      resolveCatalogHints: () => buildModelCatalogHints(this.requireState().config),
      setContextUsage: (usage) => {
        bundle.contextUsage = usage;
      },
      refreshContextUsageCatalog: ({ usage, activeModel }) => {
        void this.refreshContextUsageCatalogForBundle(bundle, usage, activeModel);
      },
    });
    return { assistantMessages, runtimeEvents, conversationSnapshotView };
  }

  private syncActiveRuntimePointer(): void {
    this.runtime = this.sessionRegistry.getActive()?.runtime;
  }

  async bootstrap(request?: BootstrapRequest): Promise<DesktopSnapshot> {
    const snapshot = await this.runSerialized(async () => {
      await this.ensureInitialized(request?.workspaceRoot, {
        workspaceBinding: request?.workspaceBinding,
        deferExtensionWarmup: true,
        ...(request?.workspaceBinding === 'none' ? { preserveRecentWorkspaces: true } : {}),
      });
      this.startDreamCollectorMonitorIfNeeded();
      this.startAutomationSchedulerMonitorIfNeeded();
      await this.refreshAutomationsListCache();
      return this.buildSnapshot();
    });
    this.scheduleExtensionWarmup({ type: 'startup', workspaceRoot: snapshot.workspaceRoot });
    this.scheduleModelCatalogStartupRefresh();
    return snapshot;
  }

  private scheduleModelCatalogStartupRefresh(): void {
    void this.runModelCatalogStartupRefresh();
  }

  private async runModelCatalogStartupRefresh(): Promise<void> {
    if (this.modelCatalogStartupRefreshInFlight) {
      return this.modelCatalogStartupRefreshInFlight;
    }

    this.modelCatalogStartupRefreshInFlight = (async () => {
      try {
        await this.runSerialized(async () => {
          const state = this.state;
          if (!state) {
            return;
          }
          const summary = await refreshConfiguredModelCatalogsOnStartup(state.config);
          if (summary.merged > 0 || summary.synced > 0) {
            await saveConfig(state.config);
            if (this.runtime?.isBusy() !== true) {
              await this.refreshRuntime();
            }
          }
          if (summary.refreshed > 0 || summary.merged > 0 || summary.synced > 0) {
            this.emitLiveSnapshotUpdate();
          }
        });
      } catch {
        // best-effort：启动时目录刷新失败不阻断 Desktop
      } finally {
        this.modelCatalogStartupRefreshInFlight = null;
      }
    })();

    return this.modelCatalogStartupRefreshInFlight;
  }

  subscribeDreamUpdates(listener: (snapshot: DesktopSnapshot) => void): () => void {
    this.dreamUpdateListeners.add(listener);
    this.startDreamCollectorMonitorIfNeeded();
    return () => {
      this.dreamUpdateListeners.delete(listener);
    };
  }

  subscribeAutomationsUpdates(listener: (snapshot: DesktopSnapshot) => void): () => void {
    this.automationUpdateListeners.add(listener);
    this.startAutomationSchedulerMonitorIfNeeded();
    return () => {
      this.automationUpdateListeners.delete(listener);
    };
  }

  subscribeSessionListUpdates(listener: () => void): () => void {
    this.sessionListUpdateListeners.add(listener);
    return () => {
      this.sessionListUpdateListeners.delete(listener);
    };
  }

  async rememberWorkspaceRoot(request: RememberWorkspaceRequest): Promise<DesktopSnapshot> {
    return rememberWorkspaceRootCommand(this.workspaceGitCommandContext(), request);
  }

  async forgetWorkspace(request: ForgetWorkspaceRequest): Promise<DesktopSnapshot> {
    return forgetWorkspaceRootCommand(this.workspaceGitCommandContext(), request);
  }

  async commitChanges(request: CommitChangesRequest): Promise<DesktopSnapshot> {
    return commitChangesCommand(this.workspaceGitCommandContext(), request);
  }

  async updateConfig(request: UpdateConfigRequest): Promise<DesktopSnapshot> {
    return updateConfigCommand(this.modelCommandContext(), request);
  }

  async installLspProvider(request: InstallLspProviderRequest): Promise<DesktopSnapshot> {
    return installLspProviderCommand(this.modelCommandContext(), request);
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

  async createRule(request: CreateRuleRequest): Promise<DesktopSnapshot> {
    return createRuleCommand(this.extensionCommandContext(), request);
  }

  async deleteRule(request: DeleteRuleRequest): Promise<DesktopSnapshot> {
    return deleteRuleCommand(this.extensionCommandContext(), request);
  }

  async addMcpServer(request: AddMcpServerRequest): Promise<DesktopSnapshot> {
    return addMcpServerCommand(this.extensionCommandContext(), request);
  }

  async deleteMcpServer(request: DeleteMcpServerRequest): Promise<DesktopSnapshot> {
    return deleteMcpServerCommand(this.extensionCommandContext(), request);
  }

  async saveHookEntry(request: SaveHookEntryRequest): Promise<DesktopSnapshot> {
    return saveHookEntryCommand(this.extensionCommandContext(), request);
  }

  async deleteHookEntry(request: DeleteHookEntryRequest): Promise<DesktopSnapshot> {
    return deleteHookEntryCommand(this.extensionCommandContext(), request);
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

  async submitGitChip(request: SubmitGitChipRequest): Promise<DesktopSnapshot> {
    const snapshot = await submitGitChipCommand(this.extensionCommandContext(), request);
    void this.runCoalescedGitRefresh();
    return snapshot;
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
      const mcpCatalogSystemPrompt = buildMcpCatalogSystemMessage(
        this.requireToolExecutor().mcpToolCatalogSnapshot(),
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
        buildDesktopRuntimeBasicInfo(
          state.workspaceRoot,
          this.requireToolExecutor(),
          gitBranchLabelForBasicInfo(state.git),
        ),
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
          ...(mcpCatalogSystemPrompt === undefined ? {} : { mcpCatalog: mcpCatalogSystemPrompt }),
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

      const explicitWorkspaceFiles = await this.resolveExplicitLocalFileAttachments(
        request.localFilePaths,
      );
      if (canEnqueueUserTurn(bundle)) {
        return enqueueUserTurnCommand(this.sessionTurnContext(), {
          text: request.text,
          explicitWorkspaceFiles,
        });
      }

      const isFirstTurn = bundle.messages.length === 0;
      if (isFirstTurn && bundle.workLocation === 'worktree') {
        return startWorktreeBootstrapTurnCommand(
          this.sessionTurnContext(),
          this.worktreeBootstrapHost(),
          request.text,
          { explicitWorkspaceFiles },
        );
      }

      return this.submitUserTurnAfterInitialized(request.text, {
        explicitWorkspaceFiles,
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

  async reorderQueuedUserTurn(request: QueuedUserTurnRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      return reorderQueuedUserTurnCommand(this.sessionTurnContext(), request.queueId);
    });
  }

  async sendQueuedUserTurnNow(request: QueuedUserTurnRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      return sendQueuedUserTurnNowCommand(this.sessionTurnContext(), request.queueId);
    });
  }

  async removeQueuedUserTurn(request: QueuedUserTurnRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      return removeQueuedUserTurnCommand(this.sessionTurnContext(), request.queueId);
    });
  }

  async continueAssistantCompletion(messageId: number): Promise<DesktopSnapshot> {
    return continueAssistantCompletionCommand(this.sessionTurnContext(), messageId);
  }

  async forkSession(request: ForkSessionRequest): Promise<DesktopSnapshot> {
    return forkSessionCommand(this.forkSessionContext(), request);
  }

  async rewindAndSubmitMessage(request: RewindAndSubmitMessageRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await this.ensureInitialized(undefined, { fastPath: true });
      const state = this.requireState();
      const runtime = this.requireRuntime();
      if (runtime.isBusy()) {
        const aborted = await abortConversationInContext(this.sessionTurnContext());
        if (!aborted && this.requireRuntime().isBusy()) {
          throw new Error(i18n.t('error.runtimeBusy'));
        }
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

  async setSubagentViewerTarget(parentToolCallId: string | null): Promise<DesktopSnapshot> {
    const trimmed = parentToolCallId?.trim();
    this.subagentViewerTargetToolCallId = trimmed && trimmed.length > 0 ? trimmed : null;
    const snapshot = await this.buildSnapshot();
    return snapshot;
  }

  async abortShell(toolCallId: string): Promise<DesktopSnapshot> {
    const bundle = this.activeBundle();
    const toolExecutor = await this.ensureToolExecutor(bundle);
    toolExecutor.abortShell(toolCallId);
    return this.buildSnapshot();
  }

  private clearSubagentViewerTarget(): void {
    this.subagentViewerTargetToolCallId = null;
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
    return resetSessionCommand(this.sessionActivationContext());
  }

  async listSessions(): Promise<SessionListItem[]> {
    return listSessionsCommand(this.workspaceGitCommandContext());
  }

  async listDreamsOverview(): Promise<DesktopDreamOverviewItem[]> {
    return listDreamsOverviewCommand(this.workspaceGitCommandContext());
  }

  async listAutomations(): Promise<DesktopAutomationListItem[]> {
    return listAutomationsCommand();
  }

  async getAutomation(automationId: string): Promise<DesktopAutomationDetail | undefined> {
    return getAutomationCommand(automationId);
  }

  async createAutomation(request: DesktopCreateAutomationRequest): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await createAutomationCommand(request);
      await this.refreshAutomationsListCache();
      this.emitAutomationUpdate();
      return this.buildSnapshot();
    });
  }

  async updateAutomation(
    automationId: string,
    patch: DesktopUpdateAutomationRequest,
  ): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await updateAutomationCommand(automationId, patch);
      await this.refreshAutomationsListCache();
      this.emitAutomationUpdate();
      return this.buildSnapshot();
    });
  }

  async deleteAutomation(automationId: string): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await deleteAutomationCommand(automationId);
      await this.refreshAutomationsListCache();
      this.emitAutomationUpdate();
      return this.buildSnapshot();
    });
  }

  async setAutomationEnabled(automationId: string, enabled: boolean): Promise<DesktopSnapshot> {
    return this.runSerialized(async () => {
      await setAutomationEnabledCommand(automationId, enabled);
      await this.refreshAutomationsListCache();
      this.emitAutomationUpdate();
      return this.buildSnapshot();
    });
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

  async readGitCommitMessage(request: ReadGitCommitMessageRequest): Promise<GitCommitMessageSnapshot> {
    return readGitCommitMessageCommand(this.workspaceGitCommandContext(), request);
  }

  async getGitHubAuthStatus() {
    return getGitHubAuthStatusCommand();
  }

  async beginGitHubDeviceLogin() {
    return beginGitHubDeviceLoginCommand();
  }

  async completeGitHubDeviceLogin() {
    return completeGitHubDeviceLoginCommand();
  }

  async cancelGitHubDeviceLogin() {
    cancelGitHubDeviceLoginCommand();
  }

  async disconnectGitHub() {
    return disconnectGitHubCommand();
  }

  async getGitHubPullRequestForCurrentBranch() {
    await this.ensureInitialized();
    const state = this.requireState();
    return getGitHubPullRequestForCurrentBranchCommand({
      workspaceRoot: state.workspaceRoot,
      git: state.git,
    });
  }

  async getGitHubPullRequestDetail(request: GetGitHubPullRequestDetailRequest) {
    return getGitHubPullRequestDetailCommand(request);
  }

  async getGitHubPullRequestConversation(request: GetGitHubPullRequestDetailRequest) {
    return getGitHubPullRequestConversationCommand(request);
  }

  async getGitHubPullRequestFiles(request: GetGitHubPullRequestDetailRequest) {
    return getGitHubPullRequestFilesCommand(request);
  }

  async getGitHubPullRequestCommits(request: GetGitHubPullRequestDetailRequest) {
    return getGitHubPullRequestCommitsCommand(request);
  }

  async getGitHubPullRequestChecks(request: GetGitHubPullRequestDetailRequest) {
    return getGitHubPullRequestChecksCommand(request);
  }

  async mergeGitHubPullRequest(request: MergeGitHubPullRequestRequest) {
    return mergeGitHubPullRequestCommand(request);
  }

  async markGitHubPullRequestReady(request: GetGitHubPullRequestDetailRequest) {
    return markGitHubPullRequestReadyCommand(request);
  }

  async listGitHubPullRequests(request: ListGitHubPullRequestsRequest) {
    return listGitHubPullRequestsCommand(request);
  }

  async listGitHubAutomationRepositories(request: ListGitHubAutomationRepositoriesRequest = {}) {
    return listGitHubAutomationRepositoriesCommand(request);
  }

  async searchGitHubAutomationRepositories(request: SearchGitHubAutomationRepositoriesRequest) {
    return searchGitHubAutomationRepositoriesCommand(request);
  }

  async getGitHubPullRequestTabCounts(request: GetGitHubPullRequestTabCountsRequest) {
    return getGitHubPullRequestTabCountsCommand(request);
  }

  async listWorkspaceFileReferenceSuggestions(
    request: QueryWorkspaceFileReferenceSuggestionsRequest,
  ): Promise<WorkspaceFileReferenceSuggestionsResponse> {
    return listWorkspaceFileReferenceSuggestionsCommand(this.workspaceGitCommandContext(), request);
  }

  async requestCodeCompletion(request: RequestCodeCompletionRequest): Promise<CodeCompletionResponse> {
    return requestCodeCompletionCommand(this.codeCompletionCommandContext(), request);
  }

  async abortCodeCompletion(): Promise<void> {
    abortCodeCompletionCommand(this.requireState().workspaceRoot);
  }

  async recordCodeCompletionFileState(request: RecordCodeCompletionFileStateRequest): Promise<void> {
    recordCodeCompletionFileStateCommand(this.codeCompletionCommandContext(), request);
  }

  async resetCodeCompletionJournal(): Promise<void> {
    resetCodeCompletionJournalCommand(this.codeCompletionCommandContext());
  }

  async primeWorkspaceFileReferenceIndex(): Promise<void> {
    return primeWorkspaceFileReferenceIndexCommand(this.workspaceGitCommandContext());
  }

  async getWorkspaceFileReferenceIndex(): Promise<import('../types.js').WorkspaceFileReferenceIndexSnapshot> {
    return getWorkspaceFileReferenceIndexCommand(this.workspaceGitCommandContext());
  }

  async readWorkspaceTextFile(
    relativePath: string,
    options?: import('../types.js').ReadWorkspaceTextFileOptions,
  ): Promise<WorkspaceReadTextFileResult> {
    return readWorkspaceTextFileCommand(this.workspaceGitCommandContext(), relativePath, options);
  }

  async searchWorkspaceContent(
    request: import('../types.js').WorkspaceContentSearchRequest,
  ): Promise<import('../types.js').WorkspaceContentSearchResult> {
    return searchWorkspaceContentCommand(this.workspaceGitCommandContext(), request);
  }

  async writeWorkspaceTextFile(request: WriteWorkspaceTextFileRequest): Promise<void> {
    return writeWorkspaceTextFileCommand(this.workspaceGitCommandContext(), request);
  }

  async revealWorkspaceEntry(relativePath: string, workspaceRoot?: string): Promise<void> {
    return revealWorkspaceEntryCommand(
      this.workspaceGitCommandContext(),
      relativePath,
      workspaceRoot,
    );
  }

  async renameWorkspaceEntry(
    relativePath: string,
    newName: string,
  ): Promise<{ relativePath: string }> {
    return renameWorkspaceEntryCommand(this.workspaceGitCommandContext(), relativePath, newName);
  }

  async moveWorkspaceEntry(
    relativePath: string,
    targetDirectoryRel: string,
  ): Promise<{ relativePath: string }> {
    return moveWorkspaceEntryCommand(
      this.workspaceGitCommandContext(),
      relativePath,
      targetDirectoryRel,
    );
  }

  async trashWorkspaceEntry(relativePath: string): Promise<void> {
    return trashWorkspaceEntryCommand(this.workspaceGitCommandContext(), relativePath);
  }

  async forceDeleteWorkspaceEntry(relativePath: string): Promise<void> {
    return forceDeleteWorkspaceEntryCommand(this.workspaceGitCommandContext(), relativePath);
  }

  async readHostTextFile(absolutePath: string): Promise<WorkspaceReadTextFileResult> {
    return readHostTextFileCommand(this.workspaceGitCommandContext(), absolutePath);
  }

  async writeHostTextFile(request: WriteHostTextFileRequest): Promise<void> {
    return writeHostTextFileCommand(this.workspaceGitCommandContext(), request);
  }

  async statHostTextFile(absolutePath: string): Promise<HostTextFileStatResult> {
    return statHostTextFileCommand(this.workspaceGitCommandContext(), absolutePath);
  }

  async classifyLocalFileComposerRoute(absolutePath: string): Promise<LocalFileComposerRoute> {
    return resolveLocalFileComposerRoute(absolutePath);
  }

  async openSession(filePath: string): Promise<DesktopSnapshot> {
    return openSessionCommand(this.sessionActivationContext(), filePath);
  }

  async deleteSession(filePath: string): Promise<DesktopSnapshot> {
    return deleteSessionCommand(this.sessionDeleteContext(), filePath);
  }

  private sessionDeleteContext(): SessionDeleteContext {
    return {
      ...this.sessionActivationContext(),
      removeEphemeralSession: (filePath) => {
        const state = this.requireState();
        state.ephemeralSessions = removeEphemeralSessionRecord(state.ephemeralSessions, filePath);
      },
      bundleRuntimeIsBusy: (sessionPath) => {
        const bundle = this.sessionRegistry.findBySessionPath(sessionPath);
        return isSessionBundleBusy(bundle);
      },
    };
  }

  private runtimeActivationSignature(bundle: SessionBundle): string {
    return runtimeActivationSignature(this.sessionActivationContext(), bundle);
  }

  private isBundleRuntimeFresh(bundle: SessionBundle): boolean {
    return isBundleRuntimeFresh(this.sessionActivationContext(), bundle);
  }

  /** After registry switch: wire runtime for new loads, resume in-flight runs without resetting timeline. */
  private async finishSessionActivation(bundle: SessionBundle): Promise<void> {
    return finishSessionActivationCommand(this.sessionActivationContext(), bundle);
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
      /** Skip extension warmup scheduling; caller will schedule after serialized work completes. */
      deferExtensionWarmup?: boolean;
      workspaceBinding?: DesktopWorkspaceBinding;
    } = {},
  ): Promise<void> {
    return ensureInitializedCommand(this.hostInitializationContext(), workspaceRootOverride, options);
  }

  private async refreshRuntime(): Promise<void> {
    const bundle = this.activeBundle();
    const hadRuntime = bundle.runtime !== undefined;
    await this.refreshRuntimeForBundle(bundle);
    this.syncActiveRuntimePointer();
    if (hadRuntime && bundle.runtime) {
      await this.runSessionStartForBundle(bundle, 'resume');
    }
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
    const hadRuntime = bundle.runtime !== undefined;
    if (hadRuntime) {
      await this.runSessionEndForBundle(bundle, 'switch');
    }
    await this.syncPlanStateForBundle(bundle);
    await this.ensureToolExecutor(bundle, { skipMcpCatalogRefresh: true });
    // 保留 bundle.currentTurnSkills：斜杠激活的 turn skill 须在 promote/refresh 后仍进入 createRuntime。
    const activeProfile = state.config.models.find((m) => m.name === state.config.activeModel);
    const activeTransportKind = resolveDesktopTransportKind(activeProfile);
    const bedrockCredentials = activeTransportKind === 'bedrock' && activeProfile?.provider
      ? readBedrockProviderCredentialsFromKeyring(modelProviderKeyScope(activeProfile.provider))
      : undefined;
    const googleVertexCredentials = activeProfile?.provider === 'google-vertex-ai'
      ? readGoogleVertexProviderCredentialsFromKeyring('google-vertex-ai')
      : undefined;
    const apiKey = await resolveApiKeyForConfigModel(state.config, state.config.activeModel);
    const azureResourceNameReady = activeProfile?.provider !== 'azure'
      || Boolean(activeProfile.azureResourceName?.trim());
    const runtimeAuthReady = activeTransportKind === 'bedrock'
      ? Boolean(activeProfile?.awsRegion?.trim())
        && hasBedrockRuntimeCredentials({
          apiKey,
          accessKeyId: bedrockCredentials?.accessKeyId,
          secretAccessKey: bedrockCredentials?.secretAccessKey,
        })
      : activeProfile?.provider === 'google-vertex-ai'
        ? hasGoogleVertexRuntimeCredentials({
            apiKey,
            clientEmail: googleVertexCredentials?.clientEmail,
            privateKey: googleVertexCredentials?.privateKey,
            vertexProject: activeProfile?.vertexProject,
            vertexLocation: activeProfile?.vertexLocation,
          })
      : activeProfile?.provider === 'azure'
        ? azureResourceNameReady && Boolean(apiKey)
        : Boolean(apiKey);
    this.activeApiKeyConfigured = runtimeAuthReady;
    const extensionSystemPrompts = this.extensionWarmup.systemPromptsCache;
    const imageGenerationProfile = state.config.imageGenerationModel
      ? state.config.models.find((model) => model.name === state.config.imageGenerationModel)
      : undefined;
    const videoGenerationProfile = state.config.videoGenerationModel
      ? state.config.models.find((model) => model.name === state.config.videoGenerationModel)
      : undefined;
    const imageGenerationApiKey = imageGenerationProfile
      ? await resolveApiKeyForConfigModel(state.config, imageGenerationProfile.name)
      : undefined;
    const videoGenerationApiKey = videoGenerationProfile
      ? await resolveApiKeyForConfigModel(state.config, videoGenerationProfile.name)
      : undefined;
    bundle.runtimeTransport = createLlmTransport();
    if (!runtimeAuthReady) {
      bundle.runtime = undefined;
      if (bundle.id === this.sessionRegistry.activeSessionId()) {
        this.runtime = undefined;
      }
      this.lastRuntimeError = activeProfile?.provider === 'azure' && !azureResourceNameReady
        ? i18n.t('error.azureResourceNameRequired')
        : i18n.t('error.apiKeyNotConfigured');
      await this.refreshModelKeyPresence();
      return;
    }

    let runtimeTransportConfig = buildPrimaryTransportConfig({
      apiKey: apiKey ?? bedrockCredentials?.apiKey ?? '',
      model: state.config.activeModel,
      baseUrl: currentApiBase(state.config),
      workspaceRoot: bundle.workspaceRoot || state.workspaceRoot,
      profile: activeProfile,
      agentMode: resolveDesktopAgentMode(state.config),
      ...(activeTransportKind === 'bedrock' && bedrockCredentials
        ? { bedrockCredentials: { ...bedrockCredentials, apiKey: apiKey ?? bedrockCredentials.apiKey } }
        : {}),
      ...(activeProfile?.provider === 'google-vertex-ai' && googleVertexCredentials
        ? { googleVertexCredentials }
        : {}),
    });
    runtimeTransportConfig = attachImageGenerationToTransportConfig(runtimeTransportConfig, {
      profile: imageGenerationProfile,
      apiKey: imageGenerationApiKey,
    });
    runtimeTransportConfig = attachVideoGenerationToTransportConfig(runtimeTransportConfig, {
      profile: videoGenerationProfile,
      apiKey: videoGenerationApiKey,
    });
    bundle.runtimeTransport = createLlmTransport(runtimeTransportConfig);

    const desktopMessages = bundle.messageTimeline.toMessages();
    const llmHistoryForRuntime = bundle.archiveHistory.length > 0
      ? bundle.archiveHistory
      : buildLlmHistoryFallbackFromDesktopMessages(desktopMessages);
    const runtime = this.createRuntime(
      runtimeTransportConfig,
      llmHistoryForRuntime,
      state.metadata.rules.enabledRules,
      state.metadata.skills.enabledSkillCatalog,
      state.metadata.planMetadata,
      extensionSystemPrompts,
      await buildDreamContextText({
        workspaceRoot: bundle.workspaceRoot || state.workspaceRoot,
        gitBranch: state.git.branch,
      }),
      await this.ensureToolExecutor(bundle, { skipMcpCatalogRefresh: true }),
      bundle.runtimeTransport,
      bundle,
    );
    if (bundle.archiveSubagentSessions.length > 0 || llmHistoryForRuntime.length > 0) {
      runtime.replaceFromArchive({
        messages: buildArchiveMessagesFromConversation(desktopMessages),
        assistantAux: buildArchiveAssistantAuxFromConversation(desktopMessages),
        llmHistory: llmHistoryForRuntime,
        subagentSessions: bundle.archiveSubagentSessions ?? [],
        loopEnabled: bundle.loopEnabled,
      });
      if (bundle.archiveHistory.length === 0 && llmHistoryForRuntime.length > 0) {
        bundle.archiveHistory = llmHistoryForRuntime;
      }
    }
    runtime.setLoopEnabled(bundle.loopEnabled);
    const toolExecutor = await this.ensureToolExecutor(bundle, { skipMcpCatalogRefresh: true });
    toolExecutor.setApprovalLevel(bundle.approvalLevel);
    bundle.runtime = runtime;
    bundle.lastSeenMcpCatalogRevision = toolExecutor.mcpCatalogRevision();
    if (bundle.id === this.sessionRegistry.activeSessionId()) {
      this.runtime = runtime;
    }
    this.lastRuntimeError = '';
    await this.refreshModelKeyPresence();
    await this.refreshTodoSnapshotForBundle(bundle);
    bundle.runtimeActivationSignature = this.runtimeActivationSignature(bundle);
  }

  private async ensureToolExecutor(
    bundle: SessionBundle = this.activeBundle(),
    options?: { skipMcpCatalogRefresh?: boolean },
  ): Promise<DesktopToolExecutor> {
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
      if (
        bundle.toolExecutorWorkspaceRoot
        && bundle.toolExecutorWorkspaceRoot !== workspaceRoot
      ) {
        await disposeLspServicesExcept(this.lspServiceByWorkspaceRoot, workspaceRoot);
      }
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
    if (!options?.skipMcpCatalogRefresh) {
      await this.maybeRefreshRuntimeForMcpCatalogChange(bundle);
    }
    return bundle.toolExecutor;
  }

  private async maybeRefreshRuntimeForMcpCatalogChange(bundle: SessionBundle): Promise<void> {
    if (!bundle.toolExecutor) {
      return;
    }
    const revision = bundle.toolExecutor.mcpCatalogRevision();
    const previous = bundle.lastSeenMcpCatalogRevision;
    if (previous === undefined) {
      bundle.lastSeenMcpCatalogRevision = revision;
      return;
    }
    if (revision === previous || !bundle.runtime) {
      return;
    }
    if (bundle.runtime.isBusy()) {
      bundle.deferredRuntimeRefreshWhileBusy = true;
      return;
    }
    bundle.lastSeenMcpCatalogRevision = revision;
    await this.refreshRuntimeForBundle(bundle);
    if (bundle.id === this.sessionRegistry.activeSessionId()) {
      this.syncActiveRuntimePointer();
    }
    this.lastRuntimeError = '';
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

  private sharedLspServiceForWorkspace(workspaceRoot: string) {
    const userConfig = lspUserConfigFromEnabled(this.requireState().config.agents.lsp.enabled);
    return sharedLspServiceForWorkspace(this.lspServiceByWorkspaceRoot, workspaceRoot, userConfig);
  }

  private async buildToolExecutorForBundle(
    bundle: SessionBundle,
    dreamScope?: HostDreamScope,
    todoScope?: HostTodoScope,
  ): Promise<DesktopToolExecutor> {
    const state = this.requireState();
    const workspaceRoot = bundle.workspaceRoot || state.workspaceRoot;
    const extensions = await this.extensionManager().list();
    const lsp = await ensureLspServiceReady(this.sharedLspServiceForWorkspace(workspaceRoot));
    return new DesktopToolExecutor(workspaceRoot, {
      mcp: this.sharedMcpServiceForWorkspace(workspaceRoot, state.workspaceBinding),
      ...(lsp ? { lsp } : {}),
      extensionToolDefinitions: buildDesktopExtensionToolDefinitions(extensions),
      fileChangeObserver: {
        recordFileChange: (change) => {
          void lsp?.syncFromRecordedChange(change);
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
      hostContributedToolsEnabled: true,
      getAutomationCreateDefaults: () => {
        const currentState = this.requireState();
        const lightweightModel = resolveLightweightChatModelProfile(currentState.config);
        if (!lightweightModel) {
          throw new Error(i18n.t('error.lightweightChatModelNotConfigured'));
        }
        return {
          workspaceRoot,
          modelName: lightweightModel.name,
          ...(lightweightModel.profile.reasoningEffort
            ? { reasoningEffort: lightweightModel.profile.reasoningEffort }
            : {}),
        };
      },
      onAutomationCreated: () => {
        void this.runSerialized(async () => {
          await this.refreshAutomationsListCache();
          this.emitAutomationUpdate();
        });
      },
      ...(todoScope ? { todoScope } : {}),
    });
  }

  private async buildScopedSubagentToolExecutor(
    workspaceRoot: string,
    transportConfig: LlmTransportConfig | undefined,
    parentExecutor: DesktopToolExecutor,
  ): Promise<DesktopToolExecutor> {
    const state = this.requireState();
    const extensions = await this.extensionManager().list();
    const lsp = await ensureLspServiceReady(this.sharedLspServiceForWorkspace(workspaceRoot));
    const scoped = new DesktopToolExecutor(workspaceRoot, {
      mcp: this.sharedMcpServiceForWorkspace(workspaceRoot, state.workspaceBinding),
      ...(lsp ? { lsp } : {}),
      extensionToolDefinitions: buildDesktopExtensionToolDefinitions(extensions),
      hostContributedToolsEnabled: true,
    });
    scoped.setApprovalLevel(parentExecutor.approvalLevelSnapshot());
    scoped.setAgentModeToolExposure(resolveDesktopAgentMode(state.config));
    scoped.setLoopToolExposure(this.activeBundle().loopEnabled);
    if (transportConfig) {
      scoped.setActiveTransportConfig(transportConfig);
    }
    return scoped;
  }

  private createSubagentWorkspaceBootstrap(
    parentExecutor: DesktopToolExecutor,
    transportConfig: LlmTransportConfig,
  ) {
    const state = this.requireState();
    return createDesktopSubagentWorkspaceBootstrap({
      parentWorkspaceRoot: state.workspaceRoot,
      isGitRepository: state.git.isRepository,
      resolveBaseBranch: () => {
        const bundle = this.activeBundle();
        return bundle.pendingGitBranch ?? state.git.branch;
      },
      generateWorktreeNames: (task, baseBranch, repoRoot) =>
        this.generateWorktreeNamesFromModel(task, baseBranch, repoRoot),
      buildScopedToolExecutor: (workspaceRoot) =>
        this.buildScopedSubagentToolExecutor(workspaceRoot, transportConfig, parentExecutor),
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
    startDreamCollectorIfNeededFromService(this.dreamCollectorContext());
  }

  private startDreamCollectorMonitorIfNeeded(): void {
    startDreamCollectorMonitorIfNeededFromService(
      this.dreamCollectorMonitorTimer,
      (timer) => {
        this.dreamCollectorMonitorTimer = timer;
      },
      this.dreamCollectorContext(),
    );
  }

  private startAutomationSchedulerMonitorIfNeeded(): void {
    startAutomationSchedulerMonitorIfNeededFromService(
      this.automationMonitorTimer,
      (timer) => {
        this.automationMonitorTimer = timer;
      },
      this.automationSchedulerContext(),
    );
  }

  private automationSchedulerContext(): AutomationSchedulerServiceContext {
    return {
      initialized: () => this.initialized,
      config: () => this.state?.config,
      runningAutomationIds: () => this.runningAutomationIds,
      markAutomationRunning: (automationId, running) => {
        if (running) {
          this.runningAutomationIds.add(automationId);
        } else {
          this.runningAutomationIds.delete(automationId);
        }
      },
      onAutomationUpdated: (automationId) => {
        void this.runSerialized(async () => {
          await this.refreshAutomationsListCache();
          this.emitAutomationUpdate();
          void automationId;
        });
      },
      notifySessionListUpdated: () => {
        this.notifySessionListUpdated();
      },
      syncSessionFromDisk: (sessionPath) => this.syncAutomationSessionFromDisk(sessionPath),
    };
  }

  private async syncAutomationSessionFromDisk(sessionPath: string): Promise<void> {
    const loaded = await loadStoredSession(sessionPath);
    const workspaceRoot = loaded.workspaceRoot ?? this.requireState().workspaceRoot;
    const restored = restoreStoredSessionState({
      filePath: sessionPath,
      loaded,
    });
    const synced = this.sessionRegistry.reloadWarmBundleFromRestoredIfIdle(
      sessionPath,
      workspaceRoot,
      restored,
      (messages, timelineSnapshot) => this.createMessageTimelineFromMessages(messages, timelineSnapshot),
    );
    if (!synced) {
      return;
    }
    const bundle = this.sessionRegistry.findBySessionPath(sessionPath);
    if (!bundle) {
      return;
    }
    if (this.sessionRegistry.activeSessionId() === path.resolve(sessionPath)) {
      await this.refreshRuntimeForBundle(bundle);
      this.syncActiveRuntimePointer();
      this.emitLiveSnapshotUpdate();
    }
  }

  private async refreshAutomationsListCache(): Promise<void> {
    this.automationsListCache = await listAutomationsCommand();
  }

  private emitAutomationUpdate(): void {
    if (!this.state || this.automationUpdateListeners.size === 0) {
      return;
    }
    const snapshot = this.buildSnapshot();
    for (const listener of this.automationUpdateListeners) {
      listener(snapshot);
    }
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

  private notifySessionListUpdated(): void {
    if (this.sessionListUpdateListeners.size === 0) {
      return;
    }
    for (const listener of this.sessionListUpdateListeners) {
      listener();
    }
  }

  private scheduleSessionTitleGenerationIfNeeded(seedText: string): void {
    const bundle = this.activeBundle();
    const activeSession = bundle.activeSession;
    if (!activeSession || activeSession.readOnly === true || activeSession.kind === 'ephemeral') {
      return;
    }

    const userMessageCount = bundle.messageTimeline
      .toMessages()
      .filter((message) => message.role === 'user').length;
    if (userMessageCount !== 1) {
      return;
    }

    if (bundle.sessionTitleSource !== 'seed') {
      return;
    }

    if (!resolveLightweightChatModelProfile(this.requireState().config)) {
      return;
    }

    const filePath = path.resolve(activeSession.filePath);
    if (this.sessionTitleGenerationInFlight.has(filePath)) {
      return;
    }

    this.sessionTitleGenerationInFlight.add(filePath);
    void this.generateAndApplySessionTitle(bundle, seedText, filePath)
      .catch((error) => {
        console.debug(
          '[session-title] generation failed:',
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        this.sessionTitleGenerationInFlight.delete(filePath);
      });
  }

  private async generateAndApplySessionTitle(
    bundle: SessionBundle,
    seedText: string,
    filePath: string,
  ): Promise<void> {
    const state = this.requireState();
    const fallbackSeed = bundle.activeSession?.displayName ?? deriveDisplayNameFromSeed(seedText);
    const result = await generateSessionTitleFromModelTask({
      config: state.config,
      workspaceRoot: bundle.workspaceRoot || state.workspaceRoot,
      firstUserMessage: seedText,
      fallbackSeedTitle: fallbackSeed,
    });
    await applyGeneratedSessionTitle({
      sessionPath: filePath,
      title: result.title,
      registry: this.sessionRegistry,
      runSerialized: (work) => this.runSerialized(work),
      persistBundle: (target) =>
        this.persistSessionBundle(target, {
          fromRuntime: target.runtime,
          bumpListSortAt: false,
        }),
      notifySessionListUpdated: () => this.notifySessionListUpdated(),
    });
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

  private clearActiveBundleContextUsage(): void {
    const bundle = this.sessionRegistry.getActive();
    if (!bundle) {
      return;
    }
    bundle.contextUsage = undefined;
  }

  private async refreshContextUsageCatalogForBundle(
    bundle: SessionBundle,
    usage: { inputTokens: number },
    activeModel: ContextUsageModelProfile,
  ): Promise<void> {
    if (!activeModel.provider) {
      return;
    }
    this.pendingContextUsageCatalogRefresh = { bundle, usage, activeModel };
    await this.runCoalescedContextUsageCatalogRefresh();
  }

  private async runCoalescedContextUsageCatalogRefresh(): Promise<void> {
    if (this.contextUsageCatalogRefreshInFlight) {
      return this.contextUsageCatalogRefreshInFlight;
    }

    this.contextUsageCatalogRefreshInFlight = (async () => {
      try {
        while (this.pendingContextUsageCatalogRefresh) {
          const pending = this.pendingContextUsageCatalogRefresh;
          this.pendingContextUsageCatalogRefresh = undefined;
          await this.runSerialized(async () => {
            await this.applyContextUsageCatalogRefresh(pending);
          });
        }
      } finally {
        this.contextUsageCatalogRefreshInFlight = null;
      }
    })();

    return this.contextUsageCatalogRefreshInFlight;
  }

  private async applyContextUsageCatalogRefresh(input: {
    bundle: SessionBundle;
    usage: { inputTokens: number };
    activeModel: ContextUsageModelProfile;
  }): Promise<void> {
    const { bundle, usage, activeModel } = input;
    const state = this.state;
    if (!state || !activeModel.provider) {
      return;
    }
    const profile = state.config.models.find((model) => model.name === activeModel.name);
    if (!profile) {
      return;
    }
    const refreshed = await forceRefreshModelCatalogForProfile(state.config, profile);
    if (!refreshed) {
      return;
    }
    const contextLength = resolveModelContextLength(
      activeModel,
      buildModelCatalogHints(state.config),
    );
    if (contextLength === undefined) {
      return;
    }
    bundle.contextUsage = {
      inputTokens: usage.inputTokens,
      contextLength,
      percent: buildContextUsagePercent(usage.inputTokens, contextLength),
    };
    if (bundle.id === this.sessionRegistry.activeSessionId()) {
      this.emitLiveSnapshotUpdate();
    }
  }

  private createRuntime(
    transportConfig: LlmTransportConfig,
    history: ChatArchive['llmHistory'],
    enabledRules: LlmEnabledRule[],
    enabledSkillCatalog: LlmEnabledSkillCatalogEntry[],
    planMetadata: LlmPlanMetadata,
    extensionSystemPrompts: LlmExtensionSystemPrompt[],
    dreamsContextText?: string,
    toolExecutor: DesktopToolExecutor = this.requireToolExecutor(),
    llmTransport: SpiritLlmTransport = createLlmTransport(transportConfig),
    bundle: SessionBundle = this.activeBundle(),
  ): DesktopRuntime {
    const workspaceRoot = transportConfig.workspaceRoot ?? this.requireState().workspaceRoot;
    toolExecutor.setActiveTransportConfig(transportConfig);
    const hookRunner = this.getHookRunner(workspaceRoot);
    const hookSessionContext = buildDesktopHookSessionContext(bundle, transportConfig.model);
    return createDesktopRuntime({
      transportConfig,
      history,
      enabledRules,
      enabledSkillCatalog,
      mcpToolCatalog: toolExecutor.mcpToolCatalogSnapshot(),
      planMetadata,
      extensionSystemPrompts,
      ...(dreamsContextText === undefined ? {} : { dreamsContextText }),
      toolExecutor,
      llmTransport,
      activeSkills: bundle.currentTurnSkills,
      workspaceRoot,
      basicInfo: buildDesktopRuntimeBasicInfo(
        workspaceRoot,
        toolExecutor,
        gitBranchLabelForBasicInfo(this.requireState().git),
      ),
      getLoopEnabled: () => bundle.loopEnabled,
      hookRunner,
      hookSessionContext,
      bootstrapSubagentWorkspace: this.createSubagentWorkspaceBootstrap(toolExecutor, transportConfig),
    });
  }

  private resolveTodoSessionKeyForBundle(bundle: SessionBundle): string {
    return resolveTodoSessionKeyForBundleFromService(bundle);
  }

  private async maybeRefreshRuntimeAfterTodoScopeChange(
    bundle: SessionBundle,
    previousSessionKey: string,
  ): Promise<void> {
    return maybeRefreshRuntimeAfterTodoScopeChangeFromService(this.sessionTodosContext(), bundle, previousSessionKey);
  }

  private async finalizeTodoScopeForNewActiveBundle(
    bundle: SessionBundle,
    workspaceRoot: string,
  ): Promise<void> {
    return finalizeTodoScopeForNewActiveBundleFromService(this.sessionTodosContext(), bundle, workspaceRoot);
  }

  private async reconcileTodoScopeAfterSessionPathChange(
    bundle: SessionBundle,
    previousSessionKey: string,
  ): Promise<void> {
    return reconcileTodoScopeAfterSessionPathChangeFromService(this.sessionTodosContext(), bundle, previousSessionKey);
  }

  private cancelTodoClearing(sessionKey: string): void {
    cancelTodoClearingFromService(this.sessionTodosContext(), sessionKey);
  }

  private scheduleTodoClearing(sessionKey: string, items: HostTodoRecord[]): void {
    scheduleTodoClearingFromService(this.sessionTodosContext(), sessionKey, items);
  }

  private async refreshTodoSnapshotForBundle(bundle: SessionBundle): Promise<void> {
    return refreshTodoSnapshotForBundleFromService(this.sessionTodosContext(), bundle);
  }

  private async buildConversationTodoSnapshot(
    bundle: SessionBundle,
  ): Promise<ConversationTodoSnapshot | undefined> {
    return buildConversationTodoSnapshotFromService(this.sessionTodosContext(), bundle);
  }

  private buildSnapshot(): DesktopSnapshot {
    const state = this.requireState();
    const pendingApproval = this.runtime?.currentPendingApproval();
    const pendingQuestions = this.runtime?.currentPendingQuestions();
    const pendingAux = this.runtime?.pendingAuxState();
    syncLivePendingAuxSnapshot({
      pendingAux,
      activeBundle: this.activeBundle(),
      assistantMessages: this.activeOrchestration().assistantMessages,
      conversationSnapshotView: this.activeOrchestration().conversationSnapshotView,
    });

    const activeBundle = this.activeBundle();
    const rawMessages = activeBundle.messages;
    const rawConversationMessages = this.desktopMessages();

    const conversationMessages = appendQueuedUserTurnSnapshots(
      this.activeOrchestration().conversationSnapshotView.buildMessagesWithPendingAssistant({
        messages: rawConversationMessages,
        livePendingAux: pendingAux,
        rewind: activeBundle.rewind,
      }),
      activeBundle.queuedUserTurns,
    );
    const conversationBusy = isSessionBundleBusy(activeBundle);

    this.logContinuationSnapshotState({
      rawMessages: rawConversationMessages,
      visibleMessages: conversationMessages,
      isBusy: conversationBusy,
      pendingAux,
    });
    this.logToolSnapshotState({
      rawMessages,
      timelineMessages: rawConversationMessages,
      visibleMessages: conversationMessages,
      isBusy: conversationBusy,
    });

    return buildDesktopSnapshot({
      workspaceRoot: state.workspaceRoot,
      config: state.config,
      git: this.buildClientGitSnapshot(),
      metadata: state.metadata,
      plan: state.plan,
      extensionsList: state.extensionsList,
      extensionCss: state.extensionCss,
      ...(this.extensionWarmup.extensionsLoading ? { extensionsLoading: true } : {}),
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
      hooksList: listDesktopHookListItems(state.workspaceRoot, state.workspaceBinding),
      lsp: this.lspSnapshot,
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
          ? {
              pendingToolApproval: mapPendingToolApproval({
                toolName: pendingApproval.toolName,
                request: pendingApproval.request as DesktopToolRequest,
                prompt: pendingApproval.prompt,
                trustTarget: pendingApproval.trustTarget,
                subagentSessionId: pendingApproval.subagentSessionId,
              }),
            }
          : {}),
        ...(pendingQuestions
          ? { pendingQuestions: mapPendingQuestions(pendingQuestions) }
          : {}),
        isBusy: conversationBusy,
        ...(this.activeBundle().rewindWarnings.length > 0
          ? { rewindWarnings: this.activeBundle().rewindWarnings.map((warning) => ({ ...warning })) }
          : {}),
        ...(activeBundle.cachedTodoSnapshot ? { todos: activeBundle.cachedTodoSnapshot } : {}),
        ...(activeBundle.contextUsage ? { contextUsage: { ...activeBundle.contextUsage } } : {}),
      },
      ...(activeBundle.activeSession ? { activeSession: activeBundle.activeSession } : {}),
      composerSessionKey: this.resolveTodoSessionKeyForBundle(activeBundle),
      ...(this.subagentViewerTargetToolCallId
        ? (() => {
            const subagentViewer = buildSubagentViewerSnapshot(
              activeBundle,
              this.subagentViewerTargetToolCallId,
            );
            return subagentViewer ? { subagentViewer } : {};
          })()
        : {}),
      automationsList: this.automationsListCache.map((item) => ({ ...item })),
    });
  }

  private findEphemeralSession(filePath: string): EphemeralSessionRecord | undefined {
    return this.state?.ephemeralSessions.find((session) => session.path === filePath);
  }

  private async executeWorktreeBootstrapForActiveBundle(userPrompt: string): Promise<void> {
    const state = this.requireState();
    const bundle = this.activeBundle();

    const repoRoot = await readPrimaryRepoRoot(state.workspaceRoot);
    const worktreeContext = await readWorkspaceGitSnapshot(state.workspaceRoot);
    if (worktreeContext.isWorktreeSession) {
      throw new Error(i18n.t('error.alreadyInWorktree'));
    }

    const baseBranch = bundle.pendingGitBranch ?? state.git.branch;
    if (!baseBranch) {
      throw new Error(i18n.t('error.cannotDetermineBaseBranch'));
    }

    const names = await this.generateWorktreeNamesFromModel(userPrompt, baseBranch, repoRoot);
    const created = await createWorkspaceGitWorktree(repoRoot, names, baseBranch);

    bundle.pendingGitBranch = undefined;
    bundle.workLocation = 'local';
    bundle.workspaceRoot = created.worktreePath;

    await this.adoptWorkspaceRootForActiveBundle(created.worktreePath);
    this.startDreamCollectorIfNeeded();
  }

  private async syncHostWorkspaceRootToActiveBundle(
    bundle: SessionBundle = this.activeBundle(),
  ): Promise<boolean> {
    const state = this.requireState();
    if (!needsHostWorkspaceRootSync(bundle, state)) {
      return false;
    }
    await this.adoptWorkspaceRootForActiveBundle(resolveEffectiveWorkspaceRoot(bundle, state));
    return true;
  }

  private async adoptWorkspaceRootForActiveBundle(workspaceRoot: string): Promise<void> {
    const resolved = path.resolve(workspaceRoot);
    const state = this.requireState();
    const bundle = this.activeBundle();
    const switchingWorkspace = !sameWorkspaceRoot(state.workspaceRoot, resolved);

    if (switchingWorkspace) {
      await this.extensionManager().deactivateAll();
      this.invalidateExtensionWarmup();
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
      await this.refreshExtensionsList({ metadataOnly: true });
      this.scheduleExtensionWarmup({ type: 'startup', workspaceRoot: resolved });
    }
  }

  private async generateWorktreeNamesFromModel(
    userPrompt: string,
    baseBranch: string,
    repoRoot: string,
  ): Promise<{ worktreeName: string; branchName: string }> {
    const state = this.requireState();
    const lightweightModel = resolveLightweightChatModelProfile(state.config);
    if (!lightweightModel) {
      throw new Error(i18n.t('error.lightweightChatModelNotConfigured'));
    }
    const apiKey = await resolveApiKeyForConfigModel(state.config, lightweightModel.name);
    if (!apiKey) {
      throw new Error(i18n.t('error.autoWorktreeNameFailedNoKey'));
    }

    const extensionSystemPrompts = await this.collectExtensionSystemPrompts();
    const toolExecutor = await this.ensureToolExecutor();
    return generateWorktreeNamesFromModelTask({
      workspaceRoot: state.workspaceRoot,
      gitBranch: state.git.branch,
      config: state.config,
      taskModel: lightweightModel.name,
      taskProfile: lightweightModel.profile,
      apiKey,
      metadata: state.metadata,
      extensionSystemPrompts,
      toolExecutor,
      runtimeBasicInfo: buildDesktopRuntimeBasicInfo(
        state.workspaceRoot,
        toolExecutor,
        gitBranchLabelForBasicInfo(state.git),
      ),
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

  private async refreshExtensionsList(options?: { metadataOnly?: boolean }): Promise<void> {
    const state = this.requireState();
    const extensions = await this.extensionManager().list();
    state.extensionsList = await buildDesktopExtensionListItems(
      this.extensionManager(),
      extensions,
      options,
    );
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
    await this.refreshExtensionSystemPromptsCache();
    await this.refreshExtensionsList();

    if (this.runtime?.isBusy()) {
      this.activeBundle().deferredRuntimeRefreshWhileBusy = true;
      return;
    }

    this.activeBundle().deferredRuntimeRefreshWhileBusy = false;
    await this.refreshRuntime();
    this.lastRuntimeError = '';
  }

  private invalidateExtensionWarmup(): void {
    this.extensionWarmup.invalidate();
  }

  private scheduleExtensionWarmup(trigger: ExtensionWarmupTrigger): void {
    this.extensionWarmup.schedule(trigger, {
      collectSystemPrompts: () => this.collectExtensionSystemPrompts(),
      refreshExtensionsListFull: () => this.refreshExtensionsList(),
      dispatchEvent: (event) => this.dispatchExtensionEvent(event),
      applyWarmupToRuntime: () => this.applyExtensionWarmupToRuntime(),
      emitSnapshotUpdate: () => this.emitLiveSnapshotUpdate(),
    });
  }

  private async refreshExtensionSystemPromptsCache(): Promise<void> {
    await this.extensionWarmup.refreshSystemPromptsCache({
      collectSystemPrompts: () => this.collectExtensionSystemPrompts(),
    });
  }

  private async applyExtensionWarmupToRuntime(): Promise<void> {
    const bundle = this.activeBundle();
    if (bundle.runtime?.isBusy()) {
      bundle.deferredRuntimeRefreshWhileBusy = true;
      return;
    }
    bundle.deferredRuntimeRefreshWhileBusy = false;
    await this.refreshRuntimeForBundle(bundle);
    if (bundle.id === this.sessionRegistry.activeSessionId()) {
      this.syncActiveRuntimePointer();
    }
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

    const existingUserCount = bundle.messageTimeline
      .toMessages()
      .filter((message) => message.role === 'user').length;
    const nextPath = defaultNewSessionPath();
    activeSession.filePath = nextPath;
    if (existingUserCount === 0) {
      activeSession.displayName = deriveDisplayNameFromSeed(seedText);
    }
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
    clearAssistantContinuationMarkersFromService(this.conversationContinuationContext());
  }

  private markAssistantMessageContinuable(content: string): void {
    markAssistantMessageContinuableFromService(this.conversationContinuationContext(), content);
  }

  private latestContinuableAssistantMessage(): ConversationMessageSnapshot | undefined {
    return latestContinuableAssistantMessageFromService(this.conversationContinuationContext());
  }

  private markLatestRenderableAssistantMessageContinuableInCurrentTurn(): void {
    markLatestRenderableAssistantMessageContinuableInCurrentTurnFromService(this.conversationContinuationContext());
  }

  private logContinuationSnapshotState(input: {
    rawMessages: ConversationMessageSnapshot[];
    visibleMessages: ConversationMessageSnapshot[];
    isBusy: boolean;
    pendingAux: PendingAssistantAux | undefined;
  }): void {
    logContinuationSnapshotStateFromService(input);
  }

  private logToolSnapshotState(input: {
    rawMessages: ConversationMessageSnapshot[];
    timelineMessages: ConversationMessageSnapshot[];
    visibleMessages: ConversationMessageSnapshot[];
    isBusy: boolean;
  }): void {
    logToolSnapshotStateFromService(this.conversationContinuationContext(), input);
  }

  private syncSubagentToolStreamingOutput(bundle: SessionBundle): void {
    syncSubagentToolStreamingOutputFromService(this.conversationContinuationContext(), bundle);
  }

  private refreshArchiveFromRuntime(bundle: SessionBundle = this.activeBundle()): void {
    refreshArchiveFromRuntimeFromService(this.conversationContinuationContext(), bundle);
  }

  private async recordHostFileChange(bundle: SessionBundle, change: HostRecordedFileChange): Promise<void> {
    return recordHostFileChangeFromService(this.rewindHostContext(), bundle, change);
  }

  private bindFileChangesToToolMessage(
    bundle: SessionBundle,
    execution: RuntimeToolExecution<DesktopToolRequest>,
    messageId: number,
  ): void {
    bindFileChangesToToolMessageFromService(bundle, execution, messageId);
  }

  private async recordRewindCheckpoint(
    messageId: number,
    beforeUserCheckpoint?: DesktopRewindCheckpointSnapshot,
  ): Promise<void> {
    return recordRewindCheckpointFromService(this.rewindHostContext(), messageId, beforeUserCheckpoint);
  }

  private async applyTodosAfterRewind(snapshot: DesktopRewindCheckpointSnapshot): Promise<void> {
    return applyTodosAfterRewindFromService(this.rewindHostContext(), snapshot);
  }

  private async buildRewindCheckpointSnapshot(): Promise<DesktopRewindCheckpointSnapshot> {
    return buildRewindCheckpointSnapshotFromService(this.rewindHostContext());
  }

  private restoreBeforeRewindCheckpoint(
    snapshot: DesktopRewindCheckpointSnapshot,
    checkpointSequence: number,
  ): void {
    restoreBeforeRewindCheckpointFromService(this.rewindHostContext(), snapshot, checkpointSequence);
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

    const bundle = this.activeBundle();
    const inserted = bundle.messageTimeline.insertApprovalGuidanceUserReply(
      trimmed,
      pendingToolCallId,
      this.allocateMessageId(),
    );
    if (!inserted) {
      return;
    }
    bundle.messages = this.desktopMessages();
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

export function setDesktopGitHubFetchImplementation(
  fetchImpl: typeof fetch | undefined,
): void {
  setGitHubFetchImplementation(fetchImpl);
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

export function subscribeDesktopAutomationsUpdates(
  listener: (snapshot: DesktopSnapshot) => void,
): () => void {
  return desktopHostService.subscribeAutomationsUpdates(listener);
}

export function subscribeDesktopSessionListUpdates(listener: () => void): () => void {
  return desktopHostService.subscribeSessionListUpdates(listener);
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

