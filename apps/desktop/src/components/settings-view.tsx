import { useEffect, useRef, useState, type ReactNode } from "react";

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
import { PROVIDER_PICKER_ROWS, resolveConnectApiBase } from "@/host/provider-presets";
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
};

const themeSelectOptions: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

const settingsPageTitle: Record<SettingsSidebarTab, string> = {
  basic: "工作区与连接",
  models: "模型",
  extensions: "扩展",
  mcps: "MCP 服务",
  skills: "Skills",
  dreams: "梦境",
  appearance: "外观与字体",
};

function formatExtensionInstalledAt(unixMs: number): string {
  return new Date(unixMs).toLocaleString("zh-CN", {
    hour12: false,
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败。"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("读取文件失败。"));
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

const defaultCustomModelCapabilities: DesktopModelCapability[] = ["chat", "vision"];

type SettingsModelProfile = DesktopSnapshot["config"]["models"][number];

type ModelDefaultAssignments = {
  activeModel: boolean;
  imageGenerationModel: boolean;
};

type ModelDefaultRole = keyof ModelDefaultAssignments;

const modelCapabilityOptions: Array<{
  value: DesktopModelCapability;
  label: string;
  summary: string;
}> = [
  { value: "chat", label: "Chat", summary: "对话与工具编排" },
  { value: "vision", label: "Vision", summary: "读取图片输入" },
  { value: "imageGeneration", label: "Image generation", summary: "生成图片输出" },
];

const customTransportOptions: Array<{
  value: DesktopTransportKind;
  label: string;
  summary: string;
}> = [
  {
    value: "openai-compatible",
    label: "OpenAI Chat Completions API",
    summary: "Bearer 鉴权，使用 /models 列模型与 chat-completions 风格端点。",
  },
  {
    value: "anthropic",
    label: "Anthropic API",
    summary: "x-api-key + anthropic-version，使用 Anthropic messages /models 语义。",
  },
];

function resolveCustomConnectApiBase(
  transportKind: DesktopTransportKind,
  customApiBase: string,
): string {
  const trimmed = customApiBase.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return transportKind === "anthropic"
    ? resolveConnectApiBase("anthropic", "")
    : resolveConnectApiBase("custom", "");
}

function modelCapabilityLabel(value: DesktopModelCapability): string {
  return modelCapabilityOptions.find((option) => option.value === value)?.label ?? value;
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
    return "该模型当前没有可设置的默认角色";
  }

  if (roles.length === 1) {
    return roles[0] === "activeModel" ? "设为当前推理模型" : "设为默认图片生成模型";
  }

  return "选择默认角色";
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
              selectedOptions.map((option) => (
                <span
                  key={option.value}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-muted/50 px-1.5 py-0.5 text-xs text-foreground"
                >
                  <span className="truncate">{option.label}</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`移除 ${option.label}`}
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
              ))
            ) : (
              <span className="px-1 text-muted-foreground">选择能力</span>
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
              <span className="block text-sm">{option.label}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {option.summary}
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
  return type === "http" ? "Headers" : "环境变量";
}

function mcpEndpointLabel(type: DesktopMcpTransportType): string {
  return type === "http" ? "URL" : "命令";
}

function mcpEndpointPlaceholder(type: DesktopMcpTransportType): string {
  return type === "http"
    ? "例如 https://example.com/mcp"
    : "例如 npx -y @modelcontextprotocol/server-filesystem D:/SpiritAgent";
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
  return `已发现 ${tools} tools · ${resources} resources · ${prompts} prompts`;
}

function McpRuntimeBadge({ state }: { state: McpServerRuntimeBadgeState }) {
  if (state === "ready") {
    return <Badge>活跃</Badge>;
  }

  if (state === "error") {
    return <Badge variant="destructive">失败</Badge>;
  }

  if (state === "disabled") {
    return <Badge variant="outline">未启用</Badge>;
  }

  return (
    <Badge variant="outline" className="gap-1.5">
      <LoaderCircle className="size-3 animate-spin" aria-hidden />
      加载中
    </Badge>
  );
}

function skillRootKindLabel(rootKind: DesktopSkillRootKind): string {
  if (rootKind === "user") {
    return "用户目录";
  }
  if (rootKind === "workspaceSpirit") {
    return "工作区 .spirit";
  }
  return "工作区 .agents";
}

function skillLocationLabel(item: DesktopSkillListItem): string {
  return skillRootKindLabel(item.rootKind);
}

function webHostStatusLabel(state: DesktopSnapshot["webHost"]["status"]["state"]): string {
  switch (state) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "error":
      return "启动失败";
    case "stopped":
      return "已停止";
    default:
      return "关闭";
  }
}

function dreamCollectorStateLabel(state: DesktopSnapshot["dreams"]["collector"]["state"]): string {
  switch (state) {
    case "disabled":
      return "已关闭";
    case "missing-model":
      return "等待模型";
    case "running":
      return "收集中";
    case "backoff":
      return "退避中";
    case "error":
      return "异常";
    default:
      return "空闲";
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
      <SettingsRow label="UI locale" description="界面语言区域，如 zh-CN。" htmlFor="settings-locale">
        <Input
          id="settings-locale"
          className="sm:text-right"
          value={settings.uiLocale}
          onChange={(event) => void onSavePatch({ uiLocale: event.target.value })}
          placeholder="zh-CN / en"
        />
      </SettingsRow>

      <SettingsRow
        label="Web 远程访问"
        description="浏览器连本机；默认仅本机可连。"
        htmlFor="settings-web-host-enabled"
      >
        <div className="flex items-center justify-end gap-3">
          <span className="truncate text-sm text-muted-foreground">
            {settings.webHostEnabled ? webHostStatus : "关闭"}
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
        label="监听地址"
        description="填本机回环 IP 或局域网 IPv4。"
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

      <SettingsRow label="端口" htmlFor="settings-web-host-port">
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
        <p className="text-sm font-medium text-foreground">远程状态</p>
        <div className="mt-2 grid gap-1 text-sm text-muted-foreground sm:text-right">
          <p className="truncate">
            <span className="text-foreground">{settings.webHostEnabled ? webHostStatus : "关闭"}</span>
            {settings.webHostEnabled ? ` · ${webHostUrl}` : null}
          </p>
          {webHost?.status.error ? (
            <p className="break-words text-destructive">{webHost.status.error}</p>
          ) : null}
          <p>
            配对：{webHost?.config.paired ? "已完成" : "等待首次配对"}
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
                重置配对
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="py-4">
        <p className="text-sm font-medium text-foreground">运行时概览</p>
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

const skillCreateRootOptions: Array<{
  kind: DesktopSkillRootKind;
  label: string;
  hint: string;
}> = [
  { kind: "user", label: "用户", hint: "Spirit 用户目录 skills/" },
  { kind: "workspaceSpirit", label: ".spirit", hint: "工作区 .spirit/skills/" },
  { kind: "workspaceAgents", label: ".agents", hint: "工作区 .agents/skills/" },
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
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteSkillRequest | null>(null);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [createRootKind, setCreateRootKind] = useState<DesktopSkillRootKind>("user");

  const items = snapshot?.skillsList ?? [];

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
          <p className="text-sm text-muted-foreground">用户与工作区内已发现的 Skills。</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onGenerateSkillNavigate ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              disabled={!apiReady}
              title="进入主对话区，预填 /create-skill，并直接用自然语言描述需求"
              onClick={() => onGenerateSkillNavigate()}
            >
              <Sparkles className="size-3.5 shrink-0" aria-hidden />
              生成 Skill
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
            新建 Skill
          </Button>
        </div>
      </div>

      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">未发现 Skill</p>
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
                      已关闭
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
                删除
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
            <DialogTitle>删除 Skill</DialogTitle>
            <DialogDescription>
              确定删除「{deleteTarget?.name ?? ""}」（
              {deleteTarget ? skillRootKindLabel(deleteTarget.rootKind) : ""}
              ）？将移除整个目录（含 SKILL.md）。
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
              取消
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
              删除
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
            <DialogTitle>新建 Skill</DialogTitle>
            <DialogDescription>填写位置、名称与描述，新增一条供助手参考的技能。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label>保存位置</Label>
              <div
                role="tablist"
                aria-label="Skill 保存位置"
                className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
              >
                {skillCreateRootOptions.map((opt) => (
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
                {skillCreateRootOptions.find((o) => o.kind === createRootKind)?.hint}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-skill-name">名称</Label>
              <Input
                id="new-skill-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例如 code-review"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-skill-desc">描述</Label>
              <Input
                id="new-skill-desc"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="简要说明何时用、做什么"
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
              取消
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
              创建
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
          {item.description ?? `扩展 ${item.id} 的设置。`}
        </p>
      </div>

      {!hasSettings && !hasSecrets ? (
        <div className="rounded-lg border border-border/40 bg-background/80 px-4 py-10 text-center text-sm text-muted-foreground">
          此扩展已声明独立设置页，但尚未声明设置项或 secret slot。
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
                    保存
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
                    {configured ? "已配置" : "未配置"}
                  </Badge>
                  <Input
                    id={fieldKey}
                    type="password"
                    value={secretDrafts[fieldKey] ?? ""}
                    disabled={extensionsBusy}
                    placeholder={configured ? "输入新值以覆盖" : "输入 secret"}
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
                    保存
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
                    清除
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
          <h1 className="text-xl font-semibold tracking-tight text-foreground">扩展</h1>
          <p className="text-sm text-muted-foreground">管理用户级扩展 ZIP 导入结果与已安装元数据。</p>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          disabled={extensionsBusy}
          onClick={() => inputRef.current?.click()}
        >
          导入 ZIP
        </Button>
      </div>

      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">未安装扩展</p>
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
                      设置页
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
                  安装时间：{formatExtensionInstalledAt(item.installedAtUnixMs)}
                  {item.archiveFileName ? ` · 来源：${item.archiveFileName}` : ""}
                  {item.main ? ` · main: ${item.main}` : ""}
                </p>
                {item.activationEvents?.length ? (
                  <p className="text-xs text-muted-foreground">
                    activationEvents: {item.activationEvents.join(", ")}
                  </p>
                ) : null}
                {item.contributedTools?.length ? (
                  <div className="space-y-1 pt-1">
                    <p className="text-xs font-medium text-foreground">贡献工具</p>
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
                          该样式会以扩展层的形式注入 Desktop Renderer，可配合稳定的
                          {" "}`data-spirit-*` hooks 覆盖界面表现。
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
                          这是 CLI 专属的受控语义 hook，不会在 Desktop Renderer 中执行。
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
                  手动运行
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={extensionsBusy}
                  onClick={() => setDeleteTarget(item)}
                >
                  删除
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
            <DialogTitle>删除扩展</DialogTitle>
            <DialogDescription>
              确定删除扩展「{deleteTarget?.displayName ?? ""}」？这会移除本地安装目录。
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
              取消
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
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

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
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteMcpServerRequest | null>(null);
  const [transportType, setTransportType] = useState<DesktopMcpTransportType>("stdio");
  const [newName, setNewName] = useState("");
  const [newEndpoint, setNewEndpoint] = useState("");
  const [newMetadata, setNewMetadata] = useState("");
  const [capabilities, setCapabilities] = useState<DesktopMcpCapabilityToggles>(defaultMcpCapabilities);
  const [runtimeInfo, setRuntimeInfo] = useState<Record<string, McpServerRuntimeInfo>>({});

  const items = snapshot?.mcpServers ?? [];

  useEffect(() => {
    let cancelled = false;
    const names = new Set(items.map((item) => item.name));

    setRuntimeInfo((current) => {
      const next: Record<string, McpServerRuntimeInfo> = {};
      for (const item of items) {
        next[item.name] = item.enabled
          ? { state: "loading" }
          : { state: "disabled" };
      }
      for (const [name, info] of Object.entries(current)) {
        if (names.has(name) && next[name]?.state === "disabled") {
          next[name] = info;
        }
      }
      return next;
    });

    void Promise.all(
      items.map(async (item) => {
        if (!item.enabled) {
          return;
        }

        try {
          const inspection = await onInspectMcpServer(item.name);
          if (cancelled) {
            return;
          }
          setRuntimeInfo((current) => ({
            ...current,
            [item.name]: {
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
            [item.name]: {
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
          <p className="text-sm text-muted-foreground">管理 Desktop 侧已配置的 MCP servers。</p>
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
          添加 MCP
        </Button>
      </div>

      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">未配置 MCP server</p>
        ) : (
          items.map((item) => (
            <div
              key={item.name}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{item.displayName}</span>
                  <McpRuntimeBadge state={runtimeInfo[item.name]?.state ?? (item.enabled ? "loading" : "disabled")} />
                  <Badge variant="secondary" className="text-muted-foreground">
                    {mcpTransportTypeLabel(item.transport.type)}
                  </Badge>
                  {!item.enabled ? (
                    <Badge variant="secondary" className="text-muted-foreground">
                      已关闭
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{item.transport.summary}</p>
                <p className="text-xs text-muted-foreground">{mcpCountsSummary(runtimeInfo[item.name])}</p>
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
                onClick={() => setDeleteTarget({ name: item.name })}
              >
                删除
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
            <DialogTitle>删除 MCP</DialogTitle>
            <DialogDescription>
              确定删除 MCP server「{deleteTarget?.name ?? ""}」？这会从本地 mcp.json 中移除对应配置。
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
              取消
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
              删除
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
            <DialogTitle>添加 MCP</DialogTitle>
            <DialogDescription>表单语义与 CLI 保持一致：Stdio 写命令，HTTP 写 URL，metadata 按 transport 解释。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label>传输方式</Label>
              <div
                role="tablist"
                aria-label="MCP 传输方式"
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
              <Label htmlFor="new-mcp-name">名称</Label>
              <Input
                id="new-mcp-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="例如 filesystem"
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
              <p className="text-xs text-muted-foreground">多个条目使用分号分隔；HTTP 支持 `Key: Value` 或 `Key=Value`，Stdio 使用 `KEY=value`。</p>
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
              取消
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
              创建
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
  const [customConnectTransportKind, setCustomConnectTransportKind] = useState<DesktopTransportKind>(
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
    return PROVIDER_PICKER_ROWS.find((row) => row.id === provider)?.label ?? provider;
  }

  const resetConnectWizard = () => {
    setConnectApiKey("");
    setConnectName("");
    setConnectApiBase("");
    setConnectCapabilities(defaultCustomModelCapabilities);
    setCustomConnectTransportKind("openai-compatible");
    setCustomConnectMode("single");
    setSelectedProvider(null);
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
    setCustomConnectTransportKind("openai-compatible");
    setCustomConnectMode("single");
    setConnectDialogOpen(true);
  };

  const filteredProviders = PROVIDER_PICKER_ROWS.filter((row) =>
    row.label.toLowerCase().includes(providerQuery.trim().toLowerCase()),
  );
  const selectedProviderLabel =
    selectedProvider === null
      ? "连接提供商"
      : PROVIDER_PICKER_ROWS.find((row) => row.id === selectedProvider)?.label ?? "连接提供商";

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
        ? resolveCustomConnectApiBase(customConnectTransportKind, connectApiBase)
        : resolveConnectApiBase(selectedProvider, connectApiBase);

  const syncCatalogFromUpstream = async (forceRefresh: boolean) => {
    if (selectedProvider === null) {
      return;
    }
    if (!connectApiKey.trim()) {
      throw new Error("API Key 不能为空。");
    }
    const res = await onPreviewModels({
      apiBase: effectiveApiBase,
      apiKey: connectApiKey,
      provider: selectedProvider,
      ...(selectedProvider === "custom" ? { transportKind: customConnectTransportKind } : {}),
      forceRefresh,
    });
    if (res.modelIds.length === 0) {
      throw new Error("未返回任何模型，请检查密钥或端点。");
    }
    const bulk: AddProviderModelsRequest = {
      apiBase: effectiveApiBase,
      apiKey: connectApiKey,
      modelIds: res.modelIds,
      ...(res.models ? { modelCatalog: res.models } : {}),
      provider: selectedProvider,
      ...(selectedProvider === "custom" ? { transportKind: customConnectTransportKind } : {}),
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
      throw new Error("模型名称不能为空。");
    }
    if (!connectApiKey.trim()) {
      throw new Error("API Key 不能为空。");
    }
    await onAddModel({
      name,
      apiBase,
      apiKey: connectApiKey,
      provider: "custom",
      transportKind: customConnectTransportKind,
      capabilities: normalizeModelCapabilitySelection(connectCapabilities),
    });
    setConnectDialogOpen(false);
    resetConnectWizard();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">模型</h1>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            openProviderPicker();
          }}
          disabled={modelsBusy || modelsPreviewBusy}
        >
          连接提供商
        </Button>
      </div>

      <div className="space-y-3">
        {models.length === 0 ? (
          <div className="rounded-lg border border-border/40 bg-background/80 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">暂无已保存模型</p>
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
                        {groupModels.length} 个模型
                      </Badge>
                      {groupHasKey ? (
                        <Badge variant="secondary" className="text-muted-foreground shrink-0">
                          已存密钥
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
                        groupHasActive ? "不能删除包含当前模型的提供商组" : undefined
                      }
                      onClick={() => setDeleteGroupTarget(provider)}
                    >
                      删除整组
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
                                  当前推理
                                </Badge>
                              ) : null}
                              {isImageDefault ? (
                                <Badge variant="secondary" className="text-muted-foreground">
                                  当前图片生成
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
                              当前推理
                            </Badge>
                          ) : null}
                          {isImageDefault ? (
                            <Badge variant="secondary" className="text-muted-foreground">
                              当前图片生成
                            </Badge>
                          ) : null}
                          {model.keyConfigured ? (
                            <Badge variant="secondary" className="text-muted-foreground">
                              已存密钥
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
                          title={isActive ? "不能删除当前模型" : undefined}
                          onClick={(event) => {
                            event.stopPropagation();
                            setDeleteTarget(model.name);
                          }}
                        >
                          删除
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
            <DialogTitle>设为默认</DialogTitle>
            <DialogDescription>
              为模型「{modelDefaultsDialogModel?.name ?? ""}」选择要承担的默认角色。
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
                    当前推理模型
                  </Label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {isModelDefaultsDialogModelActive
                      ? "当前必须保留一个推理模型；如需切换，请到目标模型上设置。"
                      : "用于对话、规划与工具编排。"}
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
                    默认图片生成模型
                  </Label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    用于 generate_image 等图片输出；取消后将不再指定默认图片模型。
                  </p>
                </div>
              </div>
            ) : null}
            {!canAssignActiveRole && !canAssignImageGenerationRole ? (
              <div className="rounded-lg border border-dashed border-dialog-panel-border px-3 py-4 text-sm text-muted-foreground">
                这个模型当前没有可设置的默认角色。
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
              取消
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
              保存
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
            <DialogTitle>删除模型</DialogTitle>
            <DialogDescription>
              确定删除模型「{deleteTarget ?? ""}」？配置与单独保存的密钥将一并移除。
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
              取消
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
              删除
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
            <DialogTitle>删除提供商模型组</DialogTitle>
            <DialogDescription>
              确定删除「{deleteGroupTarget ? providerLabel(deleteGroupTarget) : ""}」下的全部模型？
              配置与密钥将一并移除。
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
              取消
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
              删除整组
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
            <DialogTitle>选择提供商</DialogTitle>
            <DialogDescription>选择后填写连接信息。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <Input
              value={providerQuery}
              onChange={(e) => setProviderQuery(e.target.value)}
              placeholder="搜索"
              autoComplete="off"
            />
            <ScrollArea className="h-56 rounded-md border border-dialog-panel-border">
              <div className="p-1">
                {filteredProviders.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">无匹配项</p>
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
              {selectedProvider === "custom" ? "自定义连接" : selectedProviderLabel}
            </DialogTitle>
            <DialogDescription>
              {selectedProvider === "custom"
                ? "先选择 API 类型，再填写端点与密钥。"
                : "填写 API Key 即可连接。"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-1">
            {selectedProvider === "custom" ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-api-transport">API 类型</Label>
                <Select
                  value={customConnectTransportKind}
                  onValueChange={(value) => setCustomConnectTransportKind(value as DesktopTransportKind)}
                >
                  <SelectTrigger id="connect-api-transport">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {customTransportOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs leading-5 text-muted-foreground">
                  {customTransportOptions.find((option) => option.value === customConnectTransportKind)?.summary}
                </p>
              </div>
            ) : null}
            {selectedProvider === "custom" ? (
              <div className="grid gap-2">
                <Label>模型添加方式</Label>
                <div
                  role="tablist"
                  aria-label="模型添加方式"
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
                      {value === "single" ? "仅添加单个" : "添加所有"}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {selectedProvider === "custom" && customConnectMode === "single" ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-model-name">模型名称</Label>
                <Input
                  id="connect-model-name"
                  value={connectName}
                  onChange={(e) => setConnectName(e.target.value)}
                  placeholder="例如 my-model"
                  autoComplete="off"
                />
              </div>
            ) : null}
            {selectedProvider === "custom" && customConnectMode === "single" ? (
              <div className="grid gap-2">
                <Label>模型能力</Label>
                <ModelCapabilitiesCombobox
                  value={connectCapabilities}
                  disabled={modelsBusy || modelsPreviewBusy}
                  onChange={setConnectCapabilities}
                />
              </div>
            ) : null}
            {selectedProvider === "custom" ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-api-base">端点</Label>
                <Input
                  id="connect-api-base"
                  value={connectApiBase}
                  onChange={(e) => setConnectApiBase(e.target.value)}
                  placeholder="可选"
                  autoComplete="off"
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  留空时默认使用 {effectiveApiBase}。
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
                placeholder="输入密钥"
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
                取消
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
                    添加此模型
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
                    添加提供商
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
                    添加提供商
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
  return (
    <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80 px-4 sm:px-5">
      <SettingsRow
        label="主题"
        description="立即应用到界面；与宿主配置无关。"
        htmlFor="settings-theme-select"
      >
        <Select value={theme} onValueChange={(v) => onThemeChange(v as ThemePreference)}>
          <SelectTrigger id="settings-theme-select" className="w-full sm:min-w-[12rem]">
            <SelectValue placeholder="选择主题" />
          </SelectTrigger>
          <SelectContent>
            {themeSelectOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        label="字体"
        description="立即应用到界面；默认与 shadcn/ui 一致（Geist）。"
        htmlFor="settings-font-select"
      >
        <FontSelect id="settings-font-select" value={font} onValueChange={onFontChange} />
      </SettingsRow>

      <SettingsRow
        label="Windows 云母背景"
        description={isElectronShell ? "桌面窗口材质；关闭后为实色背景。" : "当前宿主不支持此选项。"}
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
          label="梦境"
          description="后台汇总当前工作区与分支的近期会话动向。"
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
          label="收集者模型"
          description="用于后台摘要；未选择时不会启动收集。"
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
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">未选择</SelectItem>
              {models.map((model) => (
                <SelectItem key={model.name} value={model.name}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          label="调试模式"
          description="后续收集会话保留为可追踪记录。"
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
          <p className="text-sm font-medium text-foreground">收集状态</p>
          <div className="mt-2 grid gap-1 text-sm text-muted-foreground sm:text-right">
            <p>
              状态：
              <span className="font-medium text-foreground">
                {dreamCollectorStateLabel(collector?.state ?? "disabled")}
              </span>
            </p>
            <p>
              待处理：{collector?.pendingCount ?? 0} · 已处理：{collector?.processedCount ?? 0}
            </p>
            <p>上次运行：{formatSettingsTime(collector?.lastRunAtUnixMs)}</p>
            <p>上次成功：{formatSettingsTime(collector?.lastSuccessAtUnixMs)}</p>
            {collector?.backoffUntilUnixMs ? (
              <p>退避到：{formatSettingsTime(collector.backoffUntilUnixMs)}</p>
            ) : null}
            {collector?.lastError ? (
              <p className="break-words text-destructive">{collector.lastError}</p>
            ) : null}
            {settings.dreamEnabled && !settings.dreamCollectorModel.trim() ? (
              <p className="text-amber-600 dark:text-amber-400">请选择收集者模型。</p>
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
}: SettingsViewProps) {
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
                {settingsPageTitle[tab]}
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
            ) : (
              <AppearanceSettingsPanel
                theme={theme}
                onThemeChange={onThemeChange}
                font={font}
                onFontChange={onFontChange}
                settings={settings}
                isElectronShell={isElectronShell}
                onSavePatch={onSavePatch}
              />
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
