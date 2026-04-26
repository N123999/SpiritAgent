export interface BootstrapRequest {
  workspaceRoot?: string;
}

export interface UpdateConfigRequest {
  activeModel: string;
  apiBase: string;
  uiLocale?: string;
  apiKey?: string;
  /** 与 Rust `UpdateConfigRequest.windows_mica` 一致；缺省不修改已保存的 Mica 开关。 */
  windowsMica?: boolean;
  /** 缺省时不修改已保存的 Plan 模式。 */
  planMode?: boolean;
  /** 缺省时不修改已保存的 Desktop Web 远程访问配置。 */
  webHost?: DesktopWebHostConfigUpdate;
}

export interface DesktopWebHostConfigUpdate {
  enabled?: boolean;
  host?: string;
  port?: number;
  resetPairing?: boolean;
}

/** 与 CLI `model add` 一致：新增模型、写入密钥，并将当前模型切到新模型。 */
export interface AddModelRequest {
  name: string;
  apiBase: string;
  apiKey: string;
}

export interface RemoveModelRequest {
  name: string;
}

export type DesktopSkillScope = 'workspace' | 'user';
export type DesktopSkillRootKind = 'workspaceSpirit' | 'workspaceAgents' | 'user';

/** 创建 `skills/<name>/SKILL.md`，根目录由 `rootKind` 决定（用户目录或工作区 `.spirit` / `.agents`）。 */
export interface CreateSkillRequest {
  name: string;
  rootKind: DesktopSkillRootKind;
  /** 写入 frontmatter，必填。 */
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

export interface RewindAndSubmitMessageRequest {
  messageId: number;
  text: string;
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

/** 与 CLI `chat_store` 已保存的 `*.json` 文件一致。 */
export interface ActiveSessionSnapshot {
  filePath: string;
  displayName: string;
}

export interface SessionListItem {
  path: string;
  displayName: string;
  modifiedAtUnixMs: number;
}

export interface DesktopSnapshot {
  workspaceRoot: string;
  runtimeReady: boolean;
  runtimeError?: string;
  config: DesktopConfigSnapshot;
  webHost: DesktopWebHostSnapshot;
  rules: DiscoverySummary;
  skills: DiscoverySummary;
  /** 当前工作区与用户目录下发现的全部 Skills，供设置页列表。 */
  skillsList: DesktopSkillListItem[];
  plan: PlanSnapshot;
  mcpStatus: McpStatusSnapshot;
  conversation: ConversationSnapshot;
  /** 从磁盘打开的会话；未从文件打开时为 `undefined`（新会话/未保存）。 */
  activeSession?: ActiveSessionSnapshot;
}

export interface DesktopConfigSnapshot {
  models: ModelProfileSnapshot[];
  activeModel: string;
  uiLocale?: string;
  activeApiKeyConfigured: boolean;
  /** 桌面宿主在 Windows 上是否使用 Mica 风格；无字段时按 true 处理。 */
  windowsMica?: boolean;
  /** 与 CLI Plan 模式一致：影响宿主指令元数据与运行时 plan 元数据。 */
  planMode: boolean;
}

export interface ModelProfileSnapshot {
  name: string;
  apiBase: string;
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
}

export interface McpStatusSnapshot {
  revision: number;
  state: 'idle' | 'loading' | 'ready' | 'error';
  configuredServers: number;
  loadedServers: number;
  cachedTools: number;
  lastError?: string;
}

export interface ConversationSnapshot {
  messages: ConversationMessageSnapshot[];
  pendingUserTurn?: string;
  pendingImagePaths: string[];
  pendingMcpResources: PendingMcpResource[];
  pendingAuxState?: PendingAssistantAux;
  pendingToolApproval?: PendingToolApprovalSnapshot;
  pendingQuestions?: PendingQuestionsSnapshot;
  isBusy: boolean;
  rewindWarnings?: FileRewindWarning[];
}

export interface ConversationMessageSnapshot {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  tool?: ToolBlockSnapshot;
  aux?: MessageAuxSnapshot;
  pending: boolean;
  canRewind?: boolean;
}

export interface MessageRewindDraftState {
  messageId: number;
  text: string;
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
  phase: 'pending-approval' | 'running' | 'succeeded' | 'failed';
  headline: string;
  detailLines: string[];
  argsExcerpt?: string;
  outputExcerpt?: string;
}

export interface MessageAuxSnapshot {
  thinking?: string;
  compaction?: string;
}

export interface PendingToolApprovalSnapshot {
  toolName: string;
  prompt: string;
}

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
