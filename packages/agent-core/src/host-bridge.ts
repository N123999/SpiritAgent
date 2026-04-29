import { stdin, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  appendOpenAiToolResultMessage,
  appendOpenAiUserMessage,
  buildActiveSkillsSystemMessage,
  buildExtensionsSystemMessage,
  buildPlanSystemMessage,
  buildRulesSystemMessage,
  buildSkillsCatalogSystemMessage,
  extractLastOpenAiAssistantText,
  OpenAiTransport,
  buildToolAgentHostPrompt,
  rebuildOpenAiToolAgentStateAfterCompaction,
  startOpenAiToolAgentState,
  truncateOpenAiHistoryForCompaction,
  truncateOpenAiToolAgentStateForContextRetry,
  type OpenAiActiveSkill,
  type OpenAiEnabledRule,
  type OpenAiEnabledSkillCatalogEntry,
  type OpenAiExtensionSystemPrompt,
  type OpenAiPlanMetadata,
  type OpenAiToolAgentState,
  type OpenAiTransportConfig,
} from './openai/transport.js';
import { buildContributedHostToolDefinitions } from './host-tools.js';
import type {
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
  RuntimeActivateSkillParams,
  RuntimeStartManualMcpToolParams,
  RuntimeStartManualToolCommandParams,
  RuntimeSubmitUserTurnParams,
} from './host-bridge/protocol.js';

type HostRuntime = AgentRuntime<OpenAiTransportConfig, OpenAiToolAgentState, JsonValue, JsonValue>;

interface ToolExecutionMetadata {
  backgroundExecution: boolean;
  backgroundStatusText?: string;
}

const peer = new JsonRpcPeer(stdin, stdout);
const toolExecutor = new HostToolExecutorProxy(peer);
const ENV_HOST_INTERNAL_MODULE_PATH = 'SPIRIT_HOST_INTERNAL_MODULE_PATH';
const ENV_HOST_INTERNAL_SPIRIT_DATA_DIR = 'SPIRIT_HOST_INTERNAL_SPIRIT_DATA_DIR';
let runtime: HostRuntime | undefined;
let transportConfig: OpenAiTransportConfig | undefined;
let enabledRules: OpenAiEnabledRule[] = [];
let enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[] = [];
let activeSkills: OpenAiActiveSkill[] = [];
let planMetadata: OpenAiPlanMetadata | undefined;
let extensionSystemPrompts: OpenAiExtensionSystemPrompt[] = [];
const llmTransport = new OpenAiTransport();

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
    },
  ) => LocalHostToolService;
  createNoopMcpAdapter?: () => unknown;
  loadHostInstructionMetadata: (
    context: { workspaceRoot: string; spiritDataDir: string },
    options?: { planMode?: boolean },
  ) => Promise<{
    rules: { enabledRules: OpenAiEnabledRule[] };
    skills: { enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[] };
    planMetadata: OpenAiPlanMetadata;
  }>;
  discoverRuleEntries: (context: { workspaceRoot: string; spiritDataDir: string }) => Promise<JsonValue>;
  discoverSkillEntries: (context: { workspaceRoot: string; spiritDataDir: string }) => Promise<JsonValue>;
  planMetadataSnapshot: (
    context: { workspaceRoot: string; spiritDataDir: string },
    planMode: boolean,
  ) => OpenAiPlanMetadata;
  createHostExtensionManager?: (context: { spiritDataDir: string; hostKind: 'cli' | 'desktop' }) => {
    list(): Promise<
      Array<{
        id: string;
        manifest: {
          name: string;
          version: string;
          description?: string;
          author?: string;
          homepage?: string;
          main?: string;
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
        version: string;
        description?: string;
        author?: string;
        homepage?: string;
        main?: string;
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
  resolveInstructionPaths?: (context: { workspaceRoot: string; spiritDataDir: string }) => {
    rulesStateFile: string;
    skillsStateFile: string;
  };
  saveToggleState?: (filePath: string, state: { enabledOverrides?: Record<string, boolean> }) => Promise<void>;
}

type CliHostExtensionManager = ReturnType<NonNullable<CliHostInternalModule['createHostExtensionManager']>>;

interface CliHostInternalState {
  module: CliHostInternalModule;
  workspaceRoot: string;
  spiritDataDir: string;
  extensionManager?: CliHostExtensionManager;
}

let cliHostInternal: CliHostInternalState | undefined;

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

async function ensureCliHostInternal(workspaceRoot: string): Promise<CliHostInternalState | undefined> {
  const modulePath = process.env[ENV_HOST_INTERNAL_MODULE_PATH]?.trim();
  const spiritDataDir = process.env[ENV_HOST_INTERNAL_SPIRIT_DATA_DIR]?.trim();
  if (!modulePath || !spiritDataDir) {
    cliHostInternal = undefined;
    toolExecutor.setLocalHostService(undefined);
    toolExecutor.setExtensionToolDefinitions([]);
    extensionSystemPrompts = [];
    return undefined;
  }

  if (cliHostInternal?.workspaceRoot === workspaceRoot && cliHostInternal.spiritDataDir === spiritDataDir) {
    return cliHostInternal;
  }

  const loaded = await import(pathToFileURL(modulePath).href);
  const module = loaded as unknown as CliHostInternalModule;
  const extensionManager =
    typeof module.createHostExtensionManager === 'function'
      ? module.createHostExtensionManager({ spiritDataDir, hostKind: 'cli' })
      : undefined;
  const serviceOptions = {
    ...(typeof module.createNoopMcpAdapter === 'function'
      ? { mcp: module.createNoopMcpAdapter() }
      : {}),
    ...(extensionManager
      ? {
          extensions: {
            manager: extensionManager,
            getHost: () => ({}),
            logger: console,
          },
        }
      : {}),
  };
  const service = new module.NodeHostToolService(
    { workspaceRoot, spiritDataDir },
    Object.keys(serviceOptions).length > 0 ? serviceOptions : undefined,
  );
  toolExecutor.setLocalHostService(service);
  cliHostInternal = {
    module,
    workspaceRoot,
    spiritDataDir,
    ...(extensionManager ? { extensionManager } : {}),
  };
  return cliHostInternal;
}

async function reloadHostMetadataFromInternal(planMode: boolean): Promise<boolean> {
  const hostInternal = await ensureCliHostInternal(currentWorkspaceRoot());
  if (!hostInternal) {
    return false;
  }

  const metadata = await hostInternal.module.loadHostInstructionMetadata(
    {
      workspaceRoot: hostInternal.workspaceRoot,
      spiritDataDir: hostInternal.spiritDataDir,
    },
    { planMode },
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
  const contributedTools = installedExtensions.flatMap((item) => {
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
  skills: OpenAiActiveSkill[],
  catalog: OpenAiEnabledSkillCatalogEntry[],
): OpenAiActiveSkill[] {
  const allowedIds = new Set(catalog.map((entry) => entry.id));
  return skills.filter((skill) => allowedIds.has(skill.id));
}

function upsertActiveSkill(skills: OpenAiActiveSkill[], next: OpenAiActiveSkill): OpenAiActiveSkill[] {
  const filtered = skills.filter((skill) => skill.id !== next.id);
  filtered.push({ ...next, resources: [...next.resources] });
  return filtered;
}

function serializeHostExtension(item: {
  id: string;
  manifest: {
    name: string;
    version: string;
    description?: string;
    author?: string;
    homepage?: string;
    main?: string;
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
    name: item.manifest.name,
    version: item.manifest.version,
    ...(item.manifest.description ? { description: item.manifest.description } : {}),
    ...(item.manifest.author ? { author: item.manifest.author } : {}),
    ...(item.manifest.homepage ? { homepage: item.manifest.homepage } : {}),
    ...(item.manifest.main ? { main: item.manifest.main } : {}),
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
  config: OpenAiTransportConfig,
  history: LlmMessage[] = [],
): Promise<HostRuntime> {
  const workspaceRoot = config.workspaceRoot ?? process.cwd();
  await toolExecutor.refreshCaches();
  logBridge('createRuntime', {
    workspaceRoot,
    historyCount: history.length,
    mcpState: toolExecutor.mcpStatusSnapshot().state,
    configuredServers: toolExecutor.mcpStatusSnapshot().configuredServers,
    cachedTools: toolExecutor.mcpStatusSnapshot().cachedTools,
  });
  const createToolAgentState = (messages: LlmMessage[], userInput: string) =>
    startOpenAiToolAgentState(
      messages,
      userInput,
      workspaceRoot,
      enabledRules,
      enabledSkillCatalog,
      activeSkills,
      config.model,
      planMetadata,
      extensionSystemPrompts,
    );

  return new AgentRuntime({
    config,
    llmTransport,
    toolExecutor,
    createToolAgentState,
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
        activeSkills,
        config.model,
        planMetadata,
        extensionSystemPrompts,
      ),
    resolveWorkspaceFilesFromInput: (text) => pendingWorkspaceFilesFromInput(workspaceRoot, text),
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
    ...(backgroundToolStatus !== undefined ? { backgroundToolStatus } : {}),
  };
}

async function drainEvents(): Promise<DrainEventsResult> {
  const target = requireRuntime();
  await toolExecutor.refreshCaches();
  const raw = target.drainEvents();
  // Rust bridge 仍未消费 streaming-tool-preview；其余事件保持透传，避免 CLI 丢失工具完成消息。
  const events = raw.filter((event) => event.kind !== 'streaming-tool-preview');
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

peer.on('runtime.init', async (rawParams) => {
  const params = rawParams as RuntimeInitParams;
  logBridge('runtime.init', { historyCount: params.history?.length ?? 0 });
  transportConfig = params.transportConfig;
  const loadedFromInternal = await reloadHostMetadataFromInternal(params.planMetadata?.planMode ?? false);
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
  runtime = await createRuntime(params.transportConfig, params.history ?? []);
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
  await reloadHostMetadataFromInternal(planMetadata?.planMode ?? false);
  await refreshExtensionToolDefinitions();
  await refreshExtensionSystemPrompts();
  const target = requireRuntime();
  runtime = await createRuntime(params.transportConfig, [...target.history()]);
  return buildSnapshot(runtime);
});

peer.on('runtime.replacePlanMetadata', async (rawParams) => {
  const params = rawParams as RuntimeReplacePlanMetadataParams;
  const loadedFromInternal = await reloadHostMetadataFromInternal(
    params.planMetadata.planMode === true,
  );
  if (!loadedFromInternal) {
    planMetadata = params.planMetadata;
  }
  return buildSnapshot(requireRuntime());
});

peer.on('runtime.reloadHostMetadata', async (rawParams) => {
  const params = (rawParams ?? {}) as { planMode?: boolean };
  await reloadHostMetadataFromInternal(params.planMode === true);
  return buildSnapshot(requireRuntime());
});

peer.on('hostInternal.loadCliMetadata', async (rawParams) => {
  const params = (rawParams ?? {}) as { planMode?: boolean };
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
      params.planMode === true,
    ),
  };
});

peer.on('hostInternal.loadPlanMetadata', async (rawParams) => {
  const params = (rawParams ?? {}) as { planMode?: boolean };
  const hostInternal = await requireCliHostInternal();
  return hostInternal.module.planMetadataSnapshot(
    {
      workspaceRoot: hostInternal.workspaceRoot,
      spiritDataDir: hostInternal.spiritDataDir,
    },
    params.planMode === true,
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

peer.on('runtime.drainEvents', async () => drainEvents());
peer.on('runtime.snapshot', async () => buildSnapshot(requireRuntime()));

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

  const baseSystemPrompts = llmTransport.llmSystemPromptsForExport() as Record<string, JsonValue>;
  const rulesSystemPrompt = buildRulesSystemMessage(enabledRules);
  const skillsCatalogSystemPrompt = buildSkillsCatalogSystemMessage(enabledSkillCatalog);
  const planSystemPrompt = buildPlanSystemMessage(planMetadata);
  const activeSkillsSystemPrompt = buildActiveSkillsSystemMessage(activeSkills);
  const extensionsSystemPrompt = buildExtensionsSystemMessage(extensionSystemPrompts);

  return {
    apiMessages: llmTransport.llmHistoryAsApiMessages([...target.history()]),
    requestTrace: [...target.requestTrace()],
    systemPrompts: {
      ...baseSystemPrompts,
      tool_agent: buildToolAgentHostPrompt(config.model),
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
  };
});

peer.on('runtime.exportArchive', async (rawParams) => {
  const params = rawParams as RuntimeExportArchiveParams;
  return requireRuntime().toArchive(params.messages, params.assistantAux);
});

peer.start();
