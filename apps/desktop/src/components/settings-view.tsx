import { useState, type ReactNode } from "react";

import { LoaderCircle, RefreshCw, RotateCcw } from "lucide-react";

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
import type { AddModelRequest, DesktopSnapshot } from "@/types";

export type SettingsFormState = {
  activeModel: string;
  apiBase: string;
  uiLocale: string;
  apiKey: string;
  windowsMica: boolean;
  planMode: boolean;
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
  isElectronShell: boolean;
  onSavePatch: (patch: Partial<SettingsFormState>) => Promise<void>;
  onBootstrap: () => Promise<void>;
  onResetSession: () => Promise<void>;
  onAddModel: (request: AddModelRequest) => Promise<void>;
  onRemoveModel: (name: string) => Promise<void>;
};

const themeSelectOptions: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

const settingsPageTitle: Record<SettingsSidebarTab, string> = {
  basic: "工作区与连接",
  models: "模型",
  appearance: "主题与窗口效果",
};

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
}: Pick<SettingsViewProps, "settings" | "snapshot" | "onSavePatch">) {
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
  isElectronShell,
  onSavePatch,
  onBootstrap,
  onResetSession,
  onAddModel,
  onRemoveModel,
}: SettingsViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex min-h-full flex-col justify-center">
          <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
            {tab !== "models" ? (
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
              />
            ) : tab === "models" ? (
              <ModelsSettingsPanel
                snapshot={snapshot}
                modelsBusy={modelsBusy}
                onAddModel={onAddModel}
                onRemoveModel={onRemoveModel}
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
