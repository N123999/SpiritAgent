import {
  ArrowLeft,
  Layers,
  Package,
  Palette,
  Plus,
  Plug,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { DesktopSnapshot, SessionListItem } from "@/types";

function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

type SessionSidebarProps = {
  className?: string;
  /** 窄轨：只换样式/折叠列表，不切换整棵子树，避免与外层 width 动画错拍 */
  narrow: boolean;
  mode?: "sessions" | "settings";
  sessions: SessionListItem[];
  activeFilePath: string | null;
  onSelectSession: (path: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
  onBackToSessions?: () => void;
  settingsTab?: SettingsSidebarTab;
  onSettingsTabChange?: (tab: SettingsSidebarTab) => void;
  hostStatus: string;
  mcpState: string | null;
  /** Windows 云母：侧栏需半透明+blur，避免透出窗后内容发花 */
  micaStyle?: boolean;
  busy?: boolean;
  disabled?: boolean;
};

export type SettingsSidebarTab = "basic" | "appearance" | "models" | "mcps" | "skills" | "extensions";

const settingsTabs: Array<{
  id: SettingsSidebarTab;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    id: "basic",
    label: "基础",
    description: "工作区与连接",
    icon: SlidersHorizontal,
  },
  {
    id: "models",
    label: "模型",
    description: "列表与密钥",
    icon: Layers,
  },
  {
    id: "skills",
    label: "Skills",
    description: "用户技能目录",
    icon: Sparkles,
  },
  {
    id: "extensions",
    label: "扩展",
    description: "导入、列表与删除",
    icon: Package,
  },
  {
    id: "mcps",
    label: "MCPs",
    description: "服务与传输配置",
    icon: Plug,
  },
  {
    id: "appearance",
    label: "外观",
    description: "主题与窗口效果",
    icon: Palette,
  },
];

export function SessionSidebar({
  className,
  narrow,
  mode = "sessions",
  sessions,
  activeFilePath,
  onSelectSession,
  onNewSession,
  onOpenSettings,
  onBackToSessions,
  settingsTab = "basic",
  onSettingsTabChange,
  hostStatus,
  mcpState,
  micaStyle,
  busy,
  disabled,
}: SessionSidebarProps) {
  const settingsMode = mode === "settings";

  return (
    <aside
      className={cn(
        "flex h-full w-full min-w-0 flex-col overflow-hidden text-sidebar-foreground dark:text-foreground",
        micaStyle
          ? "border-r border-black/5 bg-sidebar/30 backdrop-blur-2xl supports-backdrop-filter:bg-sidebar/25 dark:border-white/10 dark:bg-background/30 dark:supports-backdrop-filter:bg-background/25"
          : "border-r border-border/30 bg-sidebar dark:border-border/40 dark:bg-background",
        className,
      )}
      data-narrow={narrow || undefined}
      id="session-sidebar-panel"
      aria-label={settingsMode ? "设置导航侧栏" : "会话与设置侧栏"}
    >
      {settingsMode ? (
        <div
          className={cn(
            "flex flex-col gap-2 px-1.5 pt-2.5",
            narrow && "items-center",
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size={narrow ? "icon" : "sm"}
            className={cn(
              "text-xs text-sidebar-foreground/90 hover:bg-foreground/[0.05] dark:hover:bg-foreground/10",
              narrow ? "size-8" : "h-8 w-full justify-start gap-2",
            )}
            onClick={onBackToSessions}
          >
            <ArrowLeft className="size-4" aria-hidden />
            <span className={cn(narrow && "sr-only")}>返回</span>
          </Button>
          {narrow ? null : (
            <div className="px-1.5 pb-1">
              <p className="text-[0.65rem] text-sidebar-faint-foreground">设置</p>
              <p className="pt-1 text-sm font-medium text-sidebar-foreground">页面导航</p>
            </div>
          )}
        </div>
      ) : (
        <div
          className={cn(
            "flex flex-col gap-1.5 px-1.5 pt-2.5",
            narrow && "shrink-0 items-center",
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size={narrow ? "icon" : "sm"}
            className={cn(
              "text-xs text-sidebar-foreground/90 hover:bg-foreground/[0.05] dark:hover:bg-foreground/10",
              narrow
                ? "size-8 shrink-0"
                : "h-8 w-full justify-start gap-2",
            )}
            disabled={disabled || busy}
            onClick={onNewSession}
          >
            <Plus className="size-3.5" aria-hidden />
            <span className={cn(narrow && "sr-only")}>新会话</span>
          </Button>
        </div>
      )}

      <div
        className={cn(
          "min-h-0 w-full min-w-0 flex-1 overflow-hidden",
          !settingsMode && narrow && "hidden min-h-0 flex-none",
        )}
        aria-hidden={!settingsMode && narrow}
      >
        <ScrollArea className="h-full min-h-0 min-w-0" type="hover" scrollHideDelay={450}>
          {settingsMode ? (
            <nav className="flex flex-col gap-1 p-1.5" aria-label="设置页签">
              {settingsTabs.map((tab) => {
                const selected = tab.id === settingsTab;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSettingsTabChange?.(tab.id)}
                    aria-current={selected ? "page" : undefined}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left outline-none transition-[color,background,box-shadow] duration-150",
                      "hover:bg-foreground/[0.04] hover:text-sidebar-foreground dark:hover:bg-foreground/[0.07]",
                      "focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
                      selected
                        ? "bg-foreground/[0.08] text-sidebar-foreground dark:bg-foreground/12"
                        : "text-sidebar-list-foreground",
                      narrow && "justify-center px-2.5",
                    )}
                    title={narrow ? tab.label : undefined}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {narrow ? (
                      <span className="sr-only">{tab.label}</span>
                    ) : (
                      <span className="min-w-0 space-y-0.5">
                        <span className="block text-sm font-medium">{tab.label}</span>
                        <span className="block text-xs leading-5 text-sidebar-faint-foreground">
                          {tab.description}
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          ) : (
            <div className="min-w-0 p-1.5">
              <p className="px-1 pb-1.5 text-[0.65rem] text-sidebar-faint-foreground">已保存</p>
              {sessions.length === 0 ? (
                <p className="px-2 py-2 text-center text-xs text-sidebar-faint-foreground">暂无</p>
              ) : (
                <nav className="flex min-w-0 flex-col gap-0.5" aria-label="已保存会话">
                  {sessions.map((session) => {
                    const selected =
                      activeFilePath !== null && samePath(session.path, activeFilePath);
                    return (
                      <button
                        key={session.path}
                        type="button"
                        disabled={disabled || busy}
                        onClick={() => onSelectSession(session.path)}
                        className={cn(
                          "group flex w-full min-w-0 items-center overflow-hidden rounded-md px-2.5 py-2 text-left text-sm",
                          "text-sidebar-list-foreground outline-none transition-[color,background,box-shadow] duration-150",
                          "hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.07]",
                          "hover:text-sidebar-foreground",
                          "focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
                          selected && "bg-foreground/[0.08] text-sidebar-foreground dark:bg-foreground/12",
                        )}
                      >
                        <span
                          className="min-w-0 flex-1 basis-0 truncate text-xs font-medium"
                          title={session.displayName}
                        >
                          {session.displayName}
                        </span>
                      </button>
                    );
                  })}
                </nav>
              )}
            </div>
          )}
        </ScrollArea>
      </div>

      <div
        className={cn(
          "shrink-0 space-y-1 border-t border-sidebar-border/30 p-2 dark:border-border/40",
          narrow && "mt-auto flex flex-col items-center gap-1.5 border-t py-2",
        )}
      >
        {settingsMode ? null : (
          <Button
            type="button"
            variant="ghost"
            size={narrow ? "icon" : "sm"}
            className={cn(
              "text-sidebar-foreground/90 hover:bg-foreground/[0.05] dark:hover:bg-foreground/10",
              narrow ? "size-8" : "h-8 w-full justify-start gap-2",
            )}
            onClick={onOpenSettings}
          >
            <Settings2 className="size-4" aria-hidden />
            <span className={cn(narrow && "sr-only")}>设置</span>
          </Button>
        )}
        {narrow ? (
          <>
            <p className="sr-only" role="status">
              {hostStatus}
              {mcpState ? ` · ${mcpState}` : null}
            </p>
            <div
              className="size-1.5 rounded-full bg-sidebar-faint-foreground/50"
              title={mcpState ? `${hostStatus} · ${mcpState}` : hostStatus}
              aria-hidden
            />
          </>
        ) : (
          <p className="line-clamp-2 px-1.5 text-[0.65rem] leading-relaxed text-sidebar-faint-foreground">
            {hostStatus}
            {mcpState ? ` · ${mcpState}` : null}
          </p>
        )}
      </div>
    </aside>
  );
}

export function mcpBadgeText(snapshot: DesktopSnapshot | null): string | null {
  if (!snapshot) {
    return null;
  }
  return `MCP ${snapshot.mcpStatus.state}`;
}
