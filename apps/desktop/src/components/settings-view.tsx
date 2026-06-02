import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/lib/i18n";
import { ChevronsUpDown, LoaderCircle, RefreshCw, Sparkles, X } from "lucide-react";

import { DreamGraphCard } from "@/components/dream-graph-card";
import { FontSelect } from "@/components/font-select";
import type { SettingsSidebarTab } from "@/components/session-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FontPreference } from "@/lib/font";
import { changeLanguage, VALID_LANGUAGES } from "@/lib/i18n";
import type { ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type {
  AddModelRequest,
  AddMcpServerRequest,
  AddProviderModelsRequest,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteMcpServerRequest,
  DeleteSkillRequest,
  DesktopDreamOverviewItem,
  DesktopExtensionListItem,
  DesktopMcpCapabilityToggles,
  DesktopMcpScope,
  DesktopMcpServerInspection,
  DesktopMcpServerListItem,
  DesktopMcpTransportType,
  ImportExtensionRequest,
  RunExtensionRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  DesktopModelProvider,
  DesktopModelCapability,
  DesktopTransportKind,
  DesktopSkillListItem,
  DesktopSkillRootKind,
  DesktopSnapshot,
  PreviewModelsRequest,
  PreviewModelsResponse,
} from "@/types";
import {
  PROVIDER_PICKER_ROWS,
  resolveConnectApiBase,
  resolveProviderConnectApiBase,
} from "@/host/provider-presets";
import { ScrollArea } from "@/components/ui/scroll-area";

export type SettingsFormState = {
  activeModel: string;
  imageGenerationModel: string;
  apiBase: string;
  uiLocale: string;
  apiKey: string;
  windowsMica: boolean;
  planMode: boolean;
  webHostEnabled: boolean;
  webHostHost: string;
  webHostPort: number;
  dreamEnabled: boolean;
  dreamCollectorModel: string;
  dreamDebugMode: boolean;
};

type SettingsViewProps = {
  tab: SettingsSidebarTab;
  extensionSettingsId?: string | null;
  theme: ThemePreference;
  onThemeChange: (value: ThemePreference) => void;
  font: FontPreference;
  onFontChange: (value: FontPreference) => void;
  settings: SettingsFormState;
  snapshot: DesktopSnapshot | null;
  runtimeError: string;
  apiReady: boolean;
  busyAction: string;
  modelsBusy: boolean;
  modelsPreviewBusy: boolean;
  mcpsBusy: boolean;
  skillsBusy: boolean;
  extensionsBusy: boolean;
  isElectronShell: boolean;
  onSavePatch: (patch: Partial<SettingsFormState>) => Promise<void>;
  onResetWebHostPairing?: () => Promise<void>;
  onAddModel: (request: AddModelRequest) => Promise<void>;
  onAddProviderModels: (request: AddProviderModelsRequest) => Promise<void>;
  onPreviewModels: (request: PreviewModelsRequest) => Promise<PreviewModelsResponse>;
  onRemoveModel: (name: string) => Promise<void>;
  onRemoveProviderModels: (provider: DesktopModelProvider) => Promise<void>;
  onAddMcpServer: (request: AddMcpServerRequest) => Promise<void>;
  onImportExtension: (request: ImportExtensionRequest) => Promise<void>;
  onDeleteExtension: (request: DeleteExtensionRequest) => Promise<void>;
  onRunExtension: (request: RunExtensionRequest) => Promise<void>;
  onUpdateExtensionSettings: (request: UpdateExtensionSettingsRequest) => Promise<void>;
  onUpdateExtensionSecret: (request: UpdateExtensionSecretRequest) => Promise<void>;
  onDeleteMcpServer: (request: DeleteMcpServerRequest) => Promise<void>;
  onInspectMcpServer: (name: string) => Promise<DesktopMcpServerInspection>;
  onCreateSkill: (request: CreateSkillRequest) => Promise<void>;
  onDeleteSkill: (request: DeleteSkillRequest) => Promise<void>;
  onListDreamsOverview: () => Promise<DesktopDreamOverviewItem[]>;
  /** Skills 页「生成 Skill」：回到主对话区并预填 `/create-skill `，后续直接写自然语言。 */
  onGenerateSkillNavigate?: () => void;
  /** 开发者页：在对话区播放上下文压缩 UI 演示（不调用模型）。 */
  onStartCompactionUiDemo?: () => void;
};

const themeSelectOptions: Array<{ value: ThemePreference; labelKey: string }> = [
  { value: "system", labelKey: "settings.themeSystem" },
  { value: "light", labelKey: "settings.themeLight" },
  { value: "dark", labelKey: "settings.themeDark" },
];

const settingsPageTitleKey: Record<SettingsSidebarTab, string> = {
  basic: "settings.basic",
  models: "settings.models",
  extensions: "settings.extensions",
  mcps: "settings.mcps",
  skills: "settings.skills",
  dreams: "settings.dreams",
  appearance: "settings.appearance",
  developer: "settings.developer",
};

function formatExtensionInstalledAt(unixMs: number): string {
  return new Date(unixMs).toLocaleString("zh-CN", {
    hour12: false,
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(i18n.t('settings.readFileFailed')));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(i18n.t('settings.readFileFailed')));
        return;
      }
      const marker = "base64,";
      const markerIndex = reader.result.indexOf(marker);
      resolve(markerIndex >= 0 ? reader.result.slice(markerIndex + marker.length) : reader.result);
    };
    reader.readAsDataURL(file);
  });
}

const defaultMcpCapabilities: DesktopMcpCapabilityToggles = {
  tools: true,
  resources: true,
  prompts: true,
};

const defaultCustomModelCapabilities: DesktopModelCapability[] = ["chat", "image"];

type SettingsModelProfile = DesktopSnapshot["config"]["models"][number];

type ModelDefaultAssignments = {
  activeModel: boolean;
  imageGenerationModel: boolean;
};

type ModelDefaultRole = keyof ModelDefaultAssignments;

const modelCapabilityOptions: Array<{
  value: DesktopModelCapability;
  label: string;
  labelKey: string;
  summaryKey: string;
}> = [
  { value: "chat", label: "Chat", labelKey: 'settings.capabilityChatLabel', summaryKey: 'settings.capabilityChat' },
  { value: "image", label: "Image", labelKey: 'settings.capabilityImageLabel', summaryKey: 'settings.capabilityImage' },
  { value: "video", label: "Video", labelKey: 'settings.capabilityVideoLabel', summaryKey: 'settings.capabilityVideo' },
  { value: "imageGeneration", label: "Image generation", labelKey: 'settings.capabilityImageGenerationLabel', summaryKey: 'settings.capabilityImageGeneration' },
];

type ConnectTransportOption = {
  value: DesktopTransportKind;
  label: string;
  summaryKey: string;
};

const connectTransportOptionCatalog = {
  chatCompletions: {
    value: "openai-compatible" as const,
    label: "Chat Completions API",
    summaryKey: 'settings.transportChatCompletions',
  },
  messagesApi: {
    value: "anthropic" as const,
    label: "Messages API",
    summaryKey: 'settings.transportMessagesApi',
  },
  responsesApi: {
    value: "open-responses" as const,
    label: "Responses API",
    summaryKey: 'settings.transportResponsesApi',
  },
  openResponsesApi: {
    value: "open-responses" as const,
    label: "Open Responses API",
    summaryKey: 'settings.transportOpenResponses',
  },
} satisfies Record<string, ConnectTransportOption>;

function connectTransportOptionsForProvider(provider: DesktopModelProvider): ConnectTransportOption[] {
  switch (provider) {
    case "openai":
    case "xai":
      return [connectTransportOptionCatalog.chatCompletions, connectTransportOptionCatalog.responsesApi];
    case "minimax":
    case "deepseek":
      return [connectTransportOptionCatalog.chatCompletions, connectTransportOptionCatalog.messagesApi];
    case "alibaba":
      return [
        connectTransportOptionCatalog.chatCompletions,
        connectTransportOptionCatalog.messagesApi,
        connectTransportOptionCatalog.openResponsesApi,
      ];
    case "vercel-ai-gateway":
    case "custom":
      return [
        connectTransportOptionCatalog.chatCompletions,
        connectTransportOptionCatalog.openResponsesApi,
        connectTransportOptionCatalog.messagesApi,
      ];
    default:
      return [];
  }
}

function defaultConnectTransportKind(provider: DesktopModelProvider): DesktopTransportKind {
  return connectTransportOptionsForProvider(provider)[0]?.value ?? "openai-compatible";
}

function providerSupportsConnectTransportPicker(
  provider: DesktopModelProvider | null,
): provider is DesktopModelProvider {
  return (
    provider === "openai" ||
    provider === "xai" ||
    provider === "minimax" ||
    provider === "deepseek" ||
    provider === "alibaba" ||
    provider === "custom" ||
    provider === "vercel-ai-gateway"
  );
}

function connectTransportOptionSummary(
  option: ConnectTransportOption,
  provider: DesktopModelProvider | null,
): string {
  if (option.value === "open-responses" && provider === "xai") {
    return i18n.t('settings.transportXaiResponses');
  }

  if (option.value === "open-responses" && provider === "vercel-ai-gateway") {
    return i18n.t('settings.transportVercelAiGateway');
  }

  if (option.value === "open-responses" && provider === "alibaba") {
    return i18n.t('settings.transportAlibabaResponses');
  }

  if (option.value === "open-responses" && provider === "custom") {
    return i18n.t(connectTransportOptionCatalog.openResponsesApi.summaryKey);
  }

  return i18n.t(option.summaryKey);
}

function resolveCustomConnectApiBase(
  transportKind: DesktopTransportKind,
  customApiBase: string,
): string {
  return resolveProviderConnectApiBase("custom", transportKind, customApiBase);
}

function modelCapabilityLabel(value: DesktopModelCapability): string {
  const option = modelCapabilityOptions.find((item) => item.value === value);
  return option ? i18n.t(option.labelKey, { defaultValue: option.label }) : value;
}

function normalizeModelCapabilitySelection(
  values: readonly DesktopModelCapability[],
): DesktopModelCapability[] {
  const allowed = new Set(modelCapabilityOptions.map((option) => option.value));
  const seen = new Set<DesktopModelCapability>();
  const normalized: DesktopModelCapability[] = [];
  for (const value of values) {
    if (!allowed.has(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized.length > 0 ? normalized : [...defaultCustomModelCapabilities];
}

function canAssignAsActiveModel(
  model: SettingsModelProfile,
  isCurrentActiveModel: boolean,
): boolean {
  return isCurrentActiveModel || model.capabilities === undefined || model.capabilities.includes("chat");
}

function canAssignAsImageGenerationModel(
  model: SettingsModelProfile,
  isCurrentImageGenerationModel: boolean,
): boolean {
  return isCurrentImageGenerationModel || model.capabilities?.includes("imageGeneration") === true;
}

function getSupportedModelDefaultRoles(
  model: SettingsModelProfile,
  activeModel: string,
  imageGenerationModel: string,
): ModelDefaultRole[] {
  const roles: ModelDefaultRole[] = [];

  if (canAssignAsActiveModel(model, model.name === activeModel)) {
    roles.push("activeModel");
  }

  if (canAssignAsImageGenerationModel(model, model.name === imageGenerationModel)) {
    roles.push("imageGenerationModel");
  }

  return roles;
}

function modelDefaultActionLabel(roles: readonly ModelDefaultRole[]): string {
  if (roles.length === 0) {
    return i18n.t('settings.noDefaultRoles');
  }

  if (roles.length === 1) {
    return roles[0] === "activeModel" ? i18n.t('settings.setActiveModel') : i18n.t('settings.setImageGenModel');
  }

  return i18n.t('settings.selectDefaultRole');
}

function ModelCapabilitiesCombobox({
  value,
  disabled,
  onChange,
}: {
  value: DesktopModelCapability[];
  disabled?: boolean;
  onChange: (value: DesktopModelCapability[]) => void;
}) {
  const { t } = useTranslation();
  const selected = normalizeModelCapabilitySelection(value);
  const selectedOptions = modelCapabilityOptions.filter((option) =>
    selected.includes(option.value),
  );
  const selectedSet = new Set(selected);

  const toggleCapability = (capability: DesktopModelCapability, checked: boolean) => {
    const next = checked
      ? [...selected, capability]
      : selected.filter((item) => item !== capability);
    onChange(normalizeModelCapabilitySelection(next));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex min-h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-transparent py-1 pr-2.5 pl-1.5 text-sm shadow-xs transition-colors outline-none dark:bg-input/30",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {selectedOptions.length > 0 ? (
              selectedOptions.map((option) => {
                const label = t(option.labelKey, { defaultValue: option.label });
                return (
                  <span
                    key={option.value}
                    className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-muted/50 px-1.5 py-0.5 text-xs text-foreground"
                  >
                    <span className="truncate">{label}</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={t('settings.removeCapability', { label })}
                    className="rounded-sm text-muted-foreground hover:text-foreground"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleCapability(option.value, false);
                    }}
                  >
                    <X className="size-3" aria-hidden />
                  </span>
                  </span>
                );
              })
            ) : (
              <span className="px-1 text-muted-foreground">{t('settings.selectCapability')}</span>
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-[var(--radix-dropdown-menu-trigger-width)]"
      >
        {modelCapabilityOptions.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selectedSet.has(option.value)}
            onCheckedChange={(checked) => toggleCapability(option.value, checked)}
            onSelect={(event) => event.preventDefault()}
            className="items-start gap-2 py-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{t(option.labelKey, { defaultValue: option.label })}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {t(option.summaryKey)}
              </span>
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function mcpTransportTypeLabel(type: DesktopMcpTransportType): string {
  return type === "http" ? "HTTP" : "Stdio";
}

function mcpMetadataLabel(type: DesktopMcpTransportType): string {
  return type === "http" ? "Headers" : i18n.t('settings.envVars');
}

function mcpEndpointLabel(type: DesktopMcpTransportType): string {
  return type === "http" ? "URL" : i18n.t('settings.command');
}

function mcpEndpointPlaceholder(type: DesktopMcpTransportType): string {
  return type === "http"
    ? i18n.t('settings.mcpUrlExample')
    : i18n.t('settings.mcpCommandExample');
}

function mcpMetadataPlaceholder(type: DesktopMcpTransportType): string {
  return type === "http"
    ? "Authorization: Bearer ${env:GITHUB_TOKEN}; X-Client: spirit-agent"
    : "PATH=C:/Tools; NODE_ENV=production";
}

function mcpCapabilitiesLabel(item: DesktopMcpServerListItem): string {
  const enabled: string[] = [];
  if (item.capabilities.tools) {
    enabled.push("tools");
  }
  if (item.capabilities.resources) {
    enabled.push("resources");
  }
  if (item.capabilities.prompts) {
    enabled.push("prompts");
  }
  return enabled.length > 0 ? enabled.join(" / ") : "none";
}

function formatMcpMetadata(metadata: Record<string, string>, type: DesktopMcpTransportType): string {
  const entries = Object.entries(metadata);
  if (entries.length === 0) {
    return "";
  }
  return entries
    .map(([key, value]) => (type === "http" ? `${key}: ${value}` : `${key}=${value}`))
    .join("; ");
}

type McpServerRuntimeBadgeState = "loading" | "ready" | "error" | "disabled";

type McpServerRuntimeInfo = {
  state: McpServerRuntimeBadgeState;
  counts?: {
    tools: number;
    resources: number;
    prompts: number;
  };
};

function mcpCountsSummary(runtime?: McpServerRuntimeInfo): string {
  const tools = runtime?.state === "ready" ? String(runtime.counts?.tools ?? 0) : "-";
  const resources = runtime?.state === "ready" ? String(runtime.counts?.resources ?? 0) : "-";
  const prompts = runtime?.state === "ready" ? String(runtime.counts?.prompts ?? 0) : "-";
  return i18n.t('settings.mcpCountsSummary', { tools, resources, prompts });
}

function McpRuntimeBadge({ state }: { state: McpServerRuntimeBadgeState }) {
  if (state === "ready") {
    return <Badge>{i18n.t('settings.active')}</Badge>;
  }

  if (state === "error") {
    return <Badge variant="destructive">{i18n.t('settings.failed')}</Badge>;
  }

  if (state === "disabled") {
    return <Badge variant="outline">{i18n.t('settings.disabled')}</Badge>;
  }

  return (
    <Badge variant="outline" className="gap-1.5">
      <LoaderCircle className="size-3 animate-spin" aria-hidden />
      {i18n.t('common.loading')}
    </Badge>
  );
}

function skillRootKindLabel(rootKind: DesktopSkillRootKind): string {
  if (rootKind === "user") {
    return i18n.t('settings.skillUserDir');
  }
  if (rootKind === "workspaceSpirit") {
    return i18n.t('settings.skillWorkspaceSpirit');
  }
  return i18n.t('settings.skillWorkspaceAgents');
}

function skillLocationLabel(item: DesktopSkillListItem): string {
  return skillRootKindLabel(item.rootKind);
}

function webHostStatusLabel(state: DesktopSnapshot["webHost"]["status"]["state"]): string {
  switch (state) {
    case "running":
      return i18n.t('settings.webHostRunning');
    case "starting":
      return i18n.t('settings.webHostStarting');
    case "error":
      return i18n.t('settings.webHostError');
    case "stopped":
      return i18n.t('settings.webHostStopped');
    default:
      return i18n.t('settings.webHostClosed');
  }
}

function dreamCollectorStateLabel(state: DesktopSnapshot["dreams"]["collector"]["state"]): string {
  switch (state) {
    case "disabled":
      return i18n.t('settings.dreamDisabled');
    case "missing-model":
      return i18n.t('settings.dreamMissingModel');
    case "running":
      return i18n.t('settings.dreamCollecting');
    case "backoff":
      return i18n.t('settings.dreamBackoff');
    case "error":
      return i18n.t('settings.dreamError');
    default:
      return i18n.t('settings.dreamIdle');
  }
}

function formatSettingsTime(unixMs?: number): string {
  if (typeof unixMs !== "number") {
    return "—";
  }
  return new Date(unixMs).toLocaleString("zh-CN", { hour12: false });
}

function SettingsRow({
  label,
  description,
  htmlFor,
  children,
  className,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-border/35 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6",
        className,
      )}
    >
      <div className="min-w-0 sm:max-w-[42%]">
        <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </Label>
        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="min-w-0 w-full sm:w-auto sm:max-w-[min(24rem,52vw)] sm:flex-1 sm:flex sm:justify-end">
        {children}
      </div>
    </div>
  );
}

function BasicSettingsPanel({
  settings,
  snapshot,
  onSavePatch,
  onResetWebHostPairing,
}: Pick<
  SettingsViewProps,
  "settings" | "snapshot" | "onSavePatch" | "onResetWebHostPairing"
>) {
  const { t } = useTranslation();
  const webHost = snapshot?.webHost;
  const webHostUrl =
    webHost?.status.url ?? `http://${settings.webHostHost}:${settings.webHostPort}`;
  const webHostStatus = webHostStatusLabel(webHost?.status.state ?? "disabled");

  const [webHostHostDraft, setWebHostHostDraft] = useState(settings.webHostHost);
  const [webHostPortDraft, setWebHostPortDraft] = useState(String(settings.webHostPort));

  useEffect(() => {
    setWebHostHostDraft(settings.webHostHost);
  }, [settings.webHostHost]);

  useEffect(() => {
    setWebHostPortDraft(String(settings.webHostPort));
  }, [settings.webHostPort]);

  return (
    <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80 px-4 sm:px-5">
      <SettingsRow label={t('settings.uiLocale')} description={t('settings.uiLocaleDescription')} htmlFor="settings-locale">
        <Select
          value={settings.uiLocale}
          onValueChange={(value) => {
            void changeLanguage(value);
            void onSavePatch({ uiLocale: value });
          }}
        >
          <SelectTrigger id="settings-locale" className="w-40 sm:text-right">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VALID_LANGUAGES.map((lang) => (
              <SelectItem key={lang} value={lang}>
                {lang === 'zh-CN' ? t('settings.langZhCN') : t('settings.langEn')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        label={t('settings.webRemoteAccess')}
        description={t('settings.webRemoteAccessDescription')}
        htmlFor="settings-web-host-enabled"
      >
        <div className="flex items-center justify-end gap-3">
          <span className="truncate text-sm text-muted-foreground">
            {settings.webHostEnabled ? webHostStatus : t('settings.webHostClosed')}
          </span>
          <Checkbox
            id="settings-web-host-enabled"
            checked={settings.webHostEnabled}
            onCheckedChange={(value) =>
              void onSavePatch({ webHostEnabled: value === true })
            }
            className="size-5"
          />
        </div>
      </SettingsRow>

      <SettingsRow
        label={t('settings.listenAddress')}
        description={t('settings.listenAddressDescription')}
        htmlFor="settings-web-host-host"
      >
        <Input
          id="settings-web-host-host"
          className="sm:text-right"
          value={webHostHostDraft}
          onChange={(event) => setWebHostHostDraft(event.target.value)}
          onBlur={() => {
            const next = webHostHostDraft.trim();
            if (next && next !== settings.webHostHost) {
              void onSavePatch({ webHostHost: next });
            }
          }}
          disabled={!settings.webHostEnabled}
          placeholder="127.0.0.1"
        />
      </SettingsRow>

      <SettingsRow label={t('settings.listenPort')} htmlFor="settings-web-host-port">
        <Input
          id="settings-web-host-port"
          className="sm:text-right"
          type="number"
          min={1}
          max={65535}
          value={webHostPortDraft}
          onChange={(event) => setWebHostPortDraft(event.target.value)}
          onBlur={() => {
            const port = Number.parseInt(webHostPortDraft, 10);
            if (Number.isInteger(port) && port >= 1 && port <= 65535 && port !== settings.webHostPort) {
              void onSavePatch({ webHostPort: port });
            }
          }}
          disabled={!settings.webHostEnabled}
          placeholder="7788"
        />
      </SettingsRow>

      <div className="py-4">
        <p className="text-sm font-medium text-foreground">{t('settings.remoteStatus')}</p>
        <div className="mt-2 grid gap-1 text-sm text-muted-foreground sm:text-right">
          <p className="truncate">
            <span className="text-foreground">{settings.webHostEnabled ? webHostStatus : t('settings.webHostClosed')}</span>
            {settings.webHostEnabled ? ` · ${webHostUrl}` : null}
          </p>
          {webHost?.status.error ? (
            <p className="break-words text-destructive">{webHost.status.error}</p>
          ) : null}
          <p>
            {t('settings.pairing')}{webHost?.config.paired ? t('settings.pairingDone') : t('settings.pairingPending')}
          </p>
          {webHost?.status.pairingCode ? (
            <p className="font-mono text-foreground">{webHost.status.pairingCode}</p>
          ) : null}
          {settings.webHostEnabled && webHost?.config.paired && onResetWebHostPairing ? (
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-muted-foreground"
                onClick={() => void onResetWebHostPairing()}
              >
                {t('settings.resetPairing')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="py-4">
        <p className="text-sm font-medium text-foreground">{t('settings.runtimeOverview')}</p>
        <p className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>
            Rules{" "}
            <span className="font-medium text-foreground">
              {snapshot ? `${snapshot.rules.enabled}/${snapshot.rules.discovered}` : "—"}
            </span>
          </span>
          <span>
            Skills{" "}
            <span className="font-medium text-foreground">
              {snapshot ? `${snapshot.skills.enabled}/${snapshot.skills.discovered}` : "—"}
            </span>
          </span>
          <span>
            MCP{" "}
            <span className="font-medium text-foreground">
              {snapshot ? String(snapshot.mcpStatus.cachedTools) : "—"}
            </span>
          </span>
        </p>
      </div>

    </div>
  );
}

function DeveloperSettingsPanel({
  onStartCompactionUiDemo,
}: Pick<SettingsViewProps, "onStartCompactionUiDemo">) {
  const { t } = useTranslation();
  return (
    <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80 px-4 sm:px-5">
      <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">{t('settings.compactionDemoTitle')}</p>
          <p className="text-xs leading-5 text-muted-foreground">
            {t('settings.compactionDemoDescription')}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 self-start sm:self-center"
          disabled={!onStartCompactionUiDemo}
          onClick={() => onStartCompactionUiDemo?.()}
        >
          {t('settings.demoInConversation')}
        </Button>
      </div>
    </div>
  );
}

const skillCreateRootOptions: Array<{
  kind: DesktopSkillRootKind;
  labelKey?: string;
  labelFallback: string;
  hintKey: string;
}> = [
  { kind: "user", labelKey: 'settings.skillUserDirShort', labelFallback: 'User', hintKey: 'settings.skillUserDirHint' },
  { kind: "workspaceSpirit", labelFallback: ".spirit", hintKey: 'settings.skillWorkspaceSpiritHint' },
  { kind: "workspaceAgents", labelFallback: ".agents", hintKey: 'settings.skillWorkspaceAgentsHint' },
];

function SkillsSettingsPanel({
  snapshot,
  skillsBusy,
  apiReady,
  onCreateSkill,
  onDeleteSkill,
  onGenerateSkillNavigate,
}: Pick<
  SettingsViewProps,
  | "snapshot"
  | "skillsBusy"
  | "apiReady"
  | "onCreateSkill"
  | "onDeleteSkill"
  | "onGenerateSkillNavigate"
>) {
  const { t } = useTranslation();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteSkillRequest | null>(null);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [createRootKind, setCreateRootKind] = useState<DesktopSkillRootKind>("user");

  const workspaceBindingDisabled = snapshot?.workspaceBinding === "none";
  const items = (snapshot?.skillsList ?? []).filter(
    (item) => !workspaceBindingDisabled || item.scope === "user",
  );
  const availableSkillCreateRootOptions = workspaceBindingDisabled
    ? skillCreateRootOptions.filter((option) => option.kind === "user")
    : skillCreateRootOptions;
  const localizedSkillCreateRootOptions = availableSkillCreateRootOptions.map((option) => ({
    ...option,
    label: option.labelKey ? t(option.labelKey) : option.labelFallback,
    hint: t(option.hintKey),
  }));

  const resetForm = () => {
    setNewName("");
    setNewDescription("");
    setCreateRootKind("user");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Skills</h1>
          <p className="text-sm text-muted-foreground">{t('settings.skillsDescription')}</p>
          {workspaceBindingDisabled ? (
            <p className="text-xs text-muted-foreground">{t('app.noWorkspaceBindingHint')}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onGenerateSkillNavigate ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              disabled={!apiReady}
              title={t('settings.generateSkillTooltip')}
              onClick={() => onGenerateSkillNavigate()}
            >
              <Sparkles className="size-3.5 shrink-0" aria-hidden />
              {t('settings.generateSkill')}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            onClick={() => {
              resetForm();
              setAddDialogOpen(true);
            }}
            disabled={skillsBusy}
          >
            {t('settings.newSkill')}
          </Button>
        </div>
      </div>

      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('settings.noSkillsFound')}</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{item.name}</span>
                  <Badge variant="secondary" className="text-muted-foreground">
                    {skillLocationLabel(item)}
                  </Badge>
                  {!item.enabled ? (
                    <Badge variant="secondary" className="text-muted-foreground">
                      {t('settings.skillDisabled')}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{item.description}</p>
                <p className="truncate font-mono text-[0.65rem] text-muted-foreground/90" title={item.shortLabel}>
                  {item.shortLabel}
                </p>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="shrink-0 self-start sm:self-center"
                disabled={skillsBusy}
                onClick={() => setDeleteTarget({ name: item.name, rootKind: item.rootKind })}
              >
                {t('common.delete')}
              </Button>
            </div>
          ))
        )}
      </div>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t('settings.deleteSkill')}</DialogTitle>
            <DialogDescription>
              {t('settings.deleteSkillConfirm', { name: deleteTarget?.name ?? '', location: deleteTarget ? skillRootKindLabel(deleteTarget.rootKind) : '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={skillsBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={skillsBusy || !deleteTarget}
              onClick={() => {
                const target = deleteTarget;
                if (!target) {
                  return;
                }
                void (async () => {
                  try {
                    await onDeleteSkill(target);
                    setDeleteTarget(null);
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {skillsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t('common.delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          setAddDialogOpen(open);
          if (!open) {
            resetForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t('settings.newSkill')}</DialogTitle>
            <DialogDescription>{t('settings.newSkillDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label>{t('settings.saveLocation')}</Label>
              <div
                role="tablist"
                aria-label={t('settings.saveLocation')}
                className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
              >
                {localizedSkillCreateRootOptions.map((opt) => (
                  <button
                    key={opt.kind}
                    type="button"
                    role="tab"
                    aria-selected={createRootKind === opt.kind}
                    className={cn(
                      "rounded-md px-2.5 text-xs font-medium transition-colors",
                      createRootKind === opt.kind
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    disabled={skillsBusy}
                    title={opt.hint}
                    onClick={() => setCreateRootKind(opt.kind)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {localizedSkillCreateRootOptions.find((o) => o.kind === createRootKind)?.hint}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-skill-name">{t('settings.name')}</Label>
              <Input
                id="new-skill-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('settings.skillNamePlaceholder')}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-skill-desc">{t('settings.description')}</Label>
              <Input
                id="new-skill-desc"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder={t('settings.skillDescPlaceholder')}
                autoComplete="off"
                required
              />
            </div>
          </div>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAddDialogOpen(false)}
              disabled={skillsBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                skillsBusy || !newName.trim() || !newDescription.trim()
              }
              onClick={() => {
                void (async () => {
                  try {
                    const payload: CreateSkillRequest = {
                      name: newName,
                      rootKind: createRootKind,
                      description: newDescription.trim(),
                    };
                    await onCreateSkill(payload);
                    setAddDialogOpen(false);
                    resetForm();
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {skillsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t('common.create')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ExtensionConfigurationPanel({
  item,
  extensionsBusy,
  onUpdateExtensionSettings,
  onUpdateExtensionSecret,
}: {
  item: DesktopExtensionListItem;
  extensionsBusy: boolean;
  onUpdateExtensionSettings: (request: UpdateExtensionSettingsRequest) => Promise<void>;
  onUpdateExtensionSecret: (request: UpdateExtensionSecretRequest) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>({});
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});

  const settingDraftKey = (extensionId: string, key: string) => `${extensionId}::setting::${key}`;
  const secretDraftKey = (extensionId: string, key: string) => `${extensionId}::secret::${key}`;

  const updateSettingDraft = (extensionId: string, key: string, value: string) => {
    setSettingDrafts((current) => ({
      ...current,
      [settingDraftKey(extensionId, key)]: value,
    }));
  };

  const updateSecretDraft = (extensionId: string, key: string, value: string) => {
    setSecretDrafts((current) => ({
      ...current,
      [secretDraftKey(extensionId, key)]: value,
    }));
  };

  const currentSettingText = (
    item: DesktopExtensionListItem,
    key: string,
    fallback?: string | boolean | number,
  ): string => {
    const draft = settingDrafts[settingDraftKey(item.id, key)];
    if (draft !== undefined) {
      return draft;
    }

    const value = item.settingsValues?.[key] ?? fallback;
    return value === undefined || value === null ? "" : String(value);
  };

  const hasSettings = Boolean(item.settingsSchema?.length);
  const hasSecrets = Boolean(item.secretSlots?.length);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {item.desktopSettingsPage?.title ?? item.displayName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {item.description ?? t('settings.extensionSettingsDescription', { id: item.id })}
        </p>
      </div>

      {!hasSettings && !hasSecrets ? (
        <div className="rounded-lg border border-border/40 bg-background/80 px-4 py-10 text-center text-sm text-muted-foreground">
          {t('settings.noExtensionSettings')}
        </div>
      ) : (
        <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80 px-4 sm:px-5">
          {item.settingsSchema?.map((setting) => {
            const fieldKey = settingDraftKey(item.id, setting.key);
            const currentText = currentSettingText(item, setting.key, setting.defaultValue);

            if (setting.type === "boolean") {
              const checked = Boolean(
                item.settingsValues?.[setting.key] ?? setting.defaultValue ?? false,
              );
              return (
                <SettingsRow
                  key={fieldKey}
                  label={setting.title}
                  description={setting.description}
                  htmlFor={fieldKey}
                >
                  <div className="flex justify-end">
                    <Checkbox
                      id={fieldKey}
                      checked={checked}
                      disabled={extensionsBusy}
                      onCheckedChange={(value) => {
                        void onUpdateExtensionSettings({
                          id: item.id,
                          values: { [setting.key]: value === true },
                        });
                      }}
                      className="size-5"
                    />
                  </div>
                </SettingsRow>
              );
            }

            if (setting.type === "select") {
              const selected = currentText || String(setting.defaultValue ?? "");
              return (
                <SettingsRow
                  key={fieldKey}
                  label={setting.title}
                  description={setting.description}
                  htmlFor={fieldKey}
                >
                  <Select
                    value={selected}
                    onValueChange={(value) => {
                      void onUpdateExtensionSettings({
                        id: item.id,
                        values: { [setting.key]: value || null },
                      });
                    }}
                    disabled={extensionsBusy}
                  >
                    <SelectTrigger id={fieldKey} className="w-full sm:min-w-[14rem]">
                      <SelectValue placeholder={setting.placeholder ?? setting.title} />
                    </SelectTrigger>
                    <SelectContent>
                      {setting.options?.map((option) => (
                        <SelectItem key={`${fieldKey}:${option.value}`} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingsRow>
              );
            }

            return (
              <SettingsRow
                key={fieldKey}
                label={setting.title}
                description={setting.description}
                htmlFor={fieldKey}
              >
                <div className="flex w-full gap-2 sm:max-w-md">
                  <Input
                    id={fieldKey}
                    value={currentText}
                    disabled={extensionsBusy}
                    type={setting.type === "number" ? "number" : "text"}
                    placeholder={setting.placeholder ?? setting.title}
                    onChange={(event) => updateSettingDraft(item.id, setting.key, event.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={extensionsBusy}
                    onClick={() => {
                      const raw = settingDrafts[fieldKey] ?? currentText;
                      const value =
                        setting.type === "number"
                          ? raw.trim().length === 0
                            ? null
                            : Number(raw)
                          : raw.trim().length === 0
                            ? null
                            : raw;
                      void onUpdateExtensionSettings({
                        id: item.id,
                        values: { [setting.key]: value },
                      });
                    }}
                  >
                    {t('common.save')}
                  </Button>
                </div>
              </SettingsRow>
            );
          })}

          {item.secretSlots?.map((slot) => {
            const fieldKey = secretDraftKey(item.id, slot.key);
            const configured = item.secretStatuses?.find((entry) => entry.key === slot.key)?.configured === true;
            return (
              <SettingsRow
                key={fieldKey}
                label={slot.title}
                description={slot.description}
                htmlFor={fieldKey}
              >
                <div className="flex w-full flex-wrap justify-end gap-2 sm:max-w-md">
                  <Badge variant={configured ? "secondary" : "outline"} className="h-9 px-3 text-muted-foreground">
                    {configured ? t('settings.configured') : t('settings.notConfigured')}
                  </Badge>
                  <Input
                    id={fieldKey}
                    type="password"
                    value={secretDrafts[fieldKey] ?? ""}
                    disabled={extensionsBusy}
                    placeholder={configured ? t('settings.enterNewValue') : t('settings.enterSecret')}
                    onChange={(event) => updateSecretDraft(item.id, slot.key, event.target.value)}
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={extensionsBusy}
                    onClick={() => {
                      void onUpdateExtensionSecret({
                        id: item.id,
                        key: slot.key,
                        value: secretDrafts[fieldKey] ?? "",
                      });
                      updateSecretDraft(item.id, slot.key, "");
                    }}
                  >
                    {t('common.save')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={extensionsBusy || !configured}
                    onClick={() => {
                      void onUpdateExtensionSecret({
                        id: item.id,
                        key: slot.key,
                        value: "",
                      });
                      updateSecretDraft(item.id, slot.key, "");
                    }}
                  >
                    {t('common.clear')}
                  </Button>
                </div>
              </SettingsRow>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ExtensionsSettingsPanel({
  snapshot,
  extensionsBusy,
  onImportExtension,
  onDeleteExtension,
  onRunExtension,
}: Pick<
  SettingsViewProps,
  | "snapshot"
  | "extensionsBusy"
  | "onImportExtension"
  | "onDeleteExtension"
  | "onRunExtension"
>) {
  const { t } = useTranslation();
  const [deleteTarget, setDeleteTarget] = useState<DesktopExtensionListItem | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const items = snapshot?.extensionsList ?? [];

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) {
            return;
          }

          void (async () => {
            try {
              const archiveBase64 = await fileToBase64(file);
              await onImportExtension({
                archiveBase64,
                fileName: file.name,
              });
            } catch {
              /* runtimeError */
            }
          })();
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{t('settings.extensionsTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('settings.extensionsDescription')}</p>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          disabled={extensionsBusy}
          onClick={() => inputRef.current?.click()}
        >
          {t('settings.importZip')}
        </Button>
      </div>

      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('settings.noExtensionsInstalled')}</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{item.displayName}</span>
                  <Badge variant="secondary" className="text-muted-foreground">
                    {item.version}
                  </Badge>
                  {item.author ? (
                    <Badge variant="secondary" className="text-muted-foreground">
                      {item.author}
                    </Badge>
                  ) : null}
                  {item.desktopSettingsPage ? (
                    <Badge variant="outline" className="text-muted-foreground">
                      {t('settings.settingsPage')}
                    </Badge>
                  ) : null}
                </div>
                {item.description ? (
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                ) : null}
                <p className="truncate font-mono text-[0.65rem] text-muted-foreground/90" title={item.id}>
                  {item.id}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('settings.installedAt')}{formatExtensionInstalledAt(item.installedAtUnixMs)}
                  {item.archiveFileName ? ` · ${t('settings.source')}${item.archiveFileName}` : ""}
                  {item.main ? ` · main: ${item.main}` : ""}
                </p>
                {item.activationEvents?.length ? (
                  <p className="text-xs text-muted-foreground">
                    activationEvents: {item.activationEvents.join(", ")}
                  </p>
                ) : null}
                {item.contributedTools?.length ? (
                  <div className="space-y-1 pt-1">
                    <p className="text-xs font-medium text-foreground">{t('settings.contributedTools')}</p>
                    {item.contributedTools.map((tool) => (
                      <div key={`${item.id}:${tool.name}`} className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-foreground">{tool.name}</span>
                          {tool.approvalMode ? (
                            <Badge variant="outline" className="text-[0.65rem] text-muted-foreground">
                              {tool.approvalMode}
                            </Badge>
                          ) : null}
                          {tool.executionMode ? (
                            <Badge variant="outline" className="text-[0.65rem] text-muted-foreground">
                              {tool.executionMode}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{tool.description}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {item.desktopCss?.length ? (
                  <div className="space-y-1 pt-1">
                    <p className="text-xs font-medium text-foreground">Desktop CSS</p>
                    {item.desktopCss.map((entry) => (
                      <div
                        key={`${item.id}:desktop-css:${entry.path}`}
                        className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="text-[0.7rem] text-foreground">{entry.path}</code>
                          {entry.media ? (
                            <Badge variant="outline" className="text-[0.65rem] text-muted-foreground">
                              media: {entry.media}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t('settings.desktopCssDescription')}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {item.cliHooks?.length ? (
                  <div className="space-y-1 pt-1">
                    <p className="text-xs font-medium text-foreground">CLI Hooks</p>
                    {item.cliHooks.map((hook, index) => (
                      <div
                        key={`${item.id}:cli-hook:${hook.slot}:${index}`}
                        className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="text-[0.7rem] text-foreground">{hook.slot}</code>
                          {hook.variant ? (
                            <Badge variant="outline" className="text-[0.65rem] text-muted-foreground">
                              variant: {hook.variant}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t('settings.cliHookDescription')}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={extensionsBusy || !item.main}
                  onClick={() => {
                    void (async () => {
                      try {
                        await onRunExtension({ id: item.id });
                      } catch {
                        /* runtimeError */
                      }
                    })();
                  }}
                >
                  {t('settings.runManually')}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={extensionsBusy}
                  onClick={() => setDeleteTarget(item)}
                >
                  {t('common.delete')}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t('settings.deleteExtension')}</DialogTitle>
            <DialogDescription>
              {t('settings.deleteExtensionConfirm', { name: deleteTarget?.displayName ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={extensionsBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={extensionsBusy || !deleteTarget}
              onClick={() => {
                const target = deleteTarget;
                if (!target) {
                  return;
                }
                void (async () => {
                  try {
                    await onDeleteExtension({ id: target.id });
                    setDeleteTarget(null);
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {extensionsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t('common.delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const mcpCreateScopeOptions: Array<{
  scope: DesktopMcpScope;
  labelKey: string;
  hintKey: string;
}> = [
  { scope: "user", labelKey: "settings.skillUserDirShort", hintKey: "settings.mcpUserDirHint" },
  { scope: "workspace", labelKey: "settings.mcpScopeWorkspace", hintKey: "settings.mcpWorkspaceSpiritHint" },
];

function McpsSettingsPanel({
  snapshot,
  mcpsBusy,
  onAddMcpServer,
  onDeleteMcpServer,
  onInspectMcpServer,
}: Pick<
  SettingsViewProps,
  "snapshot" | "mcpsBusy" | "onAddMcpServer" | "onDeleteMcpServer" | "onInspectMcpServer"
>) {
  const { t } = useTranslation();
  const workspaceBindingDisabled = snapshot?.workspaceBinding === "none";
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteMcpServerRequest | null>(null);
  const [createScope, setCreateScope] = useState<DesktopMcpScope>(
    workspaceBindingDisabled ? "user" : "workspace",
  );
  const [transportType, setTransportType] = useState<DesktopMcpTransportType>("stdio");
  const [newName, setNewName] = useState("");
  const [newEndpoint, setNewEndpoint] = useState("");
  const [newMetadata, setNewMetadata] = useState("");
  const [capabilities, setCapabilities] = useState<DesktopMcpCapabilityToggles>(defaultMcpCapabilities);
  const [runtimeInfo, setRuntimeInfo] = useState<Record<string, McpServerRuntimeInfo>>({});

  const items = snapshot?.mcpServers ?? [];
  const availableMcpCreateScopeOptions = workspaceBindingDisabled
    ? mcpCreateScopeOptions.filter((option) => option.scope === "user")
    : mcpCreateScopeOptions;
  const localizedMcpCreateScopeOptions = availableMcpCreateScopeOptions.map((option) => ({
    ...option,
    label: t(option.labelKey),
    hint: t(option.hintKey),
  }));

  useEffect(() => {
    let cancelled = false;
    const keys = new Set(items.map((item) => `${item.scope}:${item.name}`));

    setRuntimeInfo((current) => {
      const next: Record<string, McpServerRuntimeInfo> = {};
      for (const item of items) {
        const key = `${item.scope}:${item.name}`;
        next[key] = item.enabled
          ? { state: "loading" }
          : { state: "disabled" };
      }
      for (const [key, info] of Object.entries(current)) {
        if (keys.has(key) && next[key]?.state === "disabled") {
          next[key] = info;
        }
      }
      return next;
    });

    void Promise.all(
      items.map(async (item) => {
        if (!item.enabled) {
          return;
        }
        const key = `${item.scope}:${item.name}`;

        try {
          const inspection = await onInspectMcpServer(item.name);
          if (cancelled) {
            return;
          }
          setRuntimeInfo((current) => ({
            ...current,
            [key]: {
              state: "ready",
              counts: {
                tools: inspection.toolsCount,
                resources: inspection.resourcesCount,
                prompts: inspection.promptsCount,
              },
            },
          }));
        } catch {
          if (cancelled) {
            return;
          }
          setRuntimeInfo((current) => ({
            ...current,
            [key]: {
              state: "error",
            },
          }));
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [items, onInspectMcpServer]);

  const resetForm = () => {
    setCreateScope(workspaceBindingDisabled ? "user" : "workspace");
    setTransportType("stdio");
    setNewName("");
    setNewEndpoint("");
    setNewMetadata("");
    setCapabilities(defaultMcpCapabilities);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">MCPs</h1>
          <p className="text-sm text-muted-foreground">{t('settings.mcpsDescription')}</p>
          {workspaceBindingDisabled ? (
            <p className="text-xs text-muted-foreground">{t('app.noWorkspaceBindingHint')}</p>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          onClick={() => {
            resetForm();
            setAddDialogOpen(true);
          }}
          disabled={mcpsBusy}
        >
          {t('settings.addMcp')}
        </Button>
      </div>

      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('settings.noMcpsConfigured')}</p>
        ) : (
          items.map((item) => {
            const runtimeKey = `${item.scope}:${item.name}`;
            return (
            <div
              key={runtimeKey}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{item.displayName}</span>
                  <McpRuntimeBadge state={runtimeInfo[runtimeKey]?.state ?? (item.enabled ? "loading" : "disabled")} />
                  <Badge variant="outline" className="text-muted-foreground">
                    {item.scope === "user" ? t('settings.skillUserDirShort') : t('settings.mcpScopeWorkspace')}
                  </Badge>
                  <Badge variant="secondary" className="text-muted-foreground">
                    {mcpTransportTypeLabel(item.transport.type)}
                  </Badge>
                  {!item.enabled ? (
                    <Badge variant="secondary" className="text-muted-foreground">
                      {t('settings.mcpDisabled')}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{item.transport.summary}</p>
                <p className="text-xs text-muted-foreground">{mcpCountsSummary(runtimeInfo[runtimeKey])}</p>
                {Object.keys(item.transport.metadata).length > 0 ? (
                  <p
                    className="truncate font-mono text-[0.65rem] text-muted-foreground/90"
                    title={formatMcpMetadata(item.transport.metadata, item.transport.type)}
                  >
                    {formatMcpMetadata(item.transport.metadata, item.transport.type)}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="shrink-0 self-start sm:self-center"
                disabled={mcpsBusy}
                onClick={() => setDeleteTarget({ name: item.name, scope: item.scope })}
              >
                {t('common.delete')}
              </Button>
            </div>
            );
          })
        )}
      </div>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t('settings.deleteMcp')}</DialogTitle>
            <DialogDescription>
              {t('settings.deleteMcpConfirm', { name: deleteTarget?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={mcpsBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={mcpsBusy || !deleteTarget}
              onClick={() => {
                const target = deleteTarget;
                if (!target) {
                  return;
                }
                void (async () => {
                  try {
                    await onDeleteMcpServer(target);
                    setDeleteTarget(null);
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {mcpsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t('common.delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          setAddDialogOpen(open);
          if (!open) {
            resetForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-lg" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t('settings.addMcp')}</DialogTitle>
            <DialogDescription>{t('settings.addMcpDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label>{t('settings.saveLocation')}</Label>
              <div
                role="tablist"
                aria-label={t('settings.saveLocation')}
                className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
              >
                {localizedMcpCreateScopeOptions.map((opt) => (
                  <button
                    key={opt.scope}
                    type="button"
                    role="tab"
                    aria-selected={createScope === opt.scope}
                    className={cn(
                      "rounded-md px-2.5 text-xs font-medium transition-colors",
                      createScope === opt.scope
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    disabled={mcpsBusy}
                    title={opt.hint}
                    onClick={() => setCreateScope(opt.scope)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {localizedMcpCreateScopeOptions.find((o) => o.scope === createScope)?.hint}
              </p>
            </div>
            <div className="grid gap-2">
              <Label>{t('settings.transportType')}</Label>
              <div
                role="tablist"
                aria-label={t('settings.transportType')}
                className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
              >
                {(["stdio", "http"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={transportType === value}
                    className={cn(
                      "rounded-md px-2.5 text-xs font-medium transition-colors",
                      transportType === value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    disabled={mcpsBusy}
                    onClick={() => setTransportType(value)}
                  >
                    {mcpTransportTypeLabel(value)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-mcp-name">{t('settings.name')}</Label>
              <Input
                id="new-mcp-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder={t('settings.mcpNamePlaceholder')}
                autoComplete="off"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-mcp-endpoint">{mcpEndpointLabel(transportType)}</Label>
              <Input
                id="new-mcp-endpoint"
                value={newEndpoint}
                onChange={(event) => setNewEndpoint(event.target.value)}
                placeholder={mcpEndpointPlaceholder(transportType)}
                autoComplete="off"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-mcp-metadata">{mcpMetadataLabel(transportType)}</Label>
              <Textarea
                id="new-mcp-metadata"
                value={newMetadata}
                onChange={(event) => setNewMetadata(event.target.value)}
                placeholder={mcpMetadataPlaceholder(transportType)}
                className="min-h-24"
              />
              <p className="text-xs text-muted-foreground">{t('settings.mcpMetadataHint')}</p>
            </div>

            <div className="grid gap-2">
              <Label>Capabilities</Label>
              <div className="grid gap-2 rounded-lg border border-border/40 bg-muted/15 p-3">
                {(["tools", "resources", "prompts"] as const).map((key) => (
                  <label key={key} className="flex items-center justify-between gap-3 text-sm text-foreground">
                    <span>{key}</span>
                    <Checkbox
                      checked={capabilities[key]}
                      onCheckedChange={(value) =>
                        setCapabilities((current) => ({
                          ...current,
                          [key]: value === true,
                        }))
                      }
                      disabled={mcpsBusy}
                      className="size-5"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAddDialogOpen(false)}
              disabled={mcpsBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={mcpsBusy || !newName.trim() || !newEndpoint.trim()}
              onClick={() => {
                void (async () => {
                  try {
                    await onAddMcpServer({
                      name: newName,
                      scope: createScope,
                      transportType,
                      endpoint: newEndpoint,
                      metadata: newMetadata,
                      capabilities,
                    });
                    setAddDialogOpen(false);
                    resetForm();
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {mcpsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t('common.create')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModelsSettingsPanel({
  settings,
  snapshot,
  modelsBusy,
  modelsPreviewBusy,
  onSavePatch,
  onAddModel,
  onAddProviderModels,
  onPreviewModels,
  onRemoveModel,
  onRemoveProviderModels,
}: Pick<
  SettingsViewProps,
  | "settings"
  | "snapshot"
  | "modelsBusy"
  | "modelsPreviewBusy"
  | "onSavePatch"
  | "onAddModel"
  | "onAddProviderModels"
  | "onPreviewModels"
  | "onRemoveModel"
  | "onRemoveProviderModels"
>) {
  const { t } = useTranslation();
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [providerQuery, setProviderQuery] = useState("");
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<DesktopModelProvider | null>(null);
  const [connectApiKey, setConnectApiKey] = useState("");
  const [connectName, setConnectName] = useState("");
  const [connectApiBase, setConnectApiBase] = useState("");
  const [connectCapabilities, setConnectCapabilities] = useState<DesktopModelCapability[]>(
    defaultCustomModelCapabilities,
  );
  const [connectTransportKind, setConnectTransportKind] = useState<DesktopTransportKind>(
    "openai-compatible",
  );
  const [customConnectMode, setCustomConnectMode] = useState<"single" | "bulk">(
    "single",
  );
  const [modelDefaultsDialogTarget, setModelDefaultsDialogTarget] = useState<string | null>(null);
  const [modelDefaultAssignments, setModelDefaultAssignments] = useState<ModelDefaultAssignments>({
    activeModel: false,
    imageGenerationModel: false,
  });
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<DesktopModelProvider | null>(null);

  const models = snapshot?.config.models ?? [];
  const activeModel = settings.activeModel.trim() || (snapshot?.config.activeModel ?? "");
  const imageGenerationModel =
    settings.imageGenerationModel.trim() || (snapshot?.config.imageGenerationModel ?? "");
  const modelDefaultsDialogModel =
    modelDefaultsDialogTarget === null
      ? null
      : models.find((model) => model.name === modelDefaultsDialogTarget) ?? null;
  const canAssignActiveRole =
    modelDefaultsDialogModel !== null &&
    canAssignAsActiveModel(modelDefaultsDialogModel, modelDefaultsDialogModel.name === activeModel);
  const canAssignImageGenerationRole =
    modelDefaultsDialogModel !== null &&
    canAssignAsImageGenerationModel(
      modelDefaultsDialogModel,
      modelDefaultsDialogModel.name === imageGenerationModel,
    );
  const isModelDefaultsDialogModelActive = modelDefaultsDialogModel?.name === activeModel;
  const hasModelDefaultAssignmentChanges =
    modelDefaultsDialogModel !== null &&
    (modelDefaultAssignments.activeModel !== isModelDefaultsDialogModelActive ||
      modelDefaultAssignments.imageGenerationModel !==
        (modelDefaultsDialogModel.name === imageGenerationModel));

  const providerGroups = new Map<DesktopModelProvider, typeof models>();
  const standaloneModels: typeof models = [];
  for (const model of models) {
    if (model.provider && model.provider !== "custom") {
      const group = providerGroups.get(model.provider) ?? [];
      group.push(model);
      providerGroups.set(model.provider, group);
    } else {
      standaloneModels.push(model);
    }
  }

  function providerLabel(provider: DesktopModelProvider): string {
    const row = PROVIDER_PICKER_ROWS.find((item) => item.id === provider);
    return row ? String(t(row.labelKey, { defaultValue: row.fallbackLabel })) : provider;
  }

  const resetConnectWizard = () => {
    setConnectApiKey("");
    setConnectName("");
    setConnectApiBase("");
    setConnectCapabilities(defaultCustomModelCapabilities);
    setConnectTransportKind("openai-compatible");
    setCustomConnectMode("single");
    setSelectedProvider(null);
  };

  const resetConnectTransportKindForProvider = (provider: DesktopModelProvider) => {
    setConnectTransportKind(defaultConnectTransportKind(provider));
  };

  const openProviderPicker = () => {
    setProviderQuery("");
    setProviderDialogOpen(true);
  };

  const startConnect = (id: DesktopModelProvider) => {
    setProviderDialogOpen(false);
    setSelectedProvider(id);
    setConnectApiKey("");
    setConnectName("");
    setConnectApiBase("");
    setConnectCapabilities(defaultCustomModelCapabilities);
    resetConnectTransportKindForProvider(id);
    setCustomConnectMode("single");
    setConnectDialogOpen(true);
  };

  const localizedProviderRows = PROVIDER_PICKER_ROWS.map((row) => ({
    ...row,
    label: providerLabel(row.id),
  }));
  const filteredProviders = localizedProviderRows.filter((row) =>
    row.label.toLowerCase().includes(providerQuery.trim().toLowerCase()),
  );
  const selectedProviderLabel =
    selectedProvider === null
      ? t('settings.connectProvider')
      : providerLabel(selectedProvider);

  const openModelDefaultsDialog = (model: SettingsModelProfile) => {
    setModelDefaultsDialogTarget(model.name);
    setModelDefaultAssignments({
      activeModel: model.name === activeModel,
      imageGenerationModel: model.name === imageGenerationModel,
    });
  };

  const closeModelDefaultsDialog = () => {
    setModelDefaultsDialogTarget(null);
    setModelDefaultAssignments({
      activeModel: false,
      imageGenerationModel: false,
    });
  };

  const saveModelDefaultAssignments = async () => {
    if (!modelDefaultsDialogModel) {
      return;
    }

    const patch: Partial<SettingsFormState> = {};

    if (modelDefaultAssignments.activeModel && modelDefaultsDialogModel.name !== activeModel) {
      patch.activeModel = modelDefaultsDialogModel.name;
    }

    if (canAssignImageGenerationRole) {
      if (
        modelDefaultAssignments.imageGenerationModel &&
        modelDefaultsDialogModel.name !== imageGenerationModel
      ) {
        patch.imageGenerationModel = modelDefaultsDialogModel.name;
      } else if (
        !modelDefaultAssignments.imageGenerationModel &&
        modelDefaultsDialogModel.name === imageGenerationModel
      ) {
        patch.imageGenerationModel = "";
      }
    }

    if (Object.keys(patch).length === 0) {
      closeModelDefaultsDialog();
      return;
    }

    await onSavePatch(patch);
    closeModelDefaultsDialog();
  };

  const saveSingleModelDefaultRole = async (
    model: SettingsModelProfile,
    role: ModelDefaultRole,
  ) => {
    const patch: Partial<SettingsFormState> = {};

    if (role === "activeModel") {
      if (model.name !== activeModel) {
        patch.activeModel = model.name;
      }
    } else if (model.name !== imageGenerationModel) {
      patch.imageGenerationModel = model.name;
    }

    if (Object.keys(patch).length === 0) {
      return;
    }

    await onSavePatch(patch);
  };

  const handleModelDefaultAction = (model: SettingsModelProfile) => {
    const supportedRoles = getSupportedModelDefaultRoles(model, activeModel, imageGenerationModel);

    if (supportedRoles.length === 0) {
      openModelDefaultsDialog(model);
      return;
    }

    if (supportedRoles.length === 1) {
      void (async () => {
        try {
          await saveSingleModelDefaultRole(model, supportedRoles[0]);
        } catch {
          /* runtimeError */
        }
      })();
      return;
    }

    openModelDefaultsDialog(model);
  };

  const effectiveApiBase =
    selectedProvider === null
      ? ""
      : selectedProvider === "custom"
        ? resolveCustomConnectApiBase(connectTransportKind, connectApiBase)
        : providerSupportsConnectTransportPicker(selectedProvider)
          ? resolveProviderConnectApiBase(selectedProvider, connectTransportKind, connectApiBase)
          : resolveConnectApiBase(selectedProvider, connectApiBase);

  const syncCatalogFromUpstream = async (forceRefresh: boolean) => {
    if (selectedProvider === null) {
      return;
    }
    if (!connectApiKey.trim()) {
      throw new Error(t('settings.apiKeyRequired'));
    }
    const res = await onPreviewModels({
      apiBase: effectiveApiBase,
      apiKey: connectApiKey,
      provider: selectedProvider,
      ...(providerSupportsConnectTransportPicker(selectedProvider)
        ? { transportKind: connectTransportKind }
        : {}),
      forceRefresh,
    });
    if (res.modelIds.length === 0) {
      throw new Error(t('settings.noModelsReturned'));
    }
    const bulk: AddProviderModelsRequest = {
      apiBase: effectiveApiBase,
      apiKey: connectApiKey,
      modelIds: res.modelIds,
      ...(res.models ? { modelCatalog: res.models } : {}),
      provider: selectedProvider,
      ...(providerSupportsConnectTransportPicker(selectedProvider)
        ? { transportKind: connectTransportKind }
        : {}),
    };
    await onAddProviderModels(bulk);
    setConnectDialogOpen(false);
    resetConnectWizard();
  };

  const saveCustomSingle = async () => {
    if (selectedProvider === null || selectedProvider !== "custom") {
      return;
    }
    const name = connectName.trim();
    const apiBase = effectiveApiBase;
    if (!name) {
      throw new Error(t('settings.modelNameRequired'));
    }
    if (!connectApiKey.trim()) {
      throw new Error(t('settings.apiKeyRequired'));
    }
    await onAddModel({
      name,
      apiBase,
      apiKey: connectApiKey,
      provider: "custom",
      transportKind: connectTransportKind,
      capabilities: normalizeModelCapabilitySelection(connectCapabilities),
    });
    setConnectDialogOpen(false);
    resetConnectWizard();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t('settings.modelsTitle')}</h1>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            openProviderPicker();
          }}
          disabled={modelsBusy || modelsPreviewBusy}
        >
          {t('settings.connectProvider')}
        </Button>
      </div>

      <div className="space-y-3">
        {models.length === 0 ? (
          <div className="rounded-lg border border-border/40 bg-background/80 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">{t('settings.noSavedModels')}</p>
          </div>
        ) : (
          <>
            {Array.from(providerGroups.entries()).map(([provider, groupModels]) => {
              const groupHasActive = groupModels.some((m) => m.name === activeModel);
              const groupHasKey = groupModels.some((m) => m.keyConfigured);
              return (
                <div
                  key={provider}
                  className="overflow-hidden rounded-lg border border-border/40 bg-background/80"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-border/35 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {providerLabel(provider)}
                      </span>
                      <Badge variant="secondary" className="text-muted-foreground shrink-0">
                        {groupModels.length} {t('settings.modelsCount')}
                      </Badge>
                      {groupHasKey ? (
                        <Badge variant="secondary" className="text-muted-foreground shrink-0">
                          {t('settings.keySaved')}
                        </Badge>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="shrink-0"
                      disabled={modelsBusy || modelsPreviewBusy || groupHasActive}
                      title={
                        groupHasActive ? t('settings.cannotDeleteProviderGroup') : undefined
                      }
                      onClick={() => setDeleteGroupTarget(provider)}
                    >
                      {t('settings.deleteGroup')}
                    </Button>
                  </div>
                  <div className="divide-y divide-border/35">
                    {groupModels.map((model) => {
                      const isActive = model.name === activeModel;
                      const isImageDefault = model.name === imageGenerationModel;
                      const supportedDefaultRoles = getSupportedModelDefaultRoles(
                        model,
                        activeModel,
                        imageGenerationModel,
                      );
                      const defaultActionLabel = modelDefaultActionLabel(supportedDefaultRoles);
                      return (
                        <button
                          key={model.name}
                          type="button"
                          className="flex w-full appearance-none flex-col gap-3 bg-transparent px-4 py-3 text-left outline-none enabled:cursor-pointer enabled:hover:bg-foreground/[0.06] dark:enabled:hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                          disabled={modelsBusy || modelsPreviewBusy}
                          title={defaultActionLabel}
                          aria-label={`${defaultActionLabel}：${model.name}`}
                          onClick={() => handleModelDefaultAction(model)}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-foreground">
                                {model.name}
                              </span>
                              {isActive ? (
                                <Badge variant="secondary" className="text-muted-foreground">
                                  {t('settings.currentInference')}
                                </Badge>
                              ) : null}
                              {isImageDefault ? (
                                <Badge variant="secondary" className="text-muted-foreground">
                                  {t('settings.currentImageGen')}
                                </Badge>
                              ) : null}
                              {model.capabilities?.map((capability) => (
                                <Badge key={capability} variant="outline" className="text-muted-foreground">
                                  {modelCapabilityLabel(capability)}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {standaloneModels.length > 0 && (
              <div className="overflow-hidden divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80">
                {standaloneModels.map((model) => {
                  const isActive = model.name === activeModel;
                  const isImageDefault = model.name === imageGenerationModel;
                  const supportedDefaultRoles = getSupportedModelDefaultRoles(
                    model,
                    activeModel,
                    imageGenerationModel,
                  );
                  const defaultActionLabel = modelDefaultActionLabel(supportedDefaultRoles);
                  const isStandaloneModelDisabled = modelsBusy || modelsPreviewBusy;
                  return (
                    <div
                      key={model.name}
                      role="button"
                      tabIndex={isStandaloneModelDisabled ? -1 : 0}
                      aria-disabled={isStandaloneModelDisabled}
                      title={defaultActionLabel}
                      aria-label={`${defaultActionLabel}：${model.name}`}
                      className={cn(
                        "flex flex-col gap-3 px-4 py-4 outline-none sm:flex-row sm:items-center sm:justify-between sm:gap-4",
                        !isStandaloneModelDisabled &&
                          "cursor-pointer hover:bg-foreground/[0.06] dark:hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring/50",
                      )}
                      onClick={() => {
                        if (isStandaloneModelDisabled) {
                          return;
                        }
                        handleModelDefaultAction(model);
                      }}
                      onKeyDown={(event) => {
                        if (
                          isStandaloneModelDisabled ||
                          event.target !== event.currentTarget ||
                          (event.key !== "Enter" && event.key !== " ")
                        ) {
                          return;
                        }
                        event.preventDefault();
                        handleModelDefaultAction(model);
                      }}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {model.name}
                          </span>
                          {isActive ? (
                            <Badge variant="secondary" className="text-muted-foreground">
                              {t('settings.currentInference')}
                            </Badge>
                          ) : null}
                          {isImageDefault ? (
                            <Badge variant="secondary" className="text-muted-foreground">
                              {t('settings.currentImageGen')}
                            </Badge>
                          ) : null}
                          {model.keyConfigured ? (
                            <Badge variant="secondary" className="text-muted-foreground">
                              {t('settings.keySaved')}
                            </Badge>
                          ) : null}
                          {model.capabilities?.map((capability) => (
                            <Badge key={capability} variant="outline" className="text-muted-foreground">
                              {modelCapabilityLabel(capability)}
                            </Badge>
                          ))}
                        </div>
                        <p
                          className="truncate text-xs text-muted-foreground"
                          title={model.apiBase}
                        >
                          {model.apiBase}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="shrink-0"
                          disabled={modelsBusy || modelsPreviewBusy || isActive}
                          title={isActive ? t('settings.cannotDeleteCurrentModel') : undefined}
                          onClick={(event) => {
                            event.stopPropagation();
                            setDeleteTarget(model.name);
                          }}
                        >
                          {t('common.delete')}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <Dialog
        open={modelDefaultsDialogTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeModelDefaultsDialog();
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t('settings.setAsDefault')}</DialogTitle>
            <DialogDescription>
              {t('settings.setAsDefaultDescription', { name: modelDefaultsDialogModel?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            {canAssignActiveRole ? (
              <div
                className="group/field flex items-start gap-3 rounded-lg border border-dialog-panel-border px-3 py-3 transition-colors data-[disabled=true]:opacity-70"
                data-disabled={modelsBusy || modelsPreviewBusy || isModelDefaultsDialogModelActive || undefined}
              >
                <Checkbox
                  id="model-default-active"
                  checked={modelDefaultAssignments.activeModel}
                  disabled={modelsBusy || modelsPreviewBusy || isModelDefaultsDialogModelActive}
                  onCheckedChange={(checked) =>
                    setModelDefaultAssignments((current) => ({
                      ...current,
                      activeModel: checked === true || isModelDefaultsDialogModelActive,
                    }))
                  }
                />
                <div className="grid gap-1.5">
                  <Label htmlFor="model-default-active" className="text-sm font-medium text-foreground">
                    {t('settings.activeModelLabel')}
                  </Label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {isModelDefaultsDialogModelActive
                      ? t('settings.activeModelKeepHint')
                      : t('settings.activeModelUsage')}
                  </p>
                </div>
              </div>
            ) : null}
            {canAssignImageGenerationRole ? (
              <div
                className="group/field flex items-start gap-3 rounded-lg border border-dialog-panel-border px-3 py-3 transition-colors data-[disabled=true]:opacity-70"
                data-disabled={modelsBusy || modelsPreviewBusy || undefined}
              >
                <Checkbox
                  id="model-default-image-generation"
                  checked={modelDefaultAssignments.imageGenerationModel}
                  disabled={modelsBusy || modelsPreviewBusy}
                  onCheckedChange={(checked) =>
                    setModelDefaultAssignments((current) => ({
                      ...current,
                      imageGenerationModel: checked === true,
                    }))
                  }
                />
                <div className="grid gap-1.5">
                  <Label
                    htmlFor="model-default-image-generation"
                    className="text-sm font-medium text-foreground"
                  >
                    {t('settings.imageGenModelLabel')}
                  </Label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t('settings.imageGenModelUsage')}
                  </p>
                </div>
              </div>
            ) : null}
            {!canAssignActiveRole && !canAssignImageGenerationRole ? (
              <div className="rounded-lg border border-dashed border-dialog-panel-border px-3 py-4 text-sm text-muted-foreground">
                {t('settings.noDefaultRolesForModel')}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={closeModelDefaultsDialog}
              disabled={modelsBusy || modelsPreviewBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={modelsBusy || modelsPreviewBusy || !hasModelDefaultAssignmentChanges}
              onClick={() => {
                void (async () => {
                  try {
                    await saveModelDefaultAssignments();
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {modelsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t('common.save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t('settings.deleteModel')}</DialogTitle>
            <DialogDescription>
              {t('settings.deleteModelConfirm', { name: deleteTarget ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={modelsBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={modelsBusy || !deleteTarget}
              onClick={() => {
                const name = deleteTarget;
                if (!name) {
                  return;
                }
                void (async () => {
                  try {
                    await onRemoveModel(name);
                    setDeleteTarget(null);
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {modelsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t('common.delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteGroupTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteGroupTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t('settings.deleteProviderGroup')}</DialogTitle>
            <DialogDescription>
              {t('settings.deleteProviderGroupConfirm', { provider: deleteGroupTarget ? providerLabel(deleteGroupTarget) : '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteGroupTarget(null)}
              disabled={modelsBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={modelsBusy || !deleteGroupTarget}
              onClick={() => {
                const provider = deleteGroupTarget;
                if (!provider) {
                  return;
                }
                void (async () => {
                  try {
                    await onRemoveProviderModels(provider);
                    setDeleteGroupTarget(null);
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {modelsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t('settings.deleteGroup')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={providerDialogOpen}
        onOpenChange={(open) => {
          setProviderDialogOpen(open);
          if (!open) {
            setProviderQuery("");
          }
        }}
      >
        {/* Radix Dialog 会在打开时聚焦第一个可聚焦子节点；抑制以避免无交互下的焦点环。 */}
        <DialogContent
          className="sm:max-w-md"
          showCloseButton
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{t('settings.selectProvider')}</DialogTitle>
            <DialogDescription>{t('settings.selectProviderDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <Input
              value={providerQuery}
              onChange={(e) => setProviderQuery(e.target.value)}
              placeholder={t('common.search')}
              autoComplete="off"
            />
            <ScrollArea className="h-56 rounded-md border border-dialog-panel-border">
              <div className="p-1">
                {filteredProviders.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t('app.noMatches')}</p>
                ) : (
                  filteredProviders.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className="flex w-full rounded-md px-3 py-2.5 text-left text-sm hover:bg-muted/60"
                      onClick={() => startConnect(row.id)}
                    >
                      {row.label}
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={connectDialogOpen}
        onOpenChange={(open) => {
          setConnectDialogOpen(open);
          if (!open) {
            resetConnectWizard();
          }
        }}
      >
        {/* 同上：连接步骤内首项输入不应在打开瞬间自动获焦。 */}
        <DialogContent
          className="sm:max-w-lg"
          showCloseButton
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {selectedProvider === "custom" ? t('settings.customConnection') : selectedProviderLabel}
            </DialogTitle>
            <DialogDescription>
              {selectedProvider === "custom"
                ? t('settings.customConnectionDescription')
                : providerSupportsConnectTransportPicker(selectedProvider)
                  ? t('settings.providerConnectionDescription')
                  : t('settings.providerSimpleDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-1">
            {providerSupportsConnectTransportPicker(selectedProvider) ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-api-transport">{t('settings.apiType')}</Label>
                <Select
                  value={connectTransportKind}
                  onValueChange={(value) => setConnectTransportKind(value as DesktopTransportKind)}
                >
                  <SelectTrigger id="connect-api-transport">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {connectTransportOptionsForProvider(selectedProvider).map((option) => (
                      <SelectItem key={`${option.value}-${option.label}`} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs leading-5 text-muted-foreground">
                  {connectTransportOptionsForProvider(selectedProvider)
                    .filter((option) => option.value === connectTransportKind)
                    .map((option) => connectTransportOptionSummary(option, selectedProvider))
                    .join("")}
                </p>
              </div>
            ) : null}
            {selectedProvider === "custom" ? (
              <div className="grid gap-2">
                <Label>{t('settings.modelAddMode')}</Label>
                <div
                  role="tablist"
                  aria-label={t('settings.modelAddMode')}
                  className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
                >
                  {(["single", "bulk"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={customConnectMode === value}
                      className={cn(
                        "rounded-md px-2.5 text-xs font-medium transition-colors",
                        customConnectMode === value
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      disabled={modelsBusy || modelsPreviewBusy}
                      onClick={() => setCustomConnectMode(value)}
                    >
                      {value === "single" ? t('settings.addSingle') : t('settings.addAll')}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {selectedProvider === "custom" && customConnectMode === "single" ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-model-name">{t('settings.modelName')}</Label>
                <Input
                  id="connect-model-name"
                  value={connectName}
                  onChange={(e) => setConnectName(e.target.value)}
                  placeholder={t('settings.modelNameExample')}
                  autoComplete="off"
                />
              </div>
            ) : null}
            {selectedProvider === "custom" && customConnectMode === "single" ? (
              <div className="grid gap-2">
                <Label>{t('settings.modelCapabilities')}</Label>
                <ModelCapabilitiesCombobox
                  value={connectCapabilities}
                  disabled={modelsBusy || modelsPreviewBusy}
                  onChange={setConnectCapabilities}
                />
              </div>
            ) : null}
            {selectedProvider === "custom" ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-api-base">{t('settings.endpoint')}</Label>
                <Input
                  id="connect-api-base"
                  value={connectApiBase}
                  onChange={(e) => setConnectApiBase(e.target.value)}
                  placeholder={t('settings.optional')}
                  autoComplete="off"
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  {t('settings.defaultEndpointHint', { endpoint: effectiveApiBase })}
                </p>
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="connect-api-key">API Key</Label>
              <Input
                id="connect-api-key"
                type="password"
                value={connectApiKey}
                onChange={(e) => setConnectApiKey(e.target.value)}
                placeholder={t('settings.enterApiKey')}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConnectDialogOpen(false)}
                disabled={modelsBusy || modelsPreviewBusy}
              >
                {t('common.cancel')}
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                {selectedProvider === "custom" && customConnectMode === "single" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      modelsBusy ||
                      modelsPreviewBusy ||
                      !connectName.trim() ||
                      !connectApiKey.trim()
                    }
                    onClick={() => {
                      void (async () => {
                        try {
                          await saveCustomSingle();
                        } catch {
                          /* runtimeError */
                        }
                      })();
                    }}
                  >
                    {modelsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    {t('settings.addThisModel')}
                  </Button>
                ) : null}
                {selectedProvider === "custom" && customConnectMode === "bulk" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={modelsBusy || modelsPreviewBusy || !connectApiKey.trim()}
                    onClick={() => {
                      void (async () => {
                        try {
                          await syncCatalogFromUpstream(true);
                        } catch {
                          /* runtimeError */
                        }
                      })();
                    }}
                  >
                    {modelsBusy || modelsPreviewBusy ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    {t('settings.addProvider')}
                  </Button>
                ) : null}
                {selectedProvider !== null && selectedProvider !== "custom" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={modelsBusy || modelsPreviewBusy || !connectApiKey.trim()}
                    onClick={() => {
                      void (async () => {
                        try {
                          await syncCatalogFromUpstream(false);
                        } catch {
                          /* runtimeError */
                        }
                      })();
                    }}
                  >
                    {modelsBusy || modelsPreviewBusy ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : null}
                    {t('settings.addProvider')}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AppearanceSettingsPanel({
  theme,
  onThemeChange,
  font,
  onFontChange,
  settings,
  isElectronShell,
  onSavePatch,
}: Pick<
  SettingsViewProps,
  "theme" | "onThemeChange" | "font" | "onFontChange" | "settings" | "isElectronShell" | "onSavePatch"
>) {
  const { t } = useTranslation();
  return (
    <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80 px-4 sm:px-5">
      <SettingsRow
        label={t('settings.theme')}
        description={t('settings.themeDescription')}
        htmlFor="settings-theme-select"
      >
        <Select value={theme} onValueChange={(v) => onThemeChange(v as ThemePreference)}>
          <SelectTrigger id="settings-theme-select" className="w-full sm:min-w-[12rem]">
            <SelectValue placeholder={t('settings.selectTheme')} />
          </SelectTrigger>
          <SelectContent>
            {themeSelectOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        label={t('settings.font')}
        description={t('settings.fontDescription')}
        htmlFor="settings-font-select"
      >
        <FontSelect id="settings-font-select" value={font} onValueChange={onFontChange} />
      </SettingsRow>

      <SettingsRow
        label={t('settings.windowsMica')}
        description={isElectronShell ? t('settings.windowsMicaDescription') : t('settings.windowsMicaUnsupported')}
        htmlFor="settings-windows-mica"
      >
        {isElectronShell ? (
          <div className="flex justify-end">
            <Checkbox
              id="settings-windows-mica"
              checked={settings.windowsMica}
              onCheckedChange={(value) => void onSavePatch({ windowsMica: value === true })}
              className="size-5"
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground sm:text-right">—</p>
        )}
      </SettingsRow>
    </div>
  );
}

function DreamSettingsPanel({
  theme,
  settings,
  snapshot,
  onSavePatch,
  onListDreamsOverview,
}: Pick<SettingsViewProps, "theme" | "settings" | "snapshot" | "onSavePatch" | "onListDreamsOverview">) {
  const { t } = useTranslation();
  const models = snapshot?.config.models ?? [];
  const collector = snapshot?.dreams.collector;
  const disabled = !settings.dreamEnabled;
  const selectValue = settings.dreamCollectorModel.trim() || "__none";
  const [dreamItems, setDreamItems] = useState<DesktopDreamOverviewItem[]>([]);
  const [dreamsLoading, setDreamsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadDreams = async () => {
      setDreamsLoading(true);
      try {
        const items = await onListDreamsOverview();
        if (!cancelled) {
          setDreamItems(items);
        }
      } catch {
        if (!cancelled) {
          setDreamItems([]);
        }
      } finally {
        if (!cancelled) {
          setDreamsLoading(false);
        }
      }
    };

    void loadDreams();
    return () => {
      cancelled = true;
    };
  }, [
    onListDreamsOverview,
    snapshot?.workspaceRoot,
    snapshot?.git.branch,
    snapshot?.dreams.collector.processedCount,
    snapshot?.dreams.collector.lastSuccessAtUnixMs,
  ]);

  return (
    <div className="space-y-6">
      <DreamGraphCard
        items={dreamItems}
        loading={dreamsLoading}
        theme={theme}
        workspaceRoot={snapshot?.workspaceRoot}
        gitBranch={snapshot?.git.branch}
        collectorState={collector?.state ?? "disabled"}
        dreamEnabled={settings.dreamEnabled}
        debugMode={settings.dreamDebugMode}
      />

      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80 px-4 sm:px-5">
        <SettingsRow
          label={t('settings.dreams')}
          description={t('settings.dreamDescription')}
          htmlFor="settings-dream-enabled"
        >
          <div className="flex items-center justify-end gap-3">
            <Badge variant="outline">Beta</Badge>
            <Checkbox
              id="settings-dream-enabled"
              checked={settings.dreamEnabled}
              onCheckedChange={(value) => void onSavePatch({ dreamEnabled: value === true })}
              className="size-5"
            />
          </div>
        </SettingsRow>

        <SettingsRow
          label={t('settings.collectorModel')}
          description={t('settings.collectorModelDescription')}
          htmlFor="settings-dream-model"
        >
          <Select
            value={selectValue}
            disabled={disabled || models.length === 0}
            onValueChange={(value) =>
              void onSavePatch({ dreamCollectorModel: value === "__none" ? "" : value })
            }
          >
            <SelectTrigger id="settings-dream-model" className="w-full sm:min-w-[14rem]">
              <SelectValue placeholder={t('settings.selectModel')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">{t('settings.notSelected')}</SelectItem>
              {models.map((model) => (
                <SelectItem key={model.name} value={model.name}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          label={t('settings.debugMode')}
          description={t('settings.debugModeDescription')}
          htmlFor="settings-dream-debug"
        >
          <div className="flex justify-end">
            <Checkbox
              id="settings-dream-debug"
              checked={settings.dreamDebugMode}
              disabled={disabled}
              onCheckedChange={(value) => void onSavePatch({ dreamDebugMode: value === true })}
              className="size-5"
            />
          </div>
        </SettingsRow>

        <div className="py-4">
          <p className="text-sm font-medium text-foreground">{t('settings.collectorStatus')}</p>
          <div className="mt-2 grid gap-1 text-sm text-muted-foreground sm:text-right">
            <p>
              {t('settings.status')}
              <span className="font-medium text-foreground">
                {dreamCollectorStateLabel(collector?.state ?? "disabled")}
              </span>
            </p>
            <p>
              {t('settings.pendingProcessed', { pending: collector?.pendingCount ?? 0, processed: collector?.processedCount ?? 0 })}
            </p>
            <p>{t('settings.lastRun')}{formatSettingsTime(collector?.lastRunAtUnixMs)}</p>
            <p>{t('settings.lastSuccess')}{formatSettingsTime(collector?.lastSuccessAtUnixMs)}</p>
            {collector?.backoffUntilUnixMs ? (
              <p>{t('settings.backoffUntil')}{formatSettingsTime(collector.backoffUntilUnixMs)}</p>
            ) : null}
            {collector?.lastError ? (
              <p className="break-words text-destructive">{collector.lastError}</p>
            ) : null}
            {settings.dreamEnabled && !settings.dreamCollectorModel.trim() ? (
              <p className="text-amber-600 dark:text-amber-400">{t('settings.selectCollectorModelHint')}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsView({
  tab,
  extensionSettingsId = null,
  theme,
  onThemeChange,
  font,
  onFontChange,
  settings,
  snapshot,
  runtimeError,
  apiReady,
  modelsBusy,
  modelsPreviewBusy,
  mcpsBusy,
  skillsBusy,
  extensionsBusy,
  isElectronShell,
  onSavePatch,
  onResetWebHostPairing,
  onAddModel,
  onAddProviderModels,
  onPreviewModels,
  onRemoveModel,
  onRemoveProviderModels,
  onAddMcpServer,
  onImportExtension,
  onDeleteExtension,
  onRunExtension,
  onUpdateExtensionSettings,
  onUpdateExtensionSecret,
  onDeleteMcpServer,
  onInspectMcpServer,
  onCreateSkill,
  onDeleteSkill,
  onListDreamsOverview,
  onGenerateSkillNavigate,
  onStartCompactionUiDemo,
}: SettingsViewProps) {
  const { t } = useTranslation();
  const extensionSettingsItem = extensionSettingsId
    ? snapshot?.extensionsList.find((item) => item.id === extensionSettingsId)
    : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <ScrollArea className="min-h-0 flex-1" type="hover" scrollHideDelay={450}>
        <div className="flex min-h-full flex-col justify-center">
          <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
            {!extensionSettingsItem && tab !== "models" && tab !== "skills" && tab !== "mcps" && tab !== "extensions" ? (
              <h1 className="mb-6 text-xl font-semibold tracking-tight text-foreground">
                {t(settingsPageTitleKey[tab])}
              </h1>
            ) : null}

            {runtimeError ? (
              <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {runtimeError}
              </div>
            ) : null}

            {extensionSettingsItem ? (
              <ExtensionConfigurationPanel
                item={extensionSettingsItem}
                extensionsBusy={extensionsBusy}
                onUpdateExtensionSettings={onUpdateExtensionSettings}
                onUpdateExtensionSecret={onUpdateExtensionSecret}
              />
            ) : tab === "basic" ? (
              <BasicSettingsPanel
                settings={settings}
                snapshot={snapshot}
                onSavePatch={onSavePatch}
                onResetWebHostPairing={onResetWebHostPairing}
              />
            ) : tab === "developer" ? (
              <DeveloperSettingsPanel onStartCompactionUiDemo={onStartCompactionUiDemo} />
            ) : tab === "dreams" ? (
              <DreamSettingsPanel
                theme={theme}
                settings={settings}
                snapshot={snapshot}
                onSavePatch={onSavePatch}
                onListDreamsOverview={onListDreamsOverview}
              />
            ) : tab === "models" ? (
              <ModelsSettingsPanel
                settings={settings}
                snapshot={snapshot}
                modelsBusy={modelsBusy}
                modelsPreviewBusy={modelsPreviewBusy}
                onSavePatch={onSavePatch}
                onAddModel={onAddModel}
                onAddProviderModels={onAddProviderModels}
                onPreviewModels={onPreviewModels}
                onRemoveModel={onRemoveModel}
                onRemoveProviderModels={onRemoveProviderModels}
              />
            ) : tab === "skills" ? (
              <SkillsSettingsPanel
                snapshot={snapshot}
                skillsBusy={skillsBusy}
                apiReady={apiReady}
                onCreateSkill={onCreateSkill}
                onDeleteSkill={onDeleteSkill}
                onGenerateSkillNavigate={onGenerateSkillNavigate}
              />
            ) : tab === "extensions" ? (
              <ExtensionsSettingsPanel
                snapshot={snapshot}
                extensionsBusy={extensionsBusy}
                onImportExtension={onImportExtension}
                onDeleteExtension={onDeleteExtension}
                onRunExtension={onRunExtension}
              />
            ) : tab === "mcps" ? (
              <McpsSettingsPanel
                snapshot={snapshot}
                mcpsBusy={mcpsBusy}
                onAddMcpServer={onAddMcpServer}
                onDeleteMcpServer={onDeleteMcpServer}
                onInspectMcpServer={onInspectMcpServer}
              />
            ) : tab === "appearance" ? (
              <AppearanceSettingsPanel
                theme={theme}
                onThemeChange={onThemeChange}
                font={font}
                onFontChange={onFontChange}
                settings={settings}
                isElectronShell={isElectronShell}
                onSavePatch={onSavePatch}
              />
            ) : null}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
