import { stdin, stdout } from 'node:process';
import { release as osRelease } from 'node:os';
import { pathToFileURL } from 'node:url';

import {
  resolveOpenAiModelCompatibilityProfile,
  type OpenAiModelCompatibilityProfile,
} from './openai/index.js';
import {
  assistantToolCallMessageFromLlmState,
  appendLlmToolResultMessage,
  appendLlmUserMessage,
  appendLlmUserLlmMessage,
  buildActiveSkillsSystemMessage,
  buildBasicInfoSystemMessage,
  buildExtensionsSystemMessage,
  buildAgentModeSystemMessage,
  buildPlanSystemMessage,
  buildRulesSystemMessage,
  buildSkillsCatalogSystemMessage,
  buildToolAgentHostPrompt,
  continueLlmToolAgentState,
  extractLastLlmAssistantText,
  rebuildLlmToolAgentStateAfterCompaction,
  startLlmToolAgentState,
  truncateLlmHistoryForCompaction,
  truncateLlmToolAgentStateForContextRetry,
  type LlmActiveSkill,
  type LlmEnabledRule,
  type LlmEnabledSkillCatalogEntry,
  type LlmExtensionSystemPrompt,
  type LlmPlanMetadata,
  type LlmToolAgentBasicInfo,
  type LlmToolAgentState,
} from './llm-tool-agent.js';
import { buildContributedHostToolDefinitions, buildTodoHostToolDefinitions } from './host-tools.js';
import { buildTodosSystemMessage } from './tool-agent.js';
import {
  buildApplyPatchFileToolsPromptSection,
  shouldUseApplyPatchFileTools,
} from './open-responses/apply-patch-eligibility.js';
import { buildProviderWebSearchPromptSection } from './open-responses/web-search-eligibility.js';
import type { LlmTransportConfig } from './provider-config.js';
import {
  normalizeSpiritAgentMode,
  readSpiritAgentModeFromTransportConfig,
  type SpiritAgentMode,
} from './ports.js';
import {
  configureLlmClientVersion,
  configureLlmHttpVersion,
  normalizeLlmHttpVersion,
} from './llm-fetch.js';
import { createLlmTransport } from './transport-factory.js';
import type {
  GeneratedImageSaveRequest,
  JsonObject,
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
import {
  HostToolExecutorProxy,
  type LocalHostToolService,
} from './host-bridge/host-tool-executor.js';
import type { LspHostBindings } from './host-bridge/lsp-host-bindings.js';
import type {
  BridgeRuntimeSnapshot,
  DrainEventsResult,
  RuntimeExportArchiveParams,
  RuntimeAddPendingImageParams,
  RuntimeApplyMcpPromptParams,
  RuntimeAttachMcpResourceParams,
  RuntimeInitParams,
  RuntimeNamedMcpServerParams,
  RuntimeSubagentSessionParams,
  RuntimeReplaceConfigParams,
  RuntimeReplacePlanMetadataParams,
  RuntimeRespondToPendingApprovalParams,
  RuntimeRespondToPendingQuestionsParams,
  RuntimeSetLoopEnabledParams,
  RuntimeActivateSkillParams,
  RuntimeStartManualMcpToolParams,
  RuntimeStartManualToolCommandParams,
  RuntimeSubmitUserTurnParams,
} from './host-bridge/protocol.js';

type HostRuntime = AgentRuntime<LlmTransportConfig, LlmToolAgentState, JsonValue, JsonValue>;

interface ToolExecutionMetadata {
  backgroundExecution: boolean;
  backgroundStatusText?: string;
}

const peer = new JsonRpcPeer(stdin, stdout);
const toolExecutor = new HostToolExecutorProxy(peer);
const ENV_HOST_INTERNAL_MODULE_PATH = 'SPIRIT_HOST_INTERNAL_MODULE_PATH';
const ENV_HOST_INTERNAL_SPIRIT_DATA_DIR = 'SPIRIT_HOST_INTERNAL_SPIRIT_DATA_DIR';
let runtime: HostRuntime | undefined;
let transportConfig: LlmTransportConfig | undefined;
let currentHostToolModelCompatibilityProfile: OpenAiModelCompatibilityProfile | undefined;
let enabledRules: LlmEnabledRule[] = [];
let enabledSkillCatalog: LlmEnabledSkillCatalogEntry[] = [];
let activeSkills: LlmActiveSkill[] = [];
let planMetadata: LlmPlanMetadata | undefined;
let activePlanPath: string | undefined;
let extensionSystemPrompts: LlmExtensionSystemPrompt[] = [];
let currentTodoSessionKey: string | undefined;

interface CliHostInternalModule {
  NodeHostToolService: new (
    context: { workspaceRoot: string; spiritDataDir: string },
    options?: {
      mcp?: unknown;
      extensions?: {
        manager: unknown;
        getHost: () => unknown;
        logger?: Pick<Console, 'error' | 'log'>;
      };
      getModelCompatibilityProfile?: () => OpenAiModelCompatibilityProfile | undefined;
      getApprovalLevel?: () => 'default' | 'full-approval';
      todoScope?: { sessionKey: string };
      fileChangeObserver?: { recordFileChange(change: unknown): Promise<void> };
    },
  ) => LocalHostToolService;
  createNoopMcpAdapter?: () => unknown;
  createHostTodoStore?: (input: {
    spiritDataDir: string;
    scope: { sessionKey: string };
  }) => {
    list(options?: { includeCompleted?: boolean }): Promise<unknown[]>;
    replaceAll(records: unknown[]): Promise<unknown[]>;
    purge(): Promise<void>;
  };
  buildTodoContextText?: (records: unknown[]) => string | undefined;
  loadHostInstructionMetadata: (
    context: { workspaceRoot: string; spiritDataDir: string },
    options?: { planMode?: boolean; agentMode?: SpiritAgentMode; activePlanPath?: string },
  ) => Promise<{
    rules: { enabledRules: LlmEnabledRule[] };
    skills: { enabledSkillCatalog: LlmEnabledSkillCatalogEntry[] };
    planMetadata: LlmPlanMetadata;
  }>;
  discoverRuleEntries: (context: { workspaceRoot: string; spiritDataDir: string }) => Promise<JsonValue>;
  discoverSkillEntries: (context: { workspaceRoot: string; spiritDataDir: string }) => Promise<JsonValue>;
  planMetadataSnapshot: (
    context: { workspaceRoot: string; spiritDataDir: string },
    agentMode: SpiritAgentMode | boolean,
    options?: { useApplyPatchFileTools?: boolean; activePlanPath?: string },
  ) => LlmPlanMetadata;
  listWorkspaceFileReferenceSuggestions?: (
    workspaceRoot: string,
    input: string,
    cursorChars: number,
  ) => Promise<
    | {
        query: { start: number; end: number; raw: string };
        suggestions: string[];
      }
    | undefined
  >;
  listCachedWorkspaceFileReferenceSuggestions?: (
    workspaceRoot: string,
    input: string,
    cursorChars: number,
  ) => Promise<
    | {
        query: { start: number; end: number; raw: string };
        suggestions: string[];
      }
    | undefined
  >;
  resolveWorkspaceFileReferenceAttachmentsFromInput?: (
    workspaceRoot: string,
    text: string,
  ) => Promise<
    Array<
      | {
          kind: 'text';
          path: string;
          totalChars: number;
          truncated: boolean;
          attachedAtUnixMs: number;
          content: string;
        }
      | {
          kind: 'image';
          path: string;
          attachedAtUnixMs: number;
        }
      | {
          kind: 'video';
          path: string;
          attachedAtUnixMs: number;
        }
    >
  >;
  collectHostExtensionContributedTools?: (
    extensions: Array<{
      id: string;
      manifest: {
        name: string;
        requestedCapabilities?: string[];
        contributes?: {
          tools?: Array<{
            name: string;
            description: string;
            inputSchema: JsonObject;
            outputSchema?: JsonObject;
            approvalMode?: string;
            executionMode?: string;
          }>;
        };
      };
    }>,
  ) => Array<{
    name: string;
    description: string;
    inputSchema: JsonObject;
  }>;
  createHostExtensionManager?: (context: { spiritDataDir: string; hostKind: 'cli' | 'desktop' }) => {
    list(): Promise<
      Array<{
        id: string;
        manifest: {
          name: string;
          icon?: string;
          version: string;
          description?: string;
          author?: string;
          homepage?: string;
          main?: string;
          supportedHosts: Array<'cli' | 'desktop'>;
          activationEvents?: string[];
          requestedCapabilities?: string[];
          contributes?: {
            tools?: Array<{
              name: string;
              description: string;
              inputSchema: JsonObject;
              outputSchema?: JsonObject;
              approvalMode?: string;
              executionMode?: string;
            }>;
            desktop?: {
              css?: Array<{
                path: string;
                media?: string;
              }>;
            };
            cli?: {
              hooks?: Array<{
                slot: string;
                variant?: string;
                tokens?: {
                  foreground?: string;
                  border?: string;
                  accent?: string;
                };
                prefix?: string;
                suffix?: string;
              }>;
            };
          };
          settingsSchema?: Array<{
            key: string;
            type: string;
            title: string;
            description?: string;
            placeholder?: string;
            required?: boolean;
            defaultValue?: string | boolean | number;
            options?: Array<{
              value: string;
              label: string;
              description?: string;
            }>;
          }>;
          secretSlots?: Array<{
            key: string;
            title: string;
            description?: string;
            required?: boolean;
          }>;
        };
        installedAtUnixMs: number;
        archiveFileName?: string;
      }>
    >;
    importArchive(request: {
      archiveBase64: string;
      fileName?: string;
    }): Promise<{
      id: string;
      manifest: {
        name: string;
        icon?: string;
        version: string;
        description?: string;
        author?: string;
        homepage?: string;
        main?: string;
        supportedHosts: Array<'cli' | 'desktop'>;
        activationEvents?: string[];
        requestedCapabilities?: string[];
        contributes?: {
          tools?: Array<{
            name: string;
            description: string;
            inputSchema: JsonObject;
            outputSchema?: JsonObject;
            approvalMode?: string;
            executionMode?: string;
          }>;
          desktop?: {
            css?: Array<{
              path: string;
              media?: string;
            }>;
          };
          cli?: {
            hooks?: Array<{
              slot: string;
              variant?: string;
              tokens?: {
                foreground?: string;
                border?: string;
                accent?: string;
              };
              prefix?: string;
              suffix?: string;
            }>;
          };
        };
        settingsSchema?: Array<{
          key: string;
          type: string;
          title: string;
          description?: string;
          placeholder?: string;
          required?: boolean;
          defaultValue?: string | boolean | number;
          options?: Array<{
            value: string;
            label: string;
            description?: string;
          }>;
        }>;
        secretSlots?: Array<{
          key: string;
          title: string;
          description?: string;
          required?: boolean;
        }>;
      };
      installedAtUnixMs: number;
      archiveFileName?: string;
    }>;
    collectSystemPromptContributions(request: {
      host: unknown;
      logger?: Pick<Console, 'error' | 'log'>;
    }): Promise<Array<{
      extensionId: string;
      extensionName: string;
      content: string;
    }>>;
    remove(id: string): Promise<void>;
    dispatchEvent(request: {
      event: { type: string; detail?: Record<string, unknown> };
      host: unknown;
      logger?: Pick<Console, 'error' | 'log'>;
      targetExtensionIds?: readonly string[];
    }): Promise<void>;
  };
  createHostExtensionMarketplace?: (context: {
    spiritDataDir: string;
    hostKind: 'cli' | 'desktop';
  }) => {
    listCatalog(): Promise<
      Array<{
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
      }>
    >;
    getDetail(extensionId: string): Promise<{
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
    }>;
    getReadme(extensionId: string): Promise<string>;
    prepareInstall(request: {
      extensionId: string;
      version?: string;
    }): Promise<{
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
      catalogItem: {
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
      };
      detail: {
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
      };
    }>;
    install(request: {
      extensionId: string;
      version?: string;
      reviewAcknowledged?: boolean;
    }): Promise<{
      id: string;
      manifest: {
        name: string;
        version: string;
        description?: string;
        author?: string;
        homepage?: string;
        main?: string;
        supportedHosts: Array<'cli' | 'desktop'>;
        activationEvents?: string[];
        requestedCapabilities?: string[];
        contributes?: {
          tools?: Array<{
            name: string;
            description: string;
            inputSchema: JsonObject;
            outputSchema?: JsonObject;
            approvalMode?: string;
            executionMode?: string;
          }>;
          desktop?: {
            css?: Array<{
              path: string;
              media?: string;
            }>;
          };
          cli?: {
            hooks?: Array<{
              slot: string;
              variant?: string;
              tokens?: {
                foreground?: string;
                border?: string;
                accent?: string;
              };
              prefix?: string;
              suffix?: string;
            }>;
          };
        };
        settingsSchema?: Array<{
          key: string;
          type: string;
          title: string;
          description?: string;
          placeholder?: string;
          required?: boolean;
          defaultValue?: string | boolean | number;
          options?: Array<{
            value: string;
            label: string;
            description?: string;
          }>;
        }>;
        secretSlots?: Array<{
          key: string;
          title: string;
          description?: string;
          required?: boolean;
        }>;
      };
      installedAtUnixMs: number;
      archiveFileName?: string;
    }>;
  };
  resolveInstructionPaths?: (context: { workspaceRoot: string; spiritDataDir: string }) => {
    rulesStateFile: string;
    skillsStateFile: string;
  };
  saveToggleState?: (filePath: string, state: { enabledOverrides?: Record<string, boolean> }) => Promise<void>;
  LspService?: LspHostBindings['LspService'];
  appendLspDiagnosticsAfterWriteIfNeeded?: LspHostBindings['appendLspDiagnosticsAfterWriteIfNeeded'];
}

type CliHostExtensionManager = ReturnType<NonNullable<CliHostInternalModule['createHostExtensionManager']>>;
type CliHostExtensionMarketplace = ReturnType<
  NonNullable<CliHostInternalModule['createHostExtensionMarketplace']>
>;

interface CliHostInternalState {
  module: CliHostInternalModule;
  service: LocalHostToolService;
  workspaceRoot: string;
  spiritDataDir: string;
  todoSessionKey?: string;
  extensionManager?: CliHostExtensionManager;
  extensionMarketplace?: CliHostExtensionMarketplace;
}

let cliHostInternal: CliHostInternalState | undefined;
let currentApprovalLevel: import('./host-bridge/protocol.js').BridgeApprovalLevel = 'default';

function normalizeBridgeApprovalLevel(value: unknown): import('./host-bridge/protocol.js').BridgeApprovalLevel {
  if (value === 'full-approval' || value === 'full-access') {
    return 'full-approval';
  }
  return 'default';
}

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

function currentWorkspaceRoot(): string {
  return transportConfig?.workspaceRoot ?? process.cwd();
}

function currentOperatingSystemInfo(): { name: string; version: string } {
  const name = process.platform === 'win32'
    ? 'Windows'
    : process.platform === 'darwin'
      ? 'macOS'
      : process.platform === 'linux'
        ? 'Linux'
        : process.platform;
  return {
    name,
    version: osRelease(),
  };
}

function buildRuntimeBasicInfo(
  workspaceRoot: string,
  service: LocalHostToolService | undefined,
): LlmToolAgentBasicInfo {
  const shell = service?.toolDefinitionEnvironment();
  return {
    workspaceRoot,
    ...(shell?.shellDisplayName ? { terminal: shell.shellDisplayName } : {}),
    system: service?.operatingSystemInfo?.() ?? currentOperatingSystemInfo(),
  };
}

async function buildTodosContextTextForSession(
  sessionKey: string | undefined,
): Promise<string | undefined> {
  if (!sessionKey?.trim() || !cliHostInternal?.module.createHostTodoStore) {
    return undefined;
  }
  const store = cliHostInternal.module.createHostTodoStore({
    spiritDataDir: cliHostInternal.spiritDataDir,
    scope: { sessionKey: sessionKey.trim() },
  });
  const records = await store.list({ includeCompleted: true });
  const text = cliHostInternal.module.buildTodoContextText?.(records)?.trim();
  return text && text.length > 0 ? text : undefined;
}

async function updateCliTodoScope(sessionKey: string | undefined): Promise<void> {
  const normalized = sessionKey?.trim() || undefined;
  if (currentTodoSessionKey === normalized) {
    return;
  }
  currentTodoSessionKey = normalized;
  toolExecutor.setTodoToolDefinitions(normalized ? buildTodoHostToolDefinitions() : []);
  const workspaceRoot = cliHostInternal?.workspaceRoot ?? currentWorkspaceRoot();
  if (cliHostInternal) {
    if (normalized) {
      cliHostInternal.todoSessionKey = normalized;
    } else {
      delete cliHostInternal.todoSessionKey;
    }
    await rebuildCliHostToolService(workspaceRoot);
  }
}

async function rebuildCliHostToolService(workspaceRoot: string): Promise<void> {
  const modulePath = process.env[ENV_HOST_INTERNAL_MODULE_PATH]?.trim();
  const spiritDataDir = process.env[ENV_HOST_INTERNAL_SPIRIT_DATA_DIR]?.trim();
  if (!modulePath || !spiritDataDir || !cliHostInternal) {
    return;
  }
  const module = cliHostInternal.module;
  const serviceOptions = buildCliHostToolServiceOptions(module, cliHostInternal.extensionManager);
  const service = new module.NodeHostToolService({ workspaceRoot, spiritDataDir }, serviceOptions);
  cliHostInternal.service = service;
  toolExecutor.setLocalHostService(service);
  applyCliLspHostBindings(module);
  await toolExecutor.setLspWorkspaceRoot(workspaceRoot);
  await toolExecutor.refreshCaches();
}

function buildCliHostToolServiceOptions(
  module: CliHostInternalModule,
  extensionManager: CliHostExtensionManager | undefined,
): NonNullable<ConstructorParameters<CliHostInternalModule['NodeHostToolService']>[1]> {
  return {
    ...(typeof module.createNoopMcpAdapter === 'function'
      ? { mcp: module.createNoopMcpAdapter() }
      : {}),
    fileChangeObserver: {
      async recordFileChange(change: unknown): Promise<void> {
        await toolExecutor.lspServiceSnapshot()?.syncFromRecordedChange(change);
        await peer.call('host.recordFileChange', change);
      },
    },
    ...(extensionManager
      ? {
          extensions: {
            manager: extensionManager,
            getHost: () => ({}),
            logger: console,
          },
        }
      : {}),
    getModelCompatibilityProfile: () => currentHostToolModelCompatibilityProfile,
    getApprovalLevel: () => currentApprovalLevel,
    ...(currentTodoSessionKey ? { todoScope: { sessionKey: currentTodoSessionKey } } : {}),
  };
}

function applyCliLspHostBindings(module: CliHostInternalModule): void {
  if (
    typeof module.LspService === 'function'
    && typeof module.appendLspDiagnosticsAfterWriteIfNeeded === 'function'
  ) {
    toolExecutor.setLspHostBindings({
      LspService: module.LspService,
      appendLspDiagnosticsAfterWriteIfNeeded: module.appendLspDiagnosticsAfterWriteIfNeeded,
    });
    return;
  }

  toolExecutor.setLspHostBindings(undefined);
}

async function ensureCliHostInternal(workspaceRoot: string): Promise<CliHostInternalState | undefined> {
  const modulePath = process.env[ENV_HOST_INTERNAL_MODULE_PATH]?.trim();
  const spiritDataDir = process.env[ENV_HOST_INTERNAL_SPIRIT_DATA_DIR]?.trim();
  if (!modulePath || !spiritDataDir) {
    cliHostInternal = undefined;
    toolExecutor.setLocalHostService(undefined);
    toolExecutor.setExtensionToolDefinitions([]);
    toolExecutor.setTodoToolDefinitions([]);
    toolExecutor.setLspHostBindings(undefined);
    await toolExecutor.disposeLsp();
    extensionSystemPrompts = [];
    return undefined;
  }

  if (
    cliHostInternal?.workspaceRoot === workspaceRoot
    && cliHostInternal.spiritDataDir === spiritDataDir
    && cliHostInternal.todoSessionKey === currentTodoSessionKey
  ) {
    return cliHostInternal;
  }

  const loaded = await import(pathToFileURL(modulePath).href);
  const module = loaded as unknown as CliHostInternalModule;
  const extensionManager =
    typeof module.createHostExtensionManager === 'function'
      ? module.createHostExtensionManager({ spiritDataDir, hostKind: 'cli' })
      : undefined;
  const extensionMarketplace =
    typeof module.createHostExtensionMarketplace === 'function'
      ? module.createHostExtensionMarketplace({ spiritDataDir, hostKind: 'cli' })
      : undefined;
  const serviceOptions = buildCliHostToolServiceOptions(module, extensionManager);
  const service = new module.NodeHostToolService(
    { workspaceRoot, spiritDataDir },
    Object.keys(serviceOptions).length > 0 ? serviceOptions : undefined,
  );
  toolExecutor.setLocalHostService(service);
  toolExecutor.setTodoToolDefinitions(currentTodoSessionKey ? buildTodoHostToolDefinitions() : []);
  applyCliLspHostBindings(module);
  await toolExecutor.setLspWorkspaceRoot(workspaceRoot);
  cliHostInternal = {
    module,
    service,
    workspaceRoot,
    spiritDataDir,
    ...(currentTodoSessionKey ? { todoSessionKey: currentTodoSessionKey } : {}),
    ...(extensionManager ? { extensionManager } : {}),
    ...(extensionMarketplace ? { extensionMarketplace } : {}),
  };
  return cliHostInternal;
}

function transportUsesApplyPatchFileTools(
  config: LlmTransportConfig | undefined,
  agentMode?: SpiritAgentMode,
): boolean {
  return (
    config !== undefined
    && config.transportKind === 'open-responses'
    && shouldUseApplyPatchFileTools(config, {
      agentMode: agentMode ?? readSpiritAgentModeFromTransportConfig(config),
    })
  );
}

function applyPatchPlanMetadataOptions():
  | { useApplyPatchFileTools: boolean }
  | undefined {
  if (!transportUsesApplyPatchFileTools(transportConfig)) {
    return undefined;
  }
  return { useApplyPatchFileTools: true };
}

function planMetadataSnapshotOptions(activePath?: string): {
  useApplyPatchFileTools?: boolean;
  activePlanPath?: string;
} {
  const trimmed = activePath?.trim();
  return {
    ...(applyPatchPlanMetadataOptions() ?? {}),
    ...(trimmed ? { activePlanPath: trimmed } : {}),
  };
}

function applyPatchFileToolsPromptSectionForConfig(
  config: LlmTransportConfig,
  agentMode?: SpiritAgentMode,
): string | undefined {
  return transportUsesApplyPatchFileTools(config, agentMode)
    ? buildApplyPatchFileToolsPromptSection()
    : undefined;
}

function providerWebSearchPromptSectionForConfig(
  config: LlmTransportConfig,
): string | undefined {
  return buildProviderWebSearchPromptSection(config);
}

async function reloadHostMetadataFromInternal(
  agentMode: SpiritAgentMode,
  nextActivePlanPath?: string,
): Promise<boolean> {
  if (nextActivePlanPath !== undefined) {
    activePlanPath = nextActivePlanPath.trim() || undefined;
  }
  const hostInternal = await ensureCliHostInternal(currentWorkspaceRoot());
  if (!hostInternal) {
    return false;
  }

  const metadata = await hostInternal.module.loadHostInstructionMetadata(
    {
      workspaceRoot: hostInternal.workspaceRoot,
      spiritDataDir: hostInternal.spiritDataDir,
    },
    {
      planMode: agentMode === 'plan',
      agentMode,
      ...planMetadataSnapshotOptions(activePlanPath),
    },
  );
  enabledRules = [...metadata.rules.enabledRules];
  enabledSkillCatalog = [...metadata.skills.enabledSkillCatalog];
  planMetadata = metadata.planMetadata;
  activeSkills = pruneActiveSkillsAgainstCatalog(activeSkills, enabledSkillCatalog);
  return true;
}

async function refreshExtensionToolDefinitions(
  explicitDefinitions?: JsonValue[],
): Promise<void> {
  if (Array.isArray(explicitDefinitions)) {
    toolExecutor.setExtensionToolDefinitions(explicitDefinitions);
    return;
  }

  const hostInternal = cliHostInternal;
  if (!hostInternal?.extensionManager) {
    toolExecutor.setExtensionToolDefinitions([]);
    return;
  }

  const manager = hostInternal.extensionManager;
  const installedExtensions = await manager.list();
  const contributedTools = hostInternal.module.collectHostExtensionContributedTools
    ? hostInternal.module.collectHostExtensionContributedTools(installedExtensions)
    : installedExtensions.flatMap((item) => {
        if (!item.manifest.requestedCapabilities?.includes('tool-definitions')) {
          return [];
        }

        return (item.manifest.contributes?.tools ?? []).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));
      });

  toolExecutor.setExtensionToolDefinitions(
    buildContributedHostToolDefinitions(contributedTools),
  );
}

async function refreshExtensionSystemPrompts(): Promise<void> {
  const hostInternal = cliHostInternal;
  if (!hostInternal?.extensionManager) {
    extensionSystemPrompts = [];
    return;
  }

  const collected = await hostInternal.extensionManager.collectSystemPromptContributions({
    host: cliExtensionHostApi(),
    logger: console,
  });
  extensionSystemPrompts = collected.map((entry) => ({
    extensionId: entry.extensionId,
    extensionName: entry.extensionName,
    content: entry.content,
  }));
}

async function requireCliHostInternal(): Promise<CliHostInternalState> {
  const hostInternal = await ensureCliHostInternal(currentWorkspaceRoot());
  if (!hostInternal) {
    throw new Error('当前 bridge 未配置 host-internal 模块。');
  }
  return hostInternal;
}

function pruneActiveSkillsAgainstCatalog(
  skills: LlmActiveSkill[],
  catalog: LlmEnabledSkillCatalogEntry[],
): LlmActiveSkill[] {
  const allowedIds = new Set(catalog.map((entry) => entry.id));
  return skills.filter((skill) => allowedIds.has(skill.id));
}

function upsertActiveSkill(skills: LlmActiveSkill[], next: LlmActiveSkill): LlmActiveSkill[] {
  const filtered = skills.filter((skill) => skill.id !== next.id);
  filtered.push({ ...next, resources: [...next.resources] });
  return filtered;
}

function serializeHostExtension(item: {
  id: string;
  manifest: {
    name: string;
    icon?: string;
    version: string;
    description?: string;
    author?: string;
    homepage?: string;
    main?: string;
    supportedHosts: Array<'cli' | 'desktop'>;
    activationEvents?: string[];
    requestedCapabilities?: string[];
    contributes?: {
      tools?: Array<{
        name: string;
        description: string;
        approvalMode?: string;
        executionMode?: string;
      }>;
      desktop?: {
        css?: Array<{
          path: string;
          media?: string;
        }>;
      };
      cli?: {
        hooks?: Array<{
          slot: string;
          variant?: string;
          tokens?: {
            foreground?: string;
            border?: string;
            accent?: string;
          };
          prefix?: string;
          suffix?: string;
        }>;
      };
    };
    settingsSchema?: Array<{
      key: string;
      type: string;
      title: string;
      description?: string;
      placeholder?: string;
      required?: boolean;
      defaultValue?: string | boolean | number;
      options?: Array<{
        value: string;
        label: string;
        description?: string;
      }>;
    }>;
    secretSlots?: Array<{
      key: string;
      title: string;
      description?: string;
      required?: boolean;
    }>;
  };
  installedAtUnixMs: number;
  archiveFileName?: string;
}) {
  return {
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
    ...serializeExtensionContributes(item.manifest.contributes),
    ...(item.manifest.settingsSchema?.length
      ? {
          settingsSchema: item.manifest.settingsSchema.map((setting) => ({
            key: setting.key,
            type: setting.type,
            title: setting.title,
            ...(setting.description ? { description: setting.description } : {}),
            ...(setting.placeholder ? { placeholder: setting.placeholder } : {}),
            ...(setting.required !== undefined ? { required: setting.required } : {}),
            ...(setting.defaultValue !== undefined ? { defaultValue: setting.defaultValue } : {}),
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
        }
      : {}),
    ...(item.archiveFileName ? { archiveFileName: item.archiveFileName } : {}),
    installedAtUnixMs: item.installedAtUnixMs,
  };
}

function serializeMarketplaceCatalogItem(item: {
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
}) {
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

function serializeMarketplaceDetail(detail: {
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
}) {
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

function serializeMarketplacePreparedInstall(item: {
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
  catalogItem: {
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
  };
  detail: {
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
  };
}) {
  return {
    extensionId: item.extensionId,
    packageName: item.packageName,
    displayName: item.displayName,
    description: item.description,
    version: item.version,
    channel: item.channel,
    reviewStatus: item.reviewStatus,
    supportedHosts: [...item.supportedHosts],
    supportsCurrentHost: item.supportsCurrentHost,
    ...(item.tarballUrl ? { tarballUrl: item.tarballUrl } : {}),
    ...(item.integrity ? { integrity: item.integrity } : {}),
    ...(item.shasum ? { shasum: item.shasum } : {}),
    sourceFileName: item.sourceFileName,
    catalogItem: serializeMarketplaceCatalogItem(item.catalogItem),
    detail: serializeMarketplaceDetail(item.detail),
  };
}

function serializeExtensionContributes(item: {
  tools?: Array<{
    name: string;
    description: string;
    approvalMode?: string;
    executionMode?: string;
  }>;
  desktop?: {
    css?: Array<{
      path: string;
      media?: string;
    }>;
  };
  cli?: {
    hooks?: Array<{
      slot: string;
      variant?: string;
      tokens?: {
        foreground?: string;
        border?: string;
        accent?: string;
      };
      prefix?: string;
      suffix?: string;
    }>;
  };
} | undefined) {
  if (!item) {
    return {};
  }

  const contributes = {
    ...(item.tools?.length
      ? {
          tools: item.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            ...(tool.approvalMode ? { approvalMode: tool.approvalMode } : {}),
            ...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
          })),
        }
      : {}),
    ...(item.desktop?.css?.length
      ? {
          desktop: {
            css: item.desktop.css.map((entry) => ({
              path: entry.path,
              ...(entry.media ? { media: entry.media } : {}),
            })),
          },
        }
      : {}),
    ...(item.cli?.hooks?.length
      ? {
          cli: {
            hooks: item.cli.hooks.map((hook) => ({
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
          },
        }
      : {}),
  };

  return Object.keys(contributes).length > 0 ? { contributes } : {};
}

async function requireCliExtensionManager() {
  const hostInternal = await requireCliHostInternal();
  if (!hostInternal.extensionManager) {
    throw new Error('host-internal 模块未导出扩展管理接口。');
  }

  return hostInternal.extensionManager;
}

async function requireCliExtensionMarketplace() {
  const hostInternal = await requireCliHostInternal();
  if (!hostInternal.extensionMarketplace) {
    throw new Error('host-internal 模块未导出扩展市场接口。');
  }

  return hostInternal.extensionMarketplace;
}

/** 与 NodeHostToolService 传入的 getHost() 一致，供扩展 activate/onEvent 使用。 */
function cliExtensionHostApi(): Record<string, never> {
  return {};
}

async function dispatchCliExtensionEvent(
  event: { type: string; detail?: Record<string, unknown> },
  options: { targetExtensionIds?: readonly string[] } = {},
): Promise<void> {
  const hostInternal = cliHostInternal;
  if (!hostInternal?.extensionManager) {
    return;
  }

  try {
    await hostInternal.extensionManager.dispatchEvent({
      event,
      host: cliExtensionHostApi(),
      logger: console,
      ...(options.targetExtensionIds ? { targetExtensionIds: options.targetExtensionIds } : {}),
    });
  } catch (error) {
    logBridge('dispatchCliExtensionEvent failed', {
      type: event.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function forwardRuntimeEventsToExtensions(events: RuntimeEvent<JsonValue>[]): Promise<void> {
  for (const ev of events) {
    if (ev.kind === 'tool-call-started') {
      await dispatchCliExtensionEvent({
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
      await dispatchCliExtensionEvent({
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
      const ex = ev.execution;
      await dispatchCliExtensionEvent({
        type: 'onToolResult',
        detail: {
          toolCallId: ex.toolCallId,
          toolName: ex.toolName,
          output: ex.output,
          failed: ex.failed,
          request: ex.request as JsonObject,
        },
      });
    }
  }
}

async function createRuntime(
  config: LlmTransportConfig,
  history: LlmMessage[] = [],
): Promise<HostRuntime> {
  currentHostToolModelCompatibilityProfile = resolveOpenAiModelCompatibilityProfile(config as any);
  const workspaceRoot = config.workspaceRoot ?? process.cwd();
  const hostInternal = await ensureCliHostInternal(workspaceRoot);
  const basicInfo = buildRuntimeBasicInfo(workspaceRoot, hostInternal?.service);
  const todosContextText = await buildTodosContextTextForSession(currentTodoSessionKey);
  toolExecutor.setImageGenerationAvailable('imageGeneration' in config && config.imageGeneration !== undefined);
  toolExecutor.setVideoGenerationAvailable('videoGeneration' in config && config.videoGeneration !== undefined);
  toolExecutor.setTransportConfigForToolDefinitions(config);
  await toolExecutor.setLspWorkspaceRoot(workspaceRoot);
  await toolExecutor.refreshCaches();
  logBridge('createRuntime', {
    workspaceRoot,
    historyCount: history.length,
    mcpState: toolExecutor.mcpStatusSnapshot().state,
    configuredServers: toolExecutor.mcpStatusSnapshot().configuredServers,
    cachedTools: toolExecutor.mcpStatusSnapshot().cachedTools,
  });
  const runtimeAgentMode = normalizeSpiritAgentMode(planMetadata);
  const applyPatchPromptSection = applyPatchFileToolsPromptSectionForConfig(config, runtimeAgentMode);
  const providerWebSearchPromptSection = providerWebSearchPromptSectionForConfig(config);
  const createToolAgentState = (messages: LlmMessage[], userInput: string) =>
    startLlmToolAgentState(
      messages,
      userInput,
      workspaceRoot,
      enabledRules,
      enabledSkillCatalog,
      activeSkills,
      config.model,
      planMetadata,
      extensionSystemPrompts,
      undefined,
      todosContextText,
      basicInfo,
      applyPatchPromptSection,
      providerWebSearchPromptSection,
    );
  const llmTransport = createLlmTransport(config);

  return new AgentRuntime({
    config,
    llmTransport,
    toolExecutor,
    createToolAgentState,
    createContinuationState: (messages) =>
      continueLlmToolAgentState(
        messages,
        workspaceRoot,
        enabledRules,
        enabledSkillCatalog,
        activeSkills,
        config.model,
        planMetadata,
        extensionSystemPrompts,
        undefined,
        todosContextText,
        basicInfo,
        applyPatchPromptSection,
        providerWebSearchPromptSection,
      ),
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
        config.model,
        planMetadata,
        extensionSystemPrompts,
        undefined,
        todosContextText,
        basicInfo,
        applyPatchPromptSection,
        providerWebSearchPromptSection,
      ),
    generateImage: (request) =>
      llmTransport.generateImage(config, request, async (saveRequest: GeneratedImageSaveRequest) => {
        const hostInternal = await ensureCliHostInternal(workspaceRoot);
        const saveGeneratedImage = hostInternal?.service.saveGeneratedImage;
        if (!saveGeneratedImage) {
          throw new Error('CLI host-internal 当前不支持保存生成图片');
        }
        return saveGeneratedImage.call(hostInternal.service, saveRequest);
      }),
    generateVideo: (request) =>
      llmTransport.generateVideo(config, request, async (saveRequest) => {
        const hostInternal = await ensureCliHostInternal(workspaceRoot);
        const saveGeneratedVideo = hostInternal?.service.saveGeneratedVideo;
        if (!saveGeneratedVideo) {
          throw new Error('CLI host-internal 当前不支持保存生成视频');
        }
        return saveGeneratedVideo.call(hostInternal.service, saveRequest);
      }),
    resolveWorkspaceFilesFromInput: (text) => {
      const resolveFromHostInternal = cliHostInternal?.module.resolveWorkspaceFileReferenceAttachmentsFromInput;
      if (resolveFromHostInternal) {
        return resolveFromHostInternal(workspaceRoot, text);
      }
      return pendingWorkspaceFilesFromInput(workspaceRoot, text);
    },
  }, history);
}

function buildSnapshot(target: HostRuntime): BridgeRuntimeSnapshot {
  const pendingUserTurn = target.pendingUserTurn();
  const pendingAuxState = target.pendingAuxState();
  const currentPendingApproval = target.currentPendingApproval();
  const currentPendingQuestions = target.currentPendingQuestions();
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
  hasPendingQuestions: target.hasPendingQuestions(),
  ...(currentPendingApproval !== undefined ? { currentPendingApproval } : {}),
  childSessions: [...target.childSessions()],
  ...(currentPendingQuestions !== undefined ? { currentPendingQuestions } : {}),
  isBusy: target.isBusy(),
  loopEnabled: target.loopEnabled(),
  approvalLevel: currentApprovalLevel,
    ...(backgroundToolStatus !== undefined ? { backgroundToolStatus } : {}),
  };
}

async function drainEvents(): Promise<DrainEventsResult> {
  const target = requireRuntime();
  await toolExecutor.refreshCaches();
  const raw = target.drainEvents();
  const events = raw;
  if (events.length > 0) {
    logBridge('drainEvents', {
      count: events.length,
      kinds: events.map((event) => event.kind),
    });
    void forwardRuntimeEventsToExtensions(events).catch((error) => {
      logBridge('forwardRuntimeEventsToExtensions failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  return {
    events,
    snapshot: buildSnapshot(target),
  };
}

peer.on('hostInternal.setTodoSessionKey', async (rawParams) => {
  const params = rawParams as { sessionKey?: string };
  const nextKey =
    typeof params.sessionKey === 'string' && params.sessionKey.trim()
      ? params.sessionKey.trim()
      : undefined;
  const previousKey = currentTodoSessionKey;
  await updateCliTodoScope(nextKey);
  if (
    runtime
    && transportConfig
    && (previousKey?.trim() || '') !== (nextKey ?? '')
  ) {
    const target = requireRuntime();
    const loopEnabled = target.loopEnabled();
    runtime = await createRuntime(transportConfig, [...target.history()]);
    runtime.setLoopEnabled(loopEnabled);
  }
  return { ok: true };
});

peer.on('hostInternal.listSessionTodos', async () => {
  if (!currentTodoSessionKey || !cliHostInternal?.module.createHostTodoStore) {
    return { todos: [] };
  }
  const store = cliHostInternal.module.createHostTodoStore({
    spiritDataDir: cliHostInternal.spiritDataDir,
    scope: { sessionKey: currentTodoSessionKey },
  });
  return {
    todos: await store.list({ includeCompleted: true }),
  };
});

peer.on('hostInternal.replaceSessionTodos', async (rawParams) => {
  const params = rawParams as { records?: unknown[] };
  if (!currentTodoSessionKey || !cliHostInternal?.module.createHostTodoStore) {
    return { todos: [] };
  }
  const store = cliHostInternal.module.createHostTodoStore({
    spiritDataDir: cliHostInternal.spiritDataDir,
    scope: { sessionKey: currentTodoSessionKey },
  });
  const records = Array.isArray(params.records) ? params.records : [];
  const todos = await store.replaceAll(records);
  return { todos };
});

peer.on('runtime.init', async (rawParams) => {
  const params = rawParams as RuntimeInitParams;
  logBridge('runtime.init', { historyCount: params.history?.length ?? 0 });
  transportConfig = params.transportConfig;
  const initAgentMode = normalizeSpiritAgentMode(params.planMetadata);
  const loadedFromInternal = await reloadHostMetadataFromInternal(
    initAgentMode,
    params.planMetadata?.path?.trim() || undefined,
  );
  await refreshExtensionToolDefinitions(
    Array.isArray(params.extensionToolDefinitions) ? params.extensionToolDefinitions : undefined,
  );
  await refreshExtensionSystemPrompts();
  if (!loadedFromInternal) {
    enabledRules = [...(params.enabledRules ?? [])];
    enabledSkillCatalog = [...(params.enabledSkillCatalog ?? [])];
    planMetadata = params.planMetadata;
  }
  activeSkills = pruneActiveSkillsAgainstCatalog(activeSkills, enabledSkillCatalog);
  currentApprovalLevel = normalizeBridgeApprovalLevel(params.approvalLevel);
  if (typeof params.todoSessionKey === 'string' && params.todoSessionKey.trim()) {
    await updateCliTodoScope(params.todoSessionKey.trim());
  }
  runtime = await createRuntime(params.transportConfig, params.history ?? []);
  toolExecutor.setLoopToolExposure(params.loopEnabled === true);
  toolExecutor.setAgentModeToolExposure(initAgentMode);
  runtime.setLoopEnabled(params.loopEnabled === true);
  const workspaceRoot =
    params.transportConfig.workspaceRoot?.trim() || currentWorkspaceRoot();
  await dispatchCliExtensionEvent({
    type: 'onStartup',
    detail: { workspaceRoot },
  });
  return buildSnapshot(runtime);
});

peer.on('runtime.replaceConfig', async (rawParams) => {
  const params = rawParams as RuntimeReplaceConfigParams;
  logBridge('runtime.replaceConfig', { model: params.transportConfig.model });
  transportConfig = params.transportConfig;
  await reloadHostMetadataFromInternal(normalizeSpiritAgentMode(planMetadata));
  await refreshExtensionToolDefinitions();
  await refreshExtensionSystemPrompts();
  const target = requireRuntime();
  const loopEnabled = target.loopEnabled();
  runtime = await createRuntime(params.transportConfig, [...target.history()]);
  runtime.setLoopEnabled(loopEnabled);
  toolExecutor.setAgentModeToolExposure(normalizeSpiritAgentMode(planMetadata));
  return buildSnapshot(runtime);
});

peer.on('runtime.replacePlanMetadata', async (rawParams) => {
  const params = rawParams as RuntimeReplacePlanMetadataParams;
  const nextAgentMode = normalizeSpiritAgentMode(params.planMetadata);
  const loadedFromInternal = await reloadHostMetadataFromInternal(
    nextAgentMode,
    params.planMetadata.path?.trim() || activePlanPath,
  );
  if (!loadedFromInternal) {
    planMetadata = params.planMetadata;
  }
  toolExecutor.setAgentModeToolExposure(nextAgentMode);
  return buildSnapshot(requireRuntime());
});

peer.on('runtime.reloadHostMetadata', async (rawParams) => {
  const params = (rawParams ?? {}) as {
    planMode?: boolean;
    agentMode?: SpiritAgentMode;
    activePlanPath?: string;
  };
  const agentMode = normalizeSpiritAgentMode(params);
  await reloadHostMetadataFromInternal(agentMode, params.activePlanPath);
  toolExecutor.setAgentModeToolExposure(agentMode);
  return buildSnapshot(requireRuntime());
});

peer.on('hostInternal.loadCliMetadata', async (rawParams) => {
  const params = (rawParams ?? {}) as { planMode?: boolean; activePlanPath?: string };
  const hostInternal = await requireCliHostInternal();
  return {
    ruleEntries: await hostInternal.module.discoverRuleEntries({
      workspaceRoot: hostInternal.workspaceRoot,
      spiritDataDir: hostInternal.spiritDataDir,
    }),
    skillEntries: await hostInternal.module.discoverSkillEntries({
      workspaceRoot: hostInternal.workspaceRoot,
      spiritDataDir: hostInternal.spiritDataDir,
    }),
    planMetadata: hostInternal.module.planMetadataSnapshot(
      {
        workspaceRoot: hostInternal.workspaceRoot,
        spiritDataDir: hostInternal.spiritDataDir,
      },
      normalizeSpiritAgentMode(params),
      planMetadataSnapshotOptions(params.activePlanPath ?? activePlanPath),
    ),
  };
});

peer.on('hostInternal.loadPlanMetadata', async (rawParams) => {
  const params = (rawParams ?? {}) as {
    planMode?: boolean;
    agentMode?: SpiritAgentMode;
    activePlanPath?: string;
  };
  const hostInternal = await requireCliHostInternal();
  return hostInternal.module.planMetadataSnapshot(
    {
      workspaceRoot: hostInternal.workspaceRoot,
      spiritDataDir: hostInternal.spiritDataDir,
    },
    normalizeSpiritAgentMode(params),
    planMetadataSnapshotOptions(params.activePlanPath ?? activePlanPath),
  );
});

peer.on('hostInternal.listWorkspaceFileReferenceSuggestions', async (rawParams) => {
  const params = (rawParams ?? {}) as {
    input?: string;
    cursorChars?: number;
  };
  const hostInternal = await requireCliHostInternal();
  if (!hostInternal.module.listWorkspaceFileReferenceSuggestions) {
    return null;
  }

  if (hostInternal.module.listCachedWorkspaceFileReferenceSuggestions) {
    return (
      (await hostInternal.module.listCachedWorkspaceFileReferenceSuggestions(
        hostInternal.workspaceRoot,
        typeof params.input === 'string' ? params.input : '',
        typeof params.cursorChars === 'number' ? params.cursorChars : 0,
      )) ?? null
    );
  }

  return (
    (await hostInternal.module.listWorkspaceFileReferenceSuggestions(
      hostInternal.workspaceRoot,
      typeof params.input === 'string' ? params.input : '',
      typeof params.cursorChars === 'number' ? params.cursorChars : 0,
    )) ?? null
  );
});

peer.on('hostInternal.writeRuleState', async (rawParams) => {
  const params = (rawParams ?? {}) as { enabledOverrides?: Record<string, boolean> };
  const hostInternal = await requireCliHostInternal();
  if (!hostInternal.module.resolveInstructionPaths || !hostInternal.module.saveToggleState) {
    throw new Error('host-internal 模块未导出规则状态写入所需接口。');
  }
  const paths = hostInternal.module.resolveInstructionPaths({
    workspaceRoot: hostInternal.workspaceRoot,
    spiritDataDir: hostInternal.spiritDataDir,
  });
  await hostInternal.module.saveToggleState(paths.rulesStateFile, {
    enabledOverrides: params.enabledOverrides ?? {},
  });
  return paths.rulesStateFile;
});

peer.on('hostInternal.writeSkillState', async (rawParams) => {
  const params = (rawParams ?? {}) as { enabledOverrides?: Record<string, boolean> };
  const hostInternal = await requireCliHostInternal();
  if (!hostInternal.module.resolveInstructionPaths || !hostInternal.module.saveToggleState) {
    throw new Error('host-internal 模块未导出技能状态写入所需接口。');
  }
  const paths = hostInternal.module.resolveInstructionPaths({
    workspaceRoot: hostInternal.workspaceRoot,
    spiritDataDir: hostInternal.spiritDataDir,
  });
  await hostInternal.module.saveToggleState(paths.skillsStateFile, {
    enabledOverrides: params.enabledOverrides ?? {},
  });
  return paths.skillsStateFile;
});

peer.on('hostInternal.listExtensions', async () => {
  const manager = await requireCliExtensionManager();
  const items = await manager.list();
  return items.map((item) => serializeHostExtension(item));
});

peer.on('hostInternal.importExtension', async (rawParams) => {
  const params = (rawParams ?? {}) as {
    archiveBase64?: string;
    fileName?: string;
  };
  const archiveBase64 = params.archiveBase64?.trim() ?? '';
  if (!archiveBase64) {
    throw new Error('扩展 ZIP 内容不能为空。');
  }

  const manager = await requireCliExtensionManager();
  const item = await manager.importArchive({
    archiveBase64,
    ...(params.fileName?.trim() ? { fileName: params.fileName.trim() } : {}),
  });
  await refreshExtensionToolDefinitions();
  await refreshExtensionSystemPrompts();
  await dispatchCliExtensionEvent(
    {
      type: 'onExtensionInstalled',
      detail: {
        extensionId: item.id,
        name: item.manifest.name,
        version: item.manifest.version,
      },
    },
    { targetExtensionIds: [item.id] },
  );
  return serializeHostExtension(item);
});

peer.on('hostInternal.deleteExtension', async (rawParams) => {
  const params = (rawParams ?? {}) as { id?: string };
  const id = params.id?.trim() ?? '';
  if (!id) {
    throw new Error('扩展 id 不能为空。');
  }

  const manager = await requireCliExtensionManager();
  await manager.remove(id);
  await refreshExtensionToolDefinitions();
  await refreshExtensionSystemPrompts();
  return { id };
});

peer.on('hostInternal.listMarketplaceExtensions', async () => {
  const marketplace = await requireCliExtensionMarketplace();
  const items = await marketplace.listCatalog();
  return items.map((item) => serializeMarketplaceCatalogItem(item));
});

peer.on('hostInternal.getMarketplaceExtensionDetail', async (rawParams) => {
  const params = (rawParams ?? {}) as { extensionId?: string };
  const extensionId = params.extensionId?.trim() ?? '';
  if (!extensionId) {
    throw new Error('扩展 id 不能为空。');
  }

  const marketplace = await requireCliExtensionMarketplace();
  const detail = await marketplace.getDetail(extensionId);
  return serializeMarketplaceDetail(detail);
});

peer.on('hostInternal.getMarketplaceExtensionReadme', async (rawParams) => {
  const params = (rawParams ?? {}) as { extensionId?: string };
  const extensionId = params.extensionId?.trim() ?? '';
  if (!extensionId) {
    throw new Error('扩展 id 不能为空。');
  }

  const marketplace = await requireCliExtensionMarketplace();
  return marketplace.getReadme(extensionId);
});

peer.on('hostInternal.prepareMarketplaceExtensionInstall', async (rawParams) => {
  const params = (rawParams ?? {}) as { extensionId?: string; version?: string };
  const extensionId = params.extensionId?.trim() ?? '';
  if (!extensionId) {
    throw new Error('扩展 id 不能为空。');
  }

  const marketplace = await requireCliExtensionMarketplace();
  const prepared = await marketplace.prepareInstall({
    extensionId,
    ...(params.version?.trim() ? { version: params.version.trim() } : {}),
  });
  return serializeMarketplacePreparedInstall(prepared);
});

peer.on('hostInternal.installMarketplaceExtension', async (rawParams) => {
  const params = (rawParams ?? {}) as {
    extensionId?: string;
    version?: string;
    reviewAcknowledged?: boolean;
  };
  const extensionId = params.extensionId?.trim() ?? '';
  if (!extensionId) {
    throw new Error('扩展 id 不能为空。');
  }

  const marketplace = await requireCliExtensionMarketplace();
  const item = await marketplace.install({
    extensionId,
    ...(params.version?.trim() ? { version: params.version.trim() } : {}),
    ...(params.reviewAcknowledged === true ? { reviewAcknowledged: true } : {}),
  });
  await refreshExtensionToolDefinitions();
  await refreshExtensionSystemPrompts();
  await dispatchCliExtensionEvent(
    {
      type: 'onExtensionInstalled',
      detail: {
        extensionId: item.id,
        name: item.manifest.name,
        version: item.manifest.version,
      },
    },
    { targetExtensionIds: [item.id] },
  );
  return serializeHostExtension(item);
});

peer.on('runtime.activateSkill', async (rawParams) => {
  const params = rawParams as RuntimeActivateSkillParams;
  activeSkills = upsertActiveSkill(activeSkills, params.skill);
  activeSkills = pruneActiveSkillsAgainstCatalog(activeSkills, enabledSkillCatalog);
  return buildSnapshot(requireRuntime());
});

peer.on('runtime.replaceHistory', async (rawParams) => {
  const history = rawParams as LlmMessage[];
  requireRuntime().replaceHistory(history);
  return buildSnapshot(requireRuntime());
});

peer.on('runtime.replaceFromArchive', async (archive) => {
  const typedArchive = archive as { approvalLevel?: unknown };
  if (typedArchive.approvalLevel !== undefined) {
    currentApprovalLevel = normalizeBridgeApprovalLevel(typedArchive.approvalLevel);
  }
  requireRuntime().replaceFromArchive(archive as never);
  await dispatchCliExtensionEvent({
    type: 'onSessionOpened',
    detail: {
      filePath: '',
      displayName: 'loaded-from-archive',
    },
  });
  return buildSnapshot(requireRuntime());
});

peer.on('runtime.subagentSessionArchive', async (rawParams) => {
  const params = rawParams as RuntimeSubagentSessionParams;
  return requireRuntime().childSessionArchive(params.sessionId) ?? null;
});

peer.on('runtime.subagentPendingAuxState', async (rawParams) => {
  const params = rawParams as RuntimeSubagentSessionParams;
  return requireRuntime().childSessionPendingAuxState(params.sessionId) ?? null;
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
  const trimmed = params.text.trim();
  const displayText = params.text;
  await dispatchCliExtensionEvent({
    type: 'onUserMessage',
    detail: {
      text: trimmed,
      displayText,
    },
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
  const trimmed = params.text.trim();
  const displayText = params.text;
  await dispatchCliExtensionEvent({
    type: 'onUserMessage',
    detail: {
      text: trimmed,
      displayText,
    },
  });
  await requireRuntime().startUserTurnStreaming(params.text, params.explicitImages ?? []);
  return null;
});

peer.on('runtime.poll', async () => {
  await toolExecutor.refreshCaches();
  await requireRuntime().poll();
  return null;
});

peer.on('runtime.abort', async () => {
  requireRuntime().abort();
  return null;
});

peer.on('runtime.continueAssistantCompletionStreaming', async () => {
  await requireRuntime().continueAssistantCompletionStreaming();
  return null;
});

peer.on('runtime.drainEvents', async () => drainEvents());
peer.on('runtime.snapshot', async () => buildSnapshot(requireRuntime()));

peer.on('runtime.setLoopEnabled', async (rawParams) => {
  const params = rawParams as RuntimeSetLoopEnabledParams;
  requireRuntime().setLoopEnabled(params.enabled === true);
  return buildSnapshot(requireRuntime());
});

peer.on('runtime.setApprovalLevel', async (rawParams) => {
  const params = rawParams as import('./host-bridge/protocol.js').RuntimeSetApprovalLevelParams;
  currentApprovalLevel = normalizeBridgeApprovalLevel(params.approvalLevel);
  return buildSnapshot(requireRuntime());
});

peer.on('runtime.setLlmHttpVersion', async (rawParams) => {
  const params = rawParams as import('./host-bridge/protocol.js').RuntimeSetLlmHttpVersionParams;
  configureLlmHttpVersion(normalizeLlmHttpVersion(params.llmHttpVersion));
  return null;
});

peer.on('runtime.setLlmClientVersion', async (rawParams) => {
  const params = rawParams as import('./host-bridge/protocol.js').RuntimeSetLlmClientVersionParams;
  configureLlmClientVersion(params.clientVersion);
  return null;
});

peer.on('runtime.respondToPendingApproval', async (rawParams) => {
  const params = rawParams as RuntimeRespondToPendingApprovalParams;
  await requireRuntime().continuePendingApproval(params.decision);
  return null;
});

peer.on('runtime.respondToPendingQuestions', async (rawParams) => {
  const params = rawParams as RuntimeRespondToPendingQuestionsParams;
  await requireRuntime().continuePendingQuestions(params.result);
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

peer.on('runtime.takeCompletedManualToolCommandResult', async () => {
  return requireRuntime().takeCompletedManualToolCommandResult() ?? null;
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

peer.on('runtime.listCachedMcpPrompts', async (rawParams) => {
  const params = rawParams as RuntimeNamedMcpServerParams;
  return toolExecutor.listCachedMcpPrompts(params.name);
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
  await toolExecutor.refreshCaches();
  logBridge('runtime.applyMcpPrompt(streaming)', {
    server: params.server,
    prompt: params.prompt,
    hasArgsJson: typeof params.argsJson === 'string' && params.argsJson.trim().length > 0,
    userMessageChars: Array.from(params.userMessage ?? '').length,
  });
  const notice = await requireRuntime().startApplyMcpPrompt(
    params.server,
    params.prompt,
    params.argsJson,
    params.userMessage,
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

  const exportTransport = createLlmTransport(config);
  const baseSystemPrompts = exportTransport.llmSystemPromptsForExport() as Record<string, JsonValue>;
  const rulesSystemPrompt = buildRulesSystemMessage(enabledRules);
  const skillsCatalogSystemPrompt = buildSkillsCatalogSystemMessage(enabledSkillCatalog);
  const planSystemPrompt = buildPlanSystemMessage(planMetadata);
  const agentModeSystemPrompt = buildAgentModeSystemMessage(planMetadata);
  const activeSkillsSystemPrompt = buildActiveSkillsSystemMessage(activeSkills);
  const extensionsSystemPrompt = buildExtensionsSystemMessage(extensionSystemPrompts);
  const workspaceRoot = config.workspaceRoot ?? currentWorkspaceRoot();
  const basicInfoSystemPrompt = buildBasicInfoSystemMessage(
    buildRuntimeBasicInfo(workspaceRoot, cliHostInternal?.service),
  );

  return {
    apiMessages: exportTransport.llmHistoryAsApiMessages([...target.history()]),
    requestTrace: [...target.requestTrace()],
    systemPrompts: {
      ...baseSystemPrompts,
      tool_agent: buildToolAgentHostPrompt(config.model),
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
      ...(basicInfoSystemPrompt === undefined ? {} : { basicInfo: basicInfoSystemPrompt }),
    },
  };
});

peer.on('runtime.exportArchive', async (rawParams) => {
  const params = rawParams as RuntimeExportArchiveParams;
  return requireRuntime().toArchive(params.messages, params.assistantAux);
});

process.on('beforeExit', () => {
  void toolExecutor.disposeLsp();
});

peer.start();
