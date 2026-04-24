import type { ReactNode } from "react";

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
import type { ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { DesktopSnapshot } from "@/types";

export type SettingsFormState = {
  activeModel: string;
  apiBase: string;
  uiLocale: string;
  apiKey: string;
  windowsMica: boolean;
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
  isElectronShell: boolean;
  onSavePatch: (patch: Partial<SettingsFormState>) => Promise<void>;
  onBootstrap: () => Promise<void>;
  onResetSession: () => Promise<void>;
};

const themeSelectOptions: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

const settingsPageTitle: Record<SettingsSidebarTab, string> = {
  basic: "工作区与连接",
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
  isElectronShell,
  onSavePatch,
  onBootstrap,
  onResetSession,
}: SettingsViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex min-h-full flex-col justify-center">
          <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
            <h1 className="mb-6 text-xl font-semibold tracking-tight text-foreground">
              {settingsPageTitle[tab]}
            </h1>

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
