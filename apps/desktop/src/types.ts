import type { ModelProviderId, ProviderConnectSiteId } from '@spirit-agent/host-internal/model-provider-presets';
import type { ModelReasoningEffort } from '@spirit-agent/core/reasoning-effort';
import type { LspWriteDiagnosticsUi } from '@spirit-agent/core';

import type { DesktopAgentMode } from './lib/agent-mode.js';
import type { DesktopAutomationTrigger } from './lib/automation-trigger.js';

export type { DesktopAgentMode };
import type { WorkspaceFileReferenceSuggestionsResult as HostWorkspaceFileReferenceSuggestionsResult, ApprovalLevel, GitHubPullRequestCommit } from '@spirit-agent/host-internal';

export type { ApprovalLevel };

import type { BrowserElementAttachment } from './lib/browser-element-attachment.js';
import type { ComposerLocalFileAttachmentView } from './lib/local-file-attachments.js';

export type DesktopWorkspaceBinding = 'project' | 'none';

export interface BootstrapRequest {
  workspaceRoot?: string;
  workspaceBinding?: DesktopWorkspaceBinding;
}

export interface RememberWorkspaceRequest {
  workspaceRoot: string;
}

export interface ForgetWorkspaceRequest {
  workspaceRoot: string;
}

export interface CommitChangesRequest {
  message?: string;
}

export interface CheckoutGitBranchRequest {
  branch: string;
  discardLocalChanges?: boolean;
}

export interface UpdateConfigRequest {
  activeModel: string;
  imageGenerationModel?: string;
  videoGenerationModel?: string;
  lightweightChatModel?: string;
  apiBase: string;
  reasoningEffort?: DesktopModelReasoningEffort;
  uiLocale?: string;
  apiKey?: string;
  /** 与 Rust `UpdateConfigRequest.windows_mica` 一致；缺省不修改已保存的 Mica 开关。 */
  windowsMica?: boolean;
  /** 关闭时不发送桌面系统通知（含 Windows 任务栏需要关注）。缺省为 true。 */
  systemNotifications?: boolean;
  /** 缺省时不修改运行方式（Agent / Plan / Ask）。 */
  agentMode?: DesktopAgentMode;
  /** @deprecated 使用 agentMode。 */
  planMode?: boolean;
  /** 缺省时不修改已保存的 Desktop Web 远程访问配置。 */
  webHost?: DesktopWebHostConfigUpdate;
  /** 缺省时不修改已保存的梦境配置。 */
  dreams?: DesktopDreamConfigUpdate;
  /** 缺省时不修改已保存的智能体配置。 */
  agents?: DesktopAgentsConfigUpdate;
  /** 缺省时不修改已保存的网络配置。 */
  networks?: DesktopNetworksConfigUpdate;
}

export interface DesktopNetworksConfigUpdate {
  llmHttpVersion?: 'http1.1' | 'http2';
}

export interface DesktopAgentsConfigUpdate {
  lsp?: {
    enabled?: boolean;
  };
}

export interface InstallLspProviderRequest {
  providerId: string;
}

export type DesktopLspProviderStatus = 'ready' | 'not_found' | 'disabled';

export interface DesktopLspProviderSnapshot {
  id: string;
  displayName: string;
  languages: string[];
  status: DesktopLspProviderStatus;
  installKind: 'npm' | 'go' | 'rustup' | 'platform' | 'manual' | 'dotnet';
  npmPackage?: string;
  command?: string;
}

export interface DesktopLspSnapshot {
  userEnabled: boolean;
  active: boolean;
  providers: DesktopLspProviderSnapshot[];
}

export interface DesktopWebHostConfigUpdate {
  enabled?: boolean;
  host?: string;
  port?: number;
  resetPairing?: boolean;
}

export interface DesktopDreamConfigUpdate {
  enabled?: boolean;
  collectorModel?: string;
  clearCollectorModel?: boolean;
  debugMode?: boolean;
}

/** 模型提供方（与 `packages/host-internal` 中 `ModelProviderId` 同源）。 */
export type DesktopModelProvider = ModelProviderId;
export type DesktopProviderConnectSiteId = ProviderConnectSiteId;

export type DesktopTransportKind = 'openai-compatible' | 'open-responses' | 'anthropic' | 'bedrock';

/** 模型推理强度字符串；具体允许值由 provider / transportKind 在 agent-core 中约束。 */
export type DesktopModelReasoningEffort = ModelReasoningEffort;

export type DesktopModelCapability = 'chat' | 'image' | 'video' | 'imageGeneration' | 'videoGeneration';

export interface PreviewModelCatalogPricing {
  inputPerTokenUsd?: string;
  outputPerTokenUsd?: string;
  imagePerUnitUsd?: string;
  requestPerCallUsd?: string;
}

export interface PreviewModelCatalogEntry {
  id: string;
  displayName?: string;
  description?: string;
  pricing?: PreviewModelCatalogPricing;
  capabilities?: DesktopModelCapability[];
  supportedReasoningEfforts?: DesktopModelReasoningEffort[];
  contextLength?: number;
}

/** 预览某端点下列出的模型 id（带本地 TTL 缓存）。 */
export interface PreviewModelsRequest {
  apiBase: string;
  apiKey: string;
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  /** SiliconFlow 等站点型提供商：cn / intl。 */
  providerSite?: DesktopProviderConnectSiteId;
  alibabaWorkspaceId?: string;
  awsRegion?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  azureResourceName?: string;
  vertexProject?: string;
  vertexLocation?: string;
  vertexClientEmail?: string;
  vertexPrivateKey?: string;
  /** 为 true 时忽略 TTL，强制请求上游。 */
  forceRefresh?: boolean;
}

export interface PreviewModelsResponse {
  modelIds: string[];
  models?: PreviewModelCatalogEntry[];
  fromCache: boolean;
}

/** 批量写入同一端点下的多个模型 id（共享 API Key），用于提供商连接批量导入。 */
export interface AddProviderModelsRequest {
  apiBase: string;
  apiKey: string;
  modelIds: string[];
  modelCatalog?: PreviewModelCatalogEntry[];
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  /** SiliconFlow 等站点型提供商：cn / intl。 */
  providerSite?: DesktopProviderConnectSiteId;
  alibabaWorkspaceId?: string;
  awsRegion?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  azureResourceName?: string;
  vertexProject?: string;
  vertexLocation?: string;
  vertexClientEmail?: string;
  vertexPrivateKey?: string;
}

/** 快照附带：某 apiBase 在本地 `model-catalog-cache` 中的最近一次列模型结果（供主界面分组与排序）。 */
export interface DesktopModelCatalogHint {
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  apiBase: string;
  modelIds: string[];
  modelCatalog?: PreviewModelCatalogEntry[];
  fetchedAtUnixMs: number;
}

/** 与 CLI `model add` 一致：新增模型、写入密钥，并将当前模型切到新模型。 */
export interface AddModelRequest {
  name: string;
  apiBase: string;
  apiKey: string;
  /** 缺省时不写入配置（与旧版三字段一致）。 */
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  capabilities?: DesktopModelCapability[];
  /** 可选；正整数；用于上下文 usage 圆环分母等。 */
  contextLength?: number;
  /** Amazon Bedrock AWS 区域；`amazon-bedrock` 必填。 */
  awsRegion?: string;
  /** 站点型提供商区域（如 SiliconFlow cn / intl）。 */
  providerSite?: DesktopProviderConnectSiteId;
  alibabaWorkspaceId?: string;
  /** Azure 资源名；`azure` 必填。 */
  azureResourceName?: string;
  /** Google Vertex GCP 项目 ID。 */
  vertexProject?: string;
  /** Google Vertex 区域（如 `us-central1`）。 */
  vertexLocation?: string;
}

export interface RemoveModelRequest {
  name: string;
}

export interface RemoveProviderModelsRequest {
  provider: DesktopModelProvider;
}

export interface DesktopMcpCapabilityToggles {
  tools: boolean;
  resources: boolean;
  prompts: boolean;
}

export type DesktopMcpTransportType = 'stdio' | 'http';

export type DesktopMcpScope = 'user' | 'workspace';

export interface AddMcpServerRequest {
  name: string;
  scope: DesktopMcpScope;
  transportType: DesktopMcpTransportType;
  endpoint: string;
  metadata?: string;
  capabilities?: Partial<DesktopMcpCapabilityToggles>;
}

export interface DeleteMcpServerRequest {
  name: string;
  scope: DesktopMcpScope;
}

export type DesktopHookScope = 'user' | 'workspace';

export type DesktopHookEventName =
  | 'sessionStart'
  | 'sessionEnd'
  | 'submitPrompt'
  | 'preToolUse'
  | 'postToolUse'
  | 'subagentStart'
  | 'subagentEnd';

export interface SaveHookEntryRequest {
  scope: DesktopHookScope;
  event: DesktopHookEventName;
  command: string;
  timeout?: number;
  failClosed?: boolean;
  matcher?: string;
}

export interface DeleteHookEntryRequest {
  scope: DesktopHookScope;
  event: DesktopHookEventName;
  index: number;
}

export interface DesktopHookListItem {
  id: string;
  scope: DesktopHookScope;
  event: DesktopHookEventName;
  index: number;
  command: string;
  configPath: string;
  timeout?: number;
  failClosed?: boolean;
  matcher?: string;
}

export interface ImportExtensionRequest {
  archiveBase64: string;
  fileName?: string;
}

export interface DeleteExtensionRequest {
  id: string;
}

export interface RunExtensionRequest {
  id: string;
}

export interface InstallMarketplaceExtensionRequest {
  extensionId: string;
  version?: string;
  reviewAcknowledged?: boolean;
}

export interface PrepareMarketplaceExtensionInstallRequest {
  extensionId: string;
  version?: string;
}

export type DesktopExtensionSettingValue = string | boolean | number | null;

export interface UpdateExtensionSettingsRequest {
  id: string;
  values: Record<string, DesktopExtensionSettingValue>;
}

export interface UpdateExtensionSecretRequest {
  id: string;
  key: string;
  value?: string;
}

export type DesktopExtensionToolApprovalMode =
  | 'allowed'
  | 'need-approval'
  | 'need-questions';

export type DesktopExtensionToolExecutionMode = 'foreground' | 'background';

export interface DesktopExtensionContributedTool {
  name: string;
  description: string;
  approvalMode?: DesktopExtensionToolApprovalMode;
  executionMode?: DesktopExtensionToolExecutionMode;
}

export interface DesktopExtensionDesktopCssEntry {
  path: string;
  media?: string;
}

export interface DesktopExtensionDesktopSettingsPage {
  title?: string;
}

export interface DesktopExtensionCliUiHookTokens {
  foreground?: string;
  border?: string;
  accent?: string;
}

export interface DesktopExtensionCliUiHookEntry {
  slot: string;
  variant?: string;
  tokens?: DesktopExtensionCliUiHookTokens;
  prefix?: string;
  suffix?: string;
}

export type DesktopExtensionSettingType = 'string' | 'boolean' | 'number' | 'select';

export interface DesktopExtensionSettingOption {
  value: string;
  label: string;
  description?: string;
}

export interface DesktopExtensionSettingDefinition {
  key: string;
  type: DesktopExtensionSettingType;
  title: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string | boolean | number;
  options?: DesktopExtensionSettingOption[];
}

export interface DesktopExtensionSecretSlot {
  key: string;
  title: string;
  description?: string;
  required?: boolean;
}

export interface DesktopExtensionSecretStatus {
  key: string;
  configured: boolean;
}

export type DesktopExtensionHostKind = 'cli' | 'desktop';

export interface DesktopExtensionListItem {
  id: string;
  displayName: string;
  icon?: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  main?: string;
  supportedHosts: DesktopExtensionHostKind[];
  activationEvents?: string[];
  requestedCapabilities?: string[];
  contributedTools?: DesktopExtensionContributedTool[];
  desktopCss?: DesktopExtensionDesktopCssEntry[];
  desktopSettingsPage?: DesktopExtensionDesktopSettingsPage;
  cliHooks?: DesktopExtensionCliUiHookEntry[];
  settingsSchema?: DesktopExtensionSettingDefinition[];
  settingsValues?: Record<string, DesktopExtensionSettingValue>;
  secretSlots?: DesktopExtensionSecretSlot[];
  secretStatuses?: DesktopExtensionSecretStatus[];
  archiveFileName?: string;
  installedAtUnixMs: number;
}

export type DesktopMarketplaceChannel = 'stable' | 'preview' | 'experimental';

export type DesktopMarketplaceReviewStatus = 'unverified' | 'verified' | 'revoked';

export interface DesktopMarketplaceCatalogItem {
  extensionId: string;
  packageName: string;
  status: string;
  featured: boolean;
  defaultVersion: string;
  defaultChannel: DesktopMarketplaceChannel;
  defaultReviewStatus: DesktopMarketplaceReviewStatus;
  detailPath: string;
  displayName: string;
  description: string;
  author?: string;
  homepageUrl?: string;
  repositoryUrl?: string;
  keywords: string[];
  supportedHosts: DesktopExtensionHostKind[];
  requestedCapabilities: string[];
  iconUrl?: string;
}

export interface DesktopMarketplaceVersionChangelog {
  summary: string;
  body: string;
}

export interface DesktopMarketplaceDetailVersion {
  version: string;
  channel: DesktopMarketplaceChannel;
  reviewStatus: DesktopMarketplaceReviewStatus;
  displayName: string;
  description: string;
  author?: string;
  homepageUrl?: string;
  repositoryUrl?: string;
  keywords: string[];
  supportedHosts: DesktopExtensionHostKind[];
  requestedCapabilities: string[];
  iconUrl?: string;
  publishedAt?: string;
  tarballUrl?: string;
  integrity?: string;
  shasum?: string;
  changelog?: DesktopMarketplaceVersionChangelog;
}

export interface DesktopMarketplaceDetail {
  extensionId: string;
  packageName: string;
  status: string;
  featured: boolean;
  defaultVersion: string;
  readmePath: string;
  versions: DesktopMarketplaceDetailVersion[];
}

export interface DesktopMarketplacePreparedInstall {
  extensionId: string;
  packageName: string;
  displayName: string;
  description: string;
  version: string;
  channel: DesktopMarketplaceChannel;
  reviewStatus: DesktopMarketplaceReviewStatus;
  supportedHosts: DesktopExtensionHostKind[];
  supportsCurrentHost: boolean;
  tarballUrl?: string;
  integrity?: string;
  shasum?: string;
  sourceFileName: string;
}

export interface DesktopMcpStdioTransportSnapshot {
  type: 'stdio';
  command: string;
  args: string[];
  metadata: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  summary: string;
}

export interface DesktopMcpHttpTransportSnapshot {
  type: 'http';
  url: string;
  metadata: Record<string, string>;
  timeoutMs?: number;
  summary: string;
}

export type DesktopMcpTransportSnapshot =
  | DesktopMcpStdioTransportSnapshot
  | DesktopMcpHttpTransportSnapshot;

export interface DesktopMcpServerListItem {
  name: string;
  displayName: string;
  enabled: boolean;
  capabilities: DesktopMcpCapabilityToggles;
  scope: DesktopMcpScope;
  transport: DesktopMcpTransportSnapshot;
}

export interface DesktopMcpServerInspection {
  name: string;
  displayName: string;
  supportsTools: boolean;
  supportsResources: boolean;
  supportsPrompts: boolean;
  toolsCount: number;
  resourcesCount: number;
  promptsCount: number;
}

export type DesktopSkillScope = 'workspace' | 'user';
export type DesktopSkillRootKind = 'workspaceSpirit' | 'workspaceAgents' | 'user';

/** 创建 `skills/<name>/SKILL.md`，根目录由 `rootKind` 决定（用户目录或工作区 `.spirit` / `.agents`）。 */
export interface CreateSkillRequest {
  name: string;
  rootKind: DesktopSkillRootKind;
  /** 写入 SKILL.md 正文，必填。 */
  description: string;
}

export interface DeleteSkillRequest {
  name: string;
  rootKind: DesktopSkillRootKind;
}

export interface SubmitSkillSlashRequest {
  skillName: string;
  rawText: string;
  extraNote?: string;
}

export type GitChipAction = 'commit' | 'push' | 'merge';

export interface SubmitGitChipRequest {
  action: GitChipAction;
  extraNote?: string;
}

export type DesktopRuleScope = 'workspace' | 'user';

/** 在固定规则槽位创建 Markdown 规则文件，根目录由 `rootKind` 决定。 */
export interface CreateRuleRequest {
  rootKind: DesktopSkillRootKind;
  /** 写入正文种子，必填。 */
  description: string;
}

export interface DeleteRuleRequest {
  id: string;
}

export interface RewindAndSubmitMessageRequest {
  messageId: number;
  text: string;
  localFilePaths?: string[];
}

export interface ForkSessionRequest {
  messageId: number;
  /** Visible list index; disambiguates duplicate `messageId`s in the timeline. */
  listIndex?: number;
}

export interface SubmitUserTurnRequest {
  text: string;
  localFilePaths?: string[];
}

export interface QueuedUserTurnRequest {
  queueId: string;
}

export interface DesktopSkillListItem {
  id: string;
  name: string;
  description: string;
  shortLabel: string;
  scope: DesktopSkillScope;
  rootKind: DesktopSkillRootKind;
  enabled: boolean;
}

export interface DesktopRuleListItem {
  id: string;
  title: string;
  shortLabel: string;
  scope: DesktopRuleScope;
  rootKind: DesktopSkillRootKind;
  exists: boolean;
  enabled: boolean;
  previewExcerpt?: string;
  previewTruncated?: boolean;
}

/** 与 CLI `chat_store` 已保存的 `*.json` 文件一致。 */
export interface ActiveSessionSnapshot {
  filePath: string;
  displayName: string;
  kind?: 'stored' | 'ephemeral';
  readOnly?: boolean;
}

export interface SessionListItem {
  path: string;
  displayName: string;
  modifiedAtUnixMs: number;
  workspaceRoot: string;
  gitBranch?: string;
  kind?: 'stored' | 'ephemeral';
  readOnly?: boolean;
  /** Agent turn in progress for this session (in-memory registry). */
  isBusy?: boolean;
  /** Waiting for approval or askQuestions; still counts as busy for host polling. */
  isBlocked?: boolean;
  /** Currently focused session in the desktop host. */
  isActive?: boolean;
}

export interface DesktopWorkspaceListItem {
  path: string;
  label: string;
}

/** 工作区文件树子节点（相对工作区根的路径由前端用 `name` 与父路径拼接）。 */
export type WorkspaceExplorerEntryKind = 'file' | 'dir';

export interface WorkspaceExplorerEntry {
  name: string;
  kind: WorkspaceExplorerEntryKind;
  /** Git / exclude 规则忽略时为 true；缺省或 false 时按正常色展示。 */
  ignored?: boolean;
}

export interface WorkspaceExplorerListResult {
  entries: WorkspaceExplorerEntry[];
}

export interface QueryWorkspaceFileReferenceSuggestionsRequest {
  input: string;
  cursorChars: number;
}

export type WorkspaceFileReferenceSuggestionsResult = HostWorkspaceFileReferenceSuggestionsResult;
export type WorkspaceFileReferenceSuggestionsResponse = WorkspaceFileReferenceSuggestionsResult | null;

export interface WorkspaceFileReferenceIndexSnapshot {
  ready: boolean;
  files: string[];
}

/** 宿主按 UTF-8 读取的工作区文本文件内容（侧栏编辑器等）。 */
export interface WorkspaceReadTextFileResult {
  text: string;
}

/** readWorkspaceTextFile 选项；optional 时文件不存在返回空文本而不抛错。 */
export interface ReadWorkspaceTextFileOptions {
  optional?: boolean;
}

/** 将 UTF-8 文本写回工作区内已有文件（路径规则与读文件一致）。 */
export interface WriteWorkspaceTextFileRequest {
  relativePath: string;
  text: string;
}

export type WorkspaceContentSearchRequest = {
  query: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  isRegexp?: boolean;
};

export type WorkspaceContentSearchSubmatch = {
  start: number;
  end: number;
};

export type WorkspaceContentSearchMatch = {
  relativePath: string;
  lineNumber: number;
  lineText: string;
  submatches: WorkspaceContentSearchSubmatch[];
};

export type WorkspaceContentSearchResult = {
  matches: WorkspaceContentSearchMatch[];
};

export interface HostTextFileStatResult {
  exists: boolean;
  isFile: boolean;
}

export interface WriteHostTextFileRequest {
  absolutePath: string;
  text: string;
}

export interface DesktopSnapshot {
  workspaceRoot: string;
  /** 用户主目录；侧栏划分「无工作区」会话与项目工作区会话时使用。 */
  userHomeDirectory: string;
  workspaceBinding: DesktopWorkspaceBinding;
  availableWorkspaces: DesktopWorkspaceListItem[];
  git: DesktopGitSnapshot;
  dreams: DesktopDreamSnapshot;
  runtimeReady: boolean;
  runtimeError?: string;
  config: DesktopConfigSnapshot;
  webHost: DesktopWebHostSnapshot;
  rules: DiscoverySummary;
  skills: DiscoverySummary;
  /** 固定槽位的全部 Rules（含未创建），供设置页列表。 */
  rulesList: DesktopRuleListItem[];
  /** 当前工作区与用户目录下发现的全部 Skills，供设置页列表。 */
  skillsList: DesktopSkillListItem[];
  extensionsList: DesktopExtensionListItem[];
  extensionCss: DesktopExtensionCssLayer[];
  /** 扩展后台 warmup 进行中（不阻塞会话导航与发消息）。 */
  extensionsLoading?: boolean;
  plan: PlanSnapshot;
  mcpStatus: McpStatusSnapshot;
  mcpServers: DesktopMcpServerListItem[];
  hooksList: DesktopHookListItem[];
  lsp: DesktopLspSnapshot;
  conversation: ConversationSnapshot;
  /** 从磁盘打开的会话；未从文件打开时为 `undefined`（新会话/未保存）。 */
  activeSession?: ActiveSessionSnapshot;
  /** Stable key for per-session composer draft persistence (`filePath` or synthetic bundle id). */
  composerSessionKey: string;
  /** Active SubAgent viewer overlay; present while renderer has a tool card open in viewer mode. */
  subagentViewer?: SubagentViewerSnapshot;
  automationsList: DesktopAutomationListItem[];
}

export type SubagentViewerSessionStatus = 'bootstrapping' | 'running' | 'completed' | 'failed' | 'blocked';

export interface SubagentViewerSnapshot {
  parentToolCallId: string;
  sessionId: string;
  status: SubagentViewerSessionStatus;
  /** Same text as run_subagent tool card headlineDetail (delegated task). */
  promptText: string;
  messages: ConversationMessageSnapshot[];
  pendingAuxState?: PendingAssistantAux;
}

export interface DesktopExtensionCssLayer {
  extensionId: string;
  extensionName: string;
  sourcePath: string;
  cssText: string;
  media?: string;
}

export interface DesktopConfigSnapshot {
  models: ModelProfileSnapshot[];
  activeModel: string;
  imageGenerationModel?: string;
  videoGenerationModel?: string;
  lightweightChatModel?: string;
  uiLocale?: string;
  activeApiKeyConfigured: boolean;
  /** 桌面宿主在 Windows 上是否使用 Mica 风格；无字段时按 true 处理。 */
  windowsMica?: boolean;
  /** 是否发送系统通知；无字段时按 true 处理。 */
  systemNotifications?: boolean;
  /** 运行方式：影响宿主指令元数据、工具暴露与 SPIRIT_AGENT_MODE。 */
  agentMode: DesktopAgentMode;
  /** 与 `spiritAgentDataDir()/model-catalog-cache` 对齐；无缓存时为空数组。 */
  modelCatalogHints?: DesktopModelCatalogHint[];
  networks: {
    llmHttpVersion: 'http1.1' | 'http2';
  };
}

export interface DesktopDreamSettingsSnapshot {
  enabled: boolean;
  collectorModel?: string;
  debugMode: boolean;
}

export type DesktopDreamCollectorState =
  | 'disabled'
  | 'missing-model'
  | 'idle'
  | 'running'
  | 'backoff'
  | 'error';

export interface DesktopDreamCollectorSnapshot {
  state: DesktopDreamCollectorState;
  lastRunAtUnixMs?: number;
  lastSuccessAtUnixMs?: number;
  lastError?: string;
  pendingCount: number;
  processedCount: number;
  backoffUntilUnixMs?: number;
}

export interface DesktopDreamSnapshot {
  settings: DesktopDreamSettingsSnapshot;
  collector: DesktopDreamCollectorSnapshot;
}

export interface DesktopDreamOverviewItem {
  id: string;
  title: string;
  summary: string;
  details?: string;
  tags: string[];
  workspaceRoot: string;
  gitBranch: string;
  updatedAtUnixMs: number;
}

export interface DesktopAutomationListItem {
  id: string;
  title: string;
  scheduleLabel: string;
  trigger: DesktopAutomationTrigger;
  enabled: boolean;
  githubPollError?: string;
  lastRunAtUnixMs?: number;
  updatedAtUnixMs: number;
}

export type {
  DesktopAutomationSchedule,
  DesktopAutomationWeekday,
} from './lib/automation-schedule.js';
export type {
  DesktopAutomationGitHubEvent,
  DesktopAutomationTrigger,
} from './lib/automation-trigger.js';

export interface DesktopGitHubAutomationRepositoryItem {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  private: boolean;
  updatedAt: string;
}

export interface ListGitHubAutomationRepositoriesRequest {
  page?: number;
}

export interface SearchGitHubAutomationRepositoriesRequest {
  query: string;
  page?: number;
}

export interface GitHubAutomationRepositoriesSnapshot {
  items: DesktopGitHubAutomationRepositoryItem[];
  hasNextPage: boolean;
}

export interface SearchGitHubAutomationRepositoriesSnapshot {
  items: DesktopGitHubAutomationRepositoryItem[];
  totalCount: number;
}

export type DesktopAutomationRunStatus = 'running' | 'blocked' | 'completed' | 'failed';

export interface DesktopAutomationRun {
  id: string;
  automationId: string;
  sessionPath: string;
  status: DesktopAutomationRunStatus;
  startedAtUnixMs: number;
  completedAtUnixMs?: number;
  error?: string;
}

export interface DesktopAutomationDefinition {
  id: string;
  title: string;
  overview: string;
  trigger: import('./lib/automation-trigger.js').DesktopAutomationTrigger;
  workspaceRoot: string;
  modelName: string;
  reasoningEffort?: DesktopModelReasoningEffort;
  approvalLevel: ApprovalLevel;
  enabled: boolean;
  createdAtUnixMs: number;
  updatedAtUnixMs: number;
  lastFiredAtUnixMs?: number;
}

export interface DesktopAutomationDetail {
  definition: DesktopAutomationDefinition;
  runs: DesktopAutomationRun[];
}

export interface DesktopCreateAutomationRequest {
  title: string;
  overview: string;
  trigger: import('./lib/automation-trigger.js').DesktopAutomationTrigger;
  workspaceRoot: string;
  modelName: string;
  reasoningEffort?: DesktopModelReasoningEffort;
  approvalLevel: ApprovalLevel;
  enabled?: boolean;
}

export interface DesktopUpdateAutomationRequest {
  title?: string;
  overview?: string;
  trigger?: import('./lib/automation-trigger.js').DesktopAutomationTrigger;
  workspaceRoot?: string;
  modelName?: string;
  reasoningEffort?: DesktopModelReasoningEffort;
  approvalLevel?: ApprovalLevel;
  enabled?: boolean;
}

export interface DesktopGitSnapshot {
  /** Bumped on each successful workspace git summary refresh (poll or user git op). */
  revision: number;
  isRepository: boolean;
  hasChanges: boolean;
  workingTreeLineDelta?: { added: number; removed: number };
  branch?: string;
  branches: string[];
  upstreamRemote?: string;
  upstreamBranch?: string;
  aheadCount: number;
  behindCount: number;
  pushRemote?: string;
  needsPush: boolean;
  /** User-selected branch for the next send; defaults to `branch` when unset. */
  selectedBranch?: string;
  /** Session work-location preference; populated on client snapshots. */
  workLocation?: import('@spirit-agent/host-internal').WorkLocationKind;
  /** True when the active workspace path is a linked Git worktree. */
  isWorktreeSession?: boolean;
  /** Primary repository root for the active worktree session. */
  primaryRepoRoot?: string;
  /** Directory name under `{repoRoot}.worktrees/`. */
  worktreeName?: string;
  /** Current spirit/ branch checked out in the worktree. */
  worktreeBranch?: string;
  /** Default branch on the primary repository (for merge UI). */
  defaultBranch?: string;
}

export interface GitWorkingTreeChange {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  code: string;
  previousPath?: string;
}

export interface GitWorkingTreeSnapshot {
  isRepository: boolean;
  changes: GitWorkingTreeChange[];
}

export interface GitCommitRecord {
  oid: string;
  parents: string[];
  subject: string;
  author: string;
  authoredAt: string;
  refs: string[];
}

export interface GitCommitGraphRow {
  commit: GitCommitRecord;
  lane: number;
  laneCount: number;
  passingLanes: number[];
  mergeLanes: number[];
  branchFromLane?: number;
}

export interface GitHistorySnapshot {
  isRepository: boolean;
  commits: GitCommitRecord[];
  rows: GitCommitGraphRow[];
  hasMore: boolean;
  logCommits: GitCommitRecord[];
}

export interface ReadGitHistoryRequest {
  maxCount?: number;
  skip?: number;
  /** When loading the next page, pass the prior `logCommits` to merge and rebuild the graph. */
  existingLogCommits?: GitCommitRecord[];
}

export interface ReadGitCommitMessageRequest {
  oid: string;
}

export interface GitCommitMessageSnapshot {
  isRepository: boolean;
  oid: string;
  subject: string;
  author: string;
  authoredAt: string;
  fullMessage: string;
}

export type {
  GitHubAuthStatus,
  GitHubDeviceAuthChallenge,
  GitHubPullRequestConversationSnapshot,
  GitHubPullRequestConversationItem,
  GitHubPullRequestChangedFile,
  GitHubPullRequestFileStatus,
  GitHubPullRequestFilesSnapshot,
  GitHubPullRequestCommit,
  GitHubPullRequestCommitsSnapshot,
  GitHubPullRequestCheck,
  GitHubPullRequestCheckState,
  GitHubPullRequestChecksSnapshot,
  GitHubPullRequestConversationCommit,
  GitHubPullRequestConversationMerged,
  GitHubPullRequestConversationIssueComment,
  GitHubPullRequestConversationReview,
  GitHubPullRequestConversationReviewThread,
  GitHubPullRequestReviewComment,
  GitHubPullRequestReviewState,
  GitHubPullRequestDetail,
  GitHubPullRequestForBranchResult,
  GitHubPullRequestSummary,
  GitHubPullRequestListItem,
  GitHubPullRequestListSnapshot,
  GitHubPullRequestTabCounts,
  GitHubPullRequestTaskListProgress,
  GitHubRepositoryRef,
} from '@spirit-agent/host-internal';

export interface ListGitHubPullRequestsRequest {
  owner: string;
  repo: string;
  state: 'open' | 'closed';
  page?: number;
  query?: string;
}

export interface GetGitHubPullRequestTabCountsRequest {
  owner: string;
  repo: string;
}

export interface GetGitHubPullRequestDetailRequest {
  owner: string;
  repo: string;
  number: number;
  checksAfter?: string;
  nodeId?: string;
  conversationTimelinePage?: number;
  conversationReviewCommentsPage?: number;
  conversationCommitsPage?: number;
  conversationKnownCommits?: GitHubPullRequestCommit[];
  conversationPreviousNextTimelinePage?: number;
  conversationPreviousNextReviewCommentsPage?: number;
  conversationPreviousNextCommitsPage?: number;
}

export interface MergeGitHubPullRequestRequest extends GetGitHubPullRequestDetailRequest {
  mergeMethod: import('@spirit-agent/host-internal').GitHubPullRequestMergeMethod;
}

export type {
  GitHubPullRequestMergeMethod,
  GitHubPullRequestMergeResult,
} from '@spirit-agent/host-internal';

export interface ModelProfileSnapshot {
  name: string;
  apiBase: string;
  reasoningEffort: DesktopModelReasoningEffort;
  supportedReasoningEfforts?: DesktopModelReasoningEffort[];
  capabilities?: DesktopModelCapability[];
  /** 持久化来源；缺省表示历史自定义配置。 */
  provider?: DesktopModelProvider;
  /** 传输族；当前主要用于区分 Anthropic 与 OpenAI-compatible。 */
  transportKind?: DesktopTransportKind;
  /** 站点型提供商区域（如 SiliconFlow cn / intl）。 */
  providerSite?: DesktopProviderConnectSiteId;
  /** Alibaba 业务空间 ID；新加坡/法兰克福等区域必填。 */
  alibabaWorkspaceId?: string;
  /** Amazon Bedrock AWS 区域（如 `us-east-1`）；仅 `amazon-bedrock` 使用。 */
  awsRegion?: string;
  /** Azure 资源名；仅 `azure` 使用。 */
  azureResourceName?: string;
  /** Google Vertex GCP 项目 ID；仅 `google-vertex-ai` 使用。 */
  vertexProject?: string;
  /** Google Vertex 区域；仅 `google-vertex-ai` 使用。 */
  vertexLocation?: string;
  /** 用户配置的模型上下文长度（token）；优先于 catalog 解析。 */
  contextLength?: number;
  /** 宿主快照：该模型是否在系统钥匙串中有专属 API Key 条目（与 CLI 一致；不含环境变量与全局回退）。 */
  keyConfigured?: boolean;
}

export interface DiscoverySummary {
  discovered: number;
  enabled: number;
}

export interface PlanSnapshot {
  path: string;
  exists: boolean;
  content?: string;
  modifiedAtUnixMs?: number;
}

export interface McpStatusSnapshot {
  revision: number;
  state: 'idle' | 'loading' | 'ready' | 'error';
  configuredServers: number;
  loadedServers: number;
  cachedTools: number;
  lastError?: string;
}

export type DesktopTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface DesktopTodoItem {
  id: string;
  title: string;
  status: DesktopTodoStatus;
  createdAtUnixMs: number;
  updatedAtUnixMs: number;
  completedAtUnixMs?: number;
}

export interface ConversationTodoSnapshot {
  items: DesktopTodoItem[];
  clearingUntilUnixMs?: number;
}

export interface ConversationContextUsageSnapshot {
  inputTokens: number;
  contextLength: number;
  percent: number;
}

export interface ConversationSnapshot {
  /** Monotonic per session bundle; bumps on rewind restore so stale poll snapshots are ignored. */
  revision: number;
  messages: ConversationMessageSnapshot[];
  loopEnabled: boolean;
  approvalLevel: ApprovalLevel;
  pendingUserTurn?: string;
  pendingImagePaths: string[];
  pendingMcpResources: PendingMcpResource[];
  pendingAuxState?: PendingAssistantAux;
  pendingToolApproval?: PendingToolApprovalSnapshot;
  pendingQuestions?: PendingQuestionsSnapshot;
  isBusy: boolean;
  rewindWarnings?: FileRewindWarning[];
  todos?: ConversationTodoSnapshot;
  contextUsage?: ConversationContextUsageSnapshot;
}

export interface ConversationLocalFileAttachmentSnapshot {
  path: string;
  name: string;
  isImage: boolean;
}

export interface ConversationMessageSnapshot {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  localFileAttachments?: ConversationLocalFileAttachmentSnapshot[];
  tool?: ToolBlockSnapshot;
  aux?: MessageAuxSnapshot;
  pending: boolean;
  canRewind?: boolean;
  canContinue?: boolean;
  /** UI-only projection for unsent queued user turns (not in message timeline). */
  queued?: boolean;
  queueId?: string;
}

export interface MessageRewindDraftState {
  messageId: number;
  /** List index in the visible conversation; disambiguates duplicate `messageId`s in the timeline. */
  listIndex: number;
  text: string;
  browserElementAttachments: BrowserElementAttachment[];
  localFileAttachments: ComposerLocalFileAttachmentView[];
}

export interface MessageRewindResult {
  restored: number;
  skipped: number;
  warnings: FileRewindWarning[];
}

export interface FileRewindWarning {
  changeId?: string;
  path: string;
  action: 'create_file' | 'edit_file' | 'delete_file';
  message: string;
}

export interface ToolBlockSnapshot {
  toolCallId?: string;
  toolName: string;
  phase: 'preview' | 'pending-approval' | 'running' | 'succeeded' | 'failed';
  headline: string;
  /** Muted secondary line shown after headline (e.g. shell command, grep query). */
  headlineDetail?: string;
  /** create_file / create_plan / edit_file / delete_file: line +/- counts on tool card headline. */
  editLineDelta?: { added: number; removed: number };
  /** delete_file：删除前冻结的全文，供展开 Diff（完成后磁盘已无文件）。 */
  deleteFileBaselineText?: string;
  /** preview 阶段完整参数 JSON，供展开区流式 Diff；完成后清除。 */
  streamingArgumentsJson?: string;
  /** 已完成文件类工具：完整请求 JSON（供 Diff；与 UI 用 argsExcerpt 截断分离）。 */
  fileToolDiffArgumentsJson?: string;
  /** todo_write：执行前会话 TODO，供增量 detail 重算与语言切换。 */
  todoWriteBeforeTodos?: Array<{ title: string; status: DesktopTodoStatus }>;
  detailLines: string[];
  argsExcerpt?: string;
  outputExcerpt?: string;
  imagePaths?: string[];
  videoPaths?: string[];
  /** 写文件类工具 LSP 自动检查后的 error/warning 摘要（供工具卡徽章与 hover）。 */
  lspWriteDiagnostics?: LspWriteDiagnosticsUi;
}

export interface MessageAuxSnapshot {
  thinking?: string;
  compaction?: string;
  /** Loop finish_task：不展示工具卡，在助手正文下方显示一行灰色说明 */
  finishTaskNotice?: string;
}

export interface PendingToolApprovalSnapshot {
  toolName: string;
  prompt: string;
  trustTarget?: string;
  subagentSessionId?: string;
}

export type DesktopApprovalDecision =
  | { kind: 'allow'; persistTrust?: boolean }
  | { kind: 'deny'; resultText?: string }
  | { kind: 'guidance'; userMessage: string; resultText?: string };

export interface PendingQuestionsSnapshot {
  toolCallId: string;
  toolName: string;
  request: AskQuestionsRequest;
}

export interface PendingAssistantAux {
  kind: 'thinking' | 'compressing';
  statusText: string;
  detailText?: string;
}

export interface PendingMcpResource {
  server: string;
  displayName: string;
  uri: string;
  mimeType?: string;
  readAtUnixMs: number;
  content: string;
}

export interface AskQuestionsRequest {
  title?: string;
  questions: AskQuestionsQuestionSpec[];
}

export interface AskQuestionsQuestionSpec {
  id: string;
  title: string;
  kind: 'single_select' | 'multi_select' | 'text';
  required: boolean;
  options: AskQuestionsOptionSpec[];
  allowCustomInput: boolean;
  customInputPlaceholder?: string;
  customInputLabel?: string;
}

export interface AskQuestionsOptionSpec {
  label: string;
  summary?: string;
}

export interface AskQuestionsAnswer {
  questionId: string;
  title: string;
  kind: 'single_select' | 'multi_select' | 'text';
  answered: boolean;
  selectedOptionIndexes?: number[];
  selectedOptionLabels?: string[];
  customInput?: string;
  text?: string;
}

export interface AskQuestionsResult {
  status: 'answered' | 'skipped';
  answers?: AskQuestionsAnswer[];
}

export interface DesktopWebHostSnapshot {
  config: DesktopWebHostConfigSnapshot;
  status: DesktopWebHostStatusSnapshot;
  policy: DesktopWebHostPolicySnapshot;
}

export interface DesktopWebHostConfigSnapshot {
  enabled: boolean;
  host: string;
  port: number;
  paired: boolean;
  authMode: 'pairing';
}

export interface DesktopWebHostStatusSnapshot {
  state: 'disabled' | 'stopped' | 'starting' | 'running' | 'error';
  host: string;
  port: number;
  url?: string;
  error?: string;
  pairingCode?: string;
}

export interface DesktopWebHostPolicySnapshot {
  healthRequiresAuth: true;
  cors: 'same-origin';
  allowHttpLan: true;
  allowRemoteControl: true;
}
