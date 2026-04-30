import { useEffect, useRef, useState, type ReactNode } from "react";

import { LoaderCircle, RefreshCw, RotateCcw, Sparkles } from "lucide-react";

import type { SettingsSidebarTab } from "@/components/session-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  apiBase: string;
  uiLocale: string;
  apiKey: string;
  windowsMica: boolean;
  planMode: boolean;
  webHostEnabled: boolean;
  webHostHost: string;
  webHostPort: number;
};

type SettingsViewProps = {
  tab: SettingsSidebarTab;
  theme: ThemePreference;
  onThemeChange: (value: ThemePreference) => void;
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
  onBootstrap: () => Promise<void>;
  onResetSession: () => Promise<void>;
  onAddModel: (request: AddModelRequest) => Promise<void>;
  onAddProviderModels: (request: AddProviderModelsRequest) => Promise<void>;
  onPreviewModels: (request: PreviewModelsRequest) => Promise<PreviewModelsResponse>;
  onRemoveModel: (name: string) => Promise<void>;
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
  appearance: "主题与窗口效果",
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
      <SettingsRow label="Workspace" description="当前工作区根目录（只读）。">
        <p className="w-full truncate rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-sm text-muted-foreground sm:text-right">
          {snapshot?.workspaceRoot ?? "Bootstrapping…"}
        </p>
      </SettingsRow>

      <SettingsRow label="API Base" description="OpenAI 兼容接口根 URL。" htmlFor="settings-api-base">
        <Input
          id="settings-api-base"
          className="sm:text-right"
          value={settings.apiBase}
          onChange={(event) => void onSavePatch({ apiBase: event.target.value })}
        />
      </SettingsRow>

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
        label="API Key"
        description="保存后写入本地；已配置时可留空保持不变。"
        htmlFor="settings-key"
      >
        <Input
          id="settings-key"
          className="sm:text-right"
          type="password"
          value={settings.apiKey}
          onChange={(event) => void onSavePatch({ apiKey: event.target.value })}
          placeholder={
            snapshot?.config.activeApiKeyConfigured
              ? "已配置，可留空保持不变"
              : "输入 API Key"
          }
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

function ExtensionsSettingsPanel({
  snapshot,
  extensionsBusy,
  onImportExtension,
  onDeleteExtension,
  onRunExtension,
  onUpdateExtensionSettings,
  onUpdateExtensionSecret,
}: Pick<
  SettingsViewProps,
  | "snapshot"
  | "extensionsBusy"
  | "onImportExtension"
  | "onDeleteExtension"
  | "onRunExtension"
  | "onUpdateExtensionSettings"
  | "onUpdateExtensionSecret"
>) {
  const [deleteTarget, setDeleteTarget] = useState<DesktopExtensionListItem | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>({});
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const items = snapshot?.extensionsList ?? [];

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
                {item.settingsSchema?.length ? (
                  <div className="space-y-2 pt-2">
                    <p className="text-xs font-medium text-foreground">扩展设置</p>
                    {item.settingsSchema.map((setting) => {
                      const fieldKey = settingDraftKey(item.id, setting.key);
                      const currentText = currentSettingText(item, setting.key, setting.defaultValue);

                      if (setting.type === "boolean") {
                        const checked = Boolean(
                          item.settingsValues?.[setting.key] ?? setting.defaultValue ?? false,
                        );
                        return (
                          <div key={fieldKey} className="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-foreground">{setting.title}</p>
                                {setting.description ? (
                                  <p className="mt-1 text-xs text-muted-foreground">{setting.description}</p>
                                ) : null}
                              </div>
                              <Checkbox
                                checked={checked}
                                disabled={extensionsBusy}
                                onCheckedChange={(value) => {
                                  void onUpdateExtensionSettings({
                                    id: item.id,
                                    values: { [setting.key]: value === true },
                                  });
                                }}
                              />
                            </div>
                          </div>
                        );
                      }

                      if (setting.type === "select") {
                        const selected = currentText || String(setting.defaultValue ?? "");
                        return (
                          <div key={fieldKey} className="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                            <p className="text-xs font-medium text-foreground">{setting.title}</p>
                            {setting.description ? (
                              <p className="mt-1 text-xs text-muted-foreground">{setting.description}</p>
                            ) : null}
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
                              <SelectTrigger className="mt-2 h-9 text-sm">
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
                          </div>
                        );
                      }

                      return (
                        <div key={fieldKey} className="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                          <p className="text-xs font-medium text-foreground">{setting.title}</p>
                          {setting.description ? (
                            <p className="mt-1 text-xs text-muted-foreground">{setting.description}</p>
                          ) : null}
                          <div className="mt-2 flex gap-2">
                            <Input
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
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {item.secretSlots?.length ? (
                  <div className="space-y-2 pt-2">
                    <p className="text-xs font-medium text-foreground">扩展密钥</p>
                    {item.secretSlots.map((slot) => {
                      const fieldKey = secretDraftKey(item.id, slot.key);
                      const configured = item.secretStatuses?.find((entry) => entry.key === slot.key)?.configured === true;

                      return (
                        <div key={fieldKey} className="rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-medium text-foreground">{slot.title}</p>
                            <Badge variant={configured ? "secondary" : "outline"} className="text-[0.65rem] text-muted-foreground">
                              {configured ? "已配置" : "未配置"}
                            </Badge>
                          </div>
                          {slot.description ? (
                            <p className="mt-1 text-xs text-muted-foreground">{slot.description}</p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Input
                              type="password"
                              value={secretDrafts[fieldKey] ?? ""}
                              disabled={extensionsBusy}
                              placeholder={configured ? "输入新值以覆盖" : "输入 secret"}
                              onChange={(event) => updateSecretDraft(item.id, slot.key, event.target.value)}
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
                        </div>
                      );
                    })}
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
  snapshot,
  modelsBusy,
  modelsPreviewBusy,
  onAddModel,
  onAddProviderModels,
  onPreviewModels,
  onRemoveModel,
}: Pick<
  SettingsViewProps,
  | "snapshot"
  | "modelsBusy"
  | "modelsPreviewBusy"
  | "onAddModel"
  | "onAddProviderModels"
  | "onPreviewModels"
  | "onRemoveModel"
>) {
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [providerQuery, setProviderQuery] = useState("");
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<DesktopModelProvider | null>(null);
  const [connectApiKey, setConnectApiKey] = useState("");
  const [connectName, setConnectName] = useState("");
  const [connectApiBase, setConnectApiBase] = useState("");
  const [customConnectMode, setCustomConnectMode] = useState<"single" | "bulk">(
    "single",
  );
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const models = snapshot?.config.models ?? [];
  const activeModel = snapshot?.config.activeModel ?? "";

  const resetConnectWizard = () => {
    setConnectApiKey("");
    setConnectName("");
    setConnectApiBase("");
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
    setCustomConnectMode("single");
    setConnectDialogOpen(true);
  };

  const filteredProviders = PROVIDER_PICKER_ROWS.filter((row) =>
    row.label.toLowerCase().includes(providerQuery.trim().toLowerCase()),
  );

  const effectiveApiBase =
    selectedProvider === null
      ? ""
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
      forceRefresh,
    });
    if (res.modelIds.length === 0) {
      throw new Error("未返回任何模型，请检查密钥或端点。");
    }
    const bulk: AddProviderModelsRequest = {
      apiBase: effectiveApiBase,
      apiKey: connectApiKey,
      modelIds: res.modelIds,
      provider: selectedProvider,
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

      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80">
        {models.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">暂无已保存模型</p>
        ) : (
          models.map((model) => {
            const isActive = model.name === activeModel;
            return (
              <div
                key={model.name}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{model.name}</span>
                    {isActive ? (
                      <Badge variant="secondary" className="text-muted-foreground">
                        当前
                      </Badge>
                    ) : null}
                    {model.keyConfigured ? (
                      <Badge variant="secondary" className="text-muted-foreground">
                        已存密钥
                      </Badge>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground" title={model.apiBase}>
                    {model.apiBase}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="shrink-0 self-start sm:self-center"
                  disabled={modelsBusy || modelsPreviewBusy || isActive}
                  title={isActive ? "不能删除当前模型" : undefined}
                  onClick={() => setDeleteTarget(model.name)}
                >
                  删除
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
            <ScrollArea className="h-56 rounded-md border border-border/40">
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
              {selectedProvider === "custom"
                ? "自定义连接"
                : selectedProvider === "deepseek"
                  ? "DeepSeek"
                  : selectedProvider === "kimi"
                    ? "Kimi"
                    : selectedProvider === "minimax"
                      ? "MiniMax"
                      : "连接提供商"}
            </DialogTitle>
            <DialogDescription>
              {selectedProvider === "custom"
                ? "填写端点与密钥。"
                : "填写 API Key 即可连接。"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-1">
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
  settings,
  isElectronShell,
  onSavePatch,
}: Pick<
  SettingsViewProps,
  "theme" | "onThemeChange" | "settings" | "isElectronShell" | "onSavePatch"
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

export function SettingsView({
  tab,
  theme,
  onThemeChange,
  settings,
  snapshot,
  runtimeError,
  apiReady,
  busyAction,
  modelsBusy,
  modelsPreviewBusy,
  mcpsBusy,
  skillsBusy,
  extensionsBusy,
  isElectronShell,
  onSavePatch,
  onResetWebHostPairing,
  onBootstrap,
  onResetSession,
  onAddModel,
  onAddProviderModels,
  onPreviewModels,
  onRemoveModel,
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
  onGenerateSkillNavigate,
}: SettingsViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex min-h-full flex-col justify-center">
          <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
            {tab !== "models" && tab !== "skills" && tab !== "mcps" && tab !== "extensions" ? (
              <h1 className="mb-6 text-xl font-semibold tracking-tight text-foreground">
                {settingsPageTitle[tab]}
              </h1>
            ) : null}

            {runtimeError ? (
              <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {runtimeError}
              </div>
            ) : null}

            {tab === "basic" ? (
              <BasicSettingsPanel
                settings={settings}
                snapshot={snapshot}
                onSavePatch={onSavePatch}
                onResetWebHostPairing={onResetWebHostPairing}
              />
            ) : tab === "models" ? (
              <ModelsSettingsPanel
                snapshot={snapshot}
                modelsBusy={modelsBusy}
                modelsPreviewBusy={modelsPreviewBusy}
                onAddModel={onAddModel}
                onAddProviderModels={onAddProviderModels}
                onPreviewModels={onPreviewModels}
                onRemoveModel={onRemoveModel}
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
                onUpdateExtensionSettings={onUpdateExtensionSettings}
                onUpdateExtensionSecret={onUpdateExtensionSecret}
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
                settings={settings}
                isElectronShell={isElectronShell}
                onSavePatch={onSavePatch}
              />
            )}
          </div>
        </div>
      </div>

      {tab === "basic" ? (
        <div className="shrink-0 border-t border-border/30 px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">修改会自动保存；以下为一次性操作。</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onBootstrap()}
                disabled={!apiReady || busyAction === "bootstrap"}
              >
                {busyAction === "bootstrap" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                重新装配
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onResetSession()}
                disabled={!apiReady || busyAction === "reset"}
              >
                {busyAction === "reset" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                重置会话
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
