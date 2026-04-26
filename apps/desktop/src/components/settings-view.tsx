import { useEffect, useState, type ReactNode } from "react";

import { LoaderCircle, RefreshCw, RotateCcw, Sparkles } from "lucide-react";

import type { SettingsSidebarTab } from "@/components/session-sidebar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  CreateSkillRequest,
  DeleteSkillRequest,
  DesktopSkillListItem,
  DesktopSkillRootKind,
  DesktopSnapshot,
} from "@/types";

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
  skillsBusy: boolean;
  isElectronShell: boolean;
  onSavePatch: (patch: Partial<SettingsFormState>) => Promise<void>;
  onResetWebHostPairing?: () => Promise<void>;
  onBootstrap: () => Promise<void>;
  onResetSession: () => Promise<void>;
  onAddModel: (request: AddModelRequest) => Promise<void>;
  onRemoveModel: (name: string) => Promise<void>;
  onCreateSkill: (request: CreateSkillRequest) => Promise<void>;
  onDeleteSkill: (request: DeleteSkillRequest) => Promise<void>;
  /** Skills 页「生成 Skill」：回到主对话区；后续可接斜杠命令。 */
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
  skills: "Skills",
  appearance: "主题与窗口效果",
};

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
              title="进入主对话区；空闲时会新开会话，后续可在此接斜杠生成 Skill"
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
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
                    {skillLocationLabel(item)}
                  </span>
                  {!item.enabled ? (
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
                      已关闭
                    </span>
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

function ModelsSettingsPanel({
  snapshot,
  modelsBusy,
  onAddModel,
  onRemoveModel,
}: Pick<
  SettingsViewProps,
  "snapshot" | "modelsBusy" | "onAddModel" | "onRemoveModel"
>) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newApiBase, setNewApiBase] = useState("");
  const [newApiKey, setNewApiKey] = useState("");

  const models = snapshot?.config.models ?? [];
  const activeModel = snapshot?.config.activeModel ?? "";

  const resetForm = () => {
    setNewName("");
    setNewApiBase("");
    setNewApiKey("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">模型</h1>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            resetForm();
            setAddDialogOpen(true);
          }}
          disabled={modelsBusy}
        >
          添加模型
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
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
                        当前
                      </span>
                    ) : null}
                    {model.keyConfigured ? (
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
                        已存密钥
                      </span>
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
                  disabled={modelsBusy || isActive}
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
            <DialogTitle>添加模型</DialogTitle>
            <DialogDescription>保存名称、接口地址与密钥；添加后会设为当前模型。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label htmlFor="new-model-name">名称</Label>
              <Input
                id="new-model-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例如 my-openai"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-model-base">端点</Label>
              <Input
                id="new-model-base"
                value={newApiBase}
                onChange={(e) => setNewApiBase(e.target.value)}
                placeholder="留空则使用默认根地址"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-model-key">API Key</Label>
              <Input
                id="new-model-key"
                type="password"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="输入密钥"
                autoComplete="off"
              />
            </div>
          </div>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAddDialogOpen(false)}
              disabled={modelsBusy}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={modelsBusy}
              onClick={() => {
                void (async () => {
                  try {
                    await onAddModel({
                      name: newName,
                      apiBase: newApiBase,
                      apiKey: newApiKey,
                    });
                    setAddDialogOpen(false);
                    resetForm();
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
  skillsBusy,
  isElectronShell,
  onSavePatch,
  onResetWebHostPairing,
  onBootstrap,
  onResetSession,
  onAddModel,
  onRemoveModel,
  onCreateSkill,
  onDeleteSkill,
  onGenerateSkillNavigate,
}: SettingsViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex min-h-full flex-col justify-center">
          <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
            {tab !== "models" && tab !== "skills" ? (
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
                onAddModel={onAddModel}
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
