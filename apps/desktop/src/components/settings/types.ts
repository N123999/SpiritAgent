import type { SettingsSidebarTab } from "@/components/session-sidebar";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import type { FontPreference } from "@/lib/font";
import type { ThemePreference } from "@/lib/theme";
import type {
  AddModelRequest,
  AddMcpServerRequest,
  AddProviderModelsRequest,
  CreateRuleRequest,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteHookEntryRequest,
  DeleteMcpServerRequest,
  DeleteRuleRequest,
  DeleteSkillRequest,
  DesktopDreamOverviewItem,
  DesktopMcpServerInspection,
  DesktopModelProvider,
  DesktopSnapshot,
  GitHubAuthStatus,
  GitHubDeviceAuthChallenge,
  ImportExtensionRequest,
  PreviewModelsRequest,
  PreviewModelsResponse,
  SaveHookEntryRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
} from "@/types";

export type SettingsFormState = {
  activeModel: string;
  imageGenerationModel: string;
  videoGenerationModel: string;
  lightweightChatModel: string;
  apiBase: string;
  uiLocale: string;
  apiKey: string;
  windowsMica: boolean;
  systemNotifications: boolean;
  agentMode: DesktopAgentMode;
  webHostEnabled: boolean;
  webHostHost: string;
  webHostPort: number;
  dreamEnabled: boolean;
  dreamDebugMode: boolean;
  lspEnabled: boolean;
  llmHttpVersion: "http1.1" | "http2";
};

export type SettingsViewProps = {
  tab: SettingsSidebarTab;
  extensionSettingsId?: string | null;
  theme: ThemePreference;
  onThemeChange: (value: ThemePreference) => void;
  font: FontPreference;
  onFontChange: (value: FontPreference) => void;
  clickablePointerCursor: boolean;
  onClickablePointerCursorChange: (enabled: boolean) => void;
  settings: SettingsFormState;
  snapshot: DesktopSnapshot | null;
  apiReady: boolean;
  busyAction: string;
  modelsBusy: boolean;
  modelsPreviewBusy: boolean;
  mcpsBusy: boolean;
  hooksBusy: boolean;
  skillsBusy: boolean;
  rulesBusy: boolean;
  extensionsBusy: boolean;
  lspInstallBusy: boolean;
  isElectronShell: boolean;
  onSavePatch: (patch: Partial<SettingsFormState>) => Promise<void>;
  onInstallLspProvider: (providerId: string) => Promise<void>;
  onResetWebHostPairing?: () => Promise<void>;
  onAddModel: (request: AddModelRequest) => Promise<void>;
  onAddProviderModels: (request: AddProviderModelsRequest) => Promise<void>;
  onPreviewModels: (request: PreviewModelsRequest) => Promise<PreviewModelsResponse>;
  onRemoveModel: (name: string) => Promise<void>;
  onRemoveProviderModels: (provider: DesktopModelProvider) => Promise<void>;
  onAddMcpServer: (request: AddMcpServerRequest) => Promise<void>;
  onImportExtension: (request: ImportExtensionRequest) => Promise<void>;
  onDeleteExtension: (request: DeleteExtensionRequest) => Promise<void>;
  onUpdateExtensionSettings: (request: UpdateExtensionSettingsRequest) => Promise<void>;
  onUpdateExtensionSecret: (request: UpdateExtensionSecretRequest) => Promise<void>;
  onDeleteMcpServer: (request: DeleteMcpServerRequest) => Promise<void>;
  onSaveHookEntry: (request: SaveHookEntryRequest) => Promise<void>;
  onDeleteHookEntry: (request: DeleteHookEntryRequest) => Promise<void>;
  onInspectMcpServer: (name: string) => Promise<DesktopMcpServerInspection>;
  onCreateSkill: (request: CreateSkillRequest) => Promise<void>;
  onDeleteSkill: (request: DeleteSkillRequest) => Promise<void>;
  onCreateRule: (request: CreateRuleRequest) => Promise<void>;
  onDeleteRule: (request: DeleteRuleRequest) => Promise<void>;
  onListDreamsOverview: () => Promise<DesktopDreamOverviewItem[]>;
  /** Skills 页「生成 Skill」：回到主对话区并插入 create-skill Chip，后续直接写自然语言。 */
  onGenerateSkillNavigate?: () => void;
  /** Rules 页「生成规则」：回到主对话区并插入 create-rule Chip。 */
  onGenerateRuleNavigate?: () => void;
  /** 开发者页：在对话区播放上下文压缩 UI 演示（不调用模型）。 */
  onStartCompactionUiDemo?: () => void;
  /** Windows 云母 / macOS Vibrancy：内层透明以避免与 settings-shell 双层 tint 叠深。 */
  useMicaBackdrop?: boolean;
  getGitHubAuthStatus: () => Promise<GitHubAuthStatus>;
  beginGitHubDeviceLogin: () => Promise<GitHubDeviceAuthChallenge>;
  completeGitHubDeviceLogin: () => Promise<GitHubAuthStatus>;
  cancelGitHubDeviceLogin: () => Promise<void>;
  disconnectGitHub: () => Promise<GitHubAuthStatus>;
};
