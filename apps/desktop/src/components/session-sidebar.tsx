import { useMemo, useState } from "react";

import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FolderClosed,
  FolderOpen,
  Layers,
  MoonStar,
  Package,
  Palette,
  Plus,
  Plug,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
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
  workspaceRoot?: string | null;
  sessions: SessionListItem[];
  activeFilePath: string | null;
  onSelectSession: (path: string) => void;
  onNewSession: () => void;
  onOpenMarketplace?: () => void;
  onOpenSettings: () => void;
  onBackToSessions?: () => void;
  marketplaceActive?: boolean;
  settingsTab?: SettingsSidebarTab;
  onSettingsTabChange?: (tab: SettingsSidebarTab) => void;
  hostStatus: string;
  mcpState: string | null;
  /** Windows 云母：侧栏需半透明+blur，避免透出窗后内容发花 */
  micaStyle?: boolean;
  busy?: boolean;
  disabled?: boolean;
};

export type SettingsSidebarTab = "basic" | "appearance" | "models" | "mcps" | "skills" | "extensions" | "dreams";

type SessionWorkspaceGroup = {
  id: string;
  label: string;
  rootPath: string | null;
  sessions: SessionListItem[];
  latestModifiedAtUnixMs: number;
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function deriveWorkspaceLabel(workspaceRoot: string | null | undefined): string {
  const trimmed = workspaceRoot?.trim();
  if (!trimmed) {
    return "当前工作区";
  }
  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/g, "");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) || normalized : normalized;
}

function buildWorkspaceGroups(
  sessions: SessionListItem[],
  workspaceRoot: string | null | undefined,
): SessionWorkspaceGroup[] {
  const currentWorkspaceRoot = workspaceRoot?.trim() || null;
  const groups = new Map<string, SessionWorkspaceGroup>();

  for (const session of sessions) {
    const rootPath = session.workspaceRoot?.trim() || currentWorkspaceRoot;
    if (!rootPath) {
      continue;
    }

    const id = normalizePath(rootPath);
    const existing = groups.get(id);
    if (existing) {
      existing.sessions.push(session);
      existing.latestModifiedAtUnixMs = Math.max(
        existing.latestModifiedAtUnixMs,
        session.modifiedAtUnixMs,
      );
      continue;
    }

    groups.set(id, {
      id,
      label: deriveWorkspaceLabel(rootPath),
      rootPath,
      sessions: [session],
      latestModifiedAtUnixMs: session.modifiedAtUnixMs,
    });
  }

  return [...groups.values()].sort((left, right) => {
    const leftIsCurrent = Boolean(currentWorkspaceRoot && samePath(left.rootPath ?? "", currentWorkspaceRoot));
    const rightIsCurrent = Boolean(currentWorkspaceRoot && samePath(right.rootPath ?? "", currentWorkspaceRoot));
    if (leftIsCurrent !== rightIsCurrent) {
      return leftIsCurrent ? -1 : 1;
    }
    return right.latestModifiedAtUnixMs - left.latestModifiedAtUnixMs;
  });
}

const settingsTabs: Array<{
  id: SettingsSidebarTab;
  label: string;
  icon: LucideIcon;
}> = [
  {
    id: "basic",
    label: "基础",
    icon: SlidersHorizontal,
  },
  {
    id: "models",
    label: "模型",
    icon: Layers,
  },
  {
    id: "skills",
    label: "Skills",
    icon: Sparkles,
  },
  {
    id: "dreams",
    label: "梦境",
    icon: MoonStar,
  },
  {
    id: "extensions",
    label: "扩展",
    icon: Package,
  },
  {
    id: "mcps",
    label: "MCPs",
    icon: Plug,
  },
  {
    id: "appearance",
    label: "外观",
    icon: Palette,
  },
];

export function SessionSidebar({
  className,
  narrow,
  mode = "sessions",
  workspaceRoot,
  sessions,
  activeFilePath,
  onSelectSession,
  onNewSession,
  onOpenMarketplace,
  onOpenSettings,
  onBackToSessions,
  marketplaceActive = false,
  settingsTab = "basic",
  onSettingsTabChange,
  hostStatus,
  mcpState,
  micaStyle,
  busy,
  disabled,
}: SessionSidebarProps) {
  const settingsMode = mode === "settings";
  const workspaceGroups = useMemo(
    () => buildWorkspaceGroups(sessions, workspaceRoot),
    [sessions, workspaceRoot],
  );
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<Record<string, boolean>>({});

  const toggleWorkspaceGroup = (groupId: string) => {
    setCollapsedWorkspaceIds((current) => ({
      ...current,
      [groupId]: current[groupId] === false ? true : false,
    }));
  };

  return (
    <aside
      className={cn(
        "flex h-full w-full min-w-0 flex-col overflow-hidden text-sidebar-foreground dark:text-foreground",
        micaStyle
          ? "border-r border-black/5 bg-transparent dark:border-white/10"
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
          <Button
            type="button"
            variant={marketplaceActive ? "secondary" : "ghost"}
            size={narrow ? "icon" : "sm"}
            title={narrow ? "扩展" : undefined}
            aria-current={marketplaceActive ? "page" : undefined}
            className={cn(
              "text-xs text-sidebar-foreground/90 hover:bg-foreground/[0.05] dark:hover:bg-foreground/10",
              narrow
                ? "size-8 shrink-0"
                : "h-8 w-full justify-start gap-2",
            )}
            disabled={disabled || busy}
            onClick={onOpenMarketplace}
          >
            <Package className="size-3.5" aria-hidden />
            <span className={cn(narrow && "sr-only")}>扩展</span>
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
        {settingsMode ? null : (
          <div className="shrink-0 px-1.5 pt-1.5">
            <p className="px-2.5 pb-1.5 text-[0.65rem] text-sidebar-faint-foreground">工作区</p>
          </div>
        )}
        <ScrollArea className="h-full min-h-0 min-w-0" type="hover" scrollHideDelay={450}>
          {settingsMode ? (
            <nav className="flex min-w-0 flex-col gap-0.5 p-1.5" aria-label="设置页签">
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
                    title={narrow ? tab.label : undefined}
                    className={cn(
                      buttonVariants({
                        variant: selected ? "secondary" : "ghost",
                        size: narrow ? "icon" : "sm",
                      }),
                      "text-xs text-sidebar-foreground/90 hover:bg-foreground/[0.05] dark:hover:bg-foreground/10",
                      narrow ? "size-8 shrink-0" : "h-8 w-full justify-start gap-2",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                    <span className={cn("min-w-0 truncate", narrow && "sr-only")}>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          ) : (
            <div className="min-w-0 px-1.5 pb-1.5">
              <nav className="flex min-w-0 flex-col gap-0.5" aria-label="工作区会话">
                {workspaceGroups.map((group) => {
                  const expanded = collapsedWorkspaceIds[group.id] !== false;
                  const panelId = `workspace-session-group-${group.id.replace(/[^a-z0-9_-]/g, "-")}`;

                  return (
                    <div key={group.id} className="min-w-0">
                      <button
                        type="button"
                        disabled={disabled || busy}
                        aria-expanded={expanded}
                        aria-controls={panelId}
                        onClick={() => toggleWorkspaceGroup(group.id)}
                        className={cn(
                          "group flex h-8 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2.5 text-left text-sm",
                          "outline-none transition-[color,background,box-shadow] duration-150",
                          "focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
                          "text-sidebar-foreground/90 hover:bg-foreground/[0.05] hover:text-sidebar-foreground dark:hover:bg-foreground/10",
                        )}
                        title={group.rootPath ?? group.label}
                      >
                        {expanded ? (
                          <ChevronDown className="size-3 shrink-0 text-sidebar-faint-foreground" aria-hidden />
                        ) : (
                          <ChevronRight className="size-3 shrink-0 text-sidebar-faint-foreground" aria-hidden />
                        )}
                        {expanded ? (
                          <FolderOpen className="size-3.5 shrink-0 text-sidebar-faint-foreground" aria-hidden />
                        ) : (
                          <FolderClosed className="size-3.5 shrink-0 text-sidebar-faint-foreground" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">{group.label}</span>
                      </button>

                      <div id={panelId} className={cn("min-w-0", !expanded && "hidden") }>
                        <div className="mt-0.5 flex min-w-0 flex-col gap-0.5">
                          {group.sessions.map((session) => {
                            const sessionRowSelected =
                              !marketplaceActive &&
                              activeFilePath !== null &&
                              samePath(session.path, activeFilePath);
                            return (
                              <button
                                key={session.path}
                                type="button"
                                disabled={disabled || busy}
                                aria-current={sessionRowSelected ? "true" : undefined}
                                onClick={() => onSelectSession(session.path)}
                                className={cn(
                                  "group flex w-full min-w-0 items-center overflow-hidden rounded-md py-2 pr-2.5 pl-8 text-left text-sm",
                                  "outline-none transition-[color,background,box-shadow] duration-150",
                                  "focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
                                  sessionRowSelected
                                    ? "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                                    : cn(
                                        "text-sidebar-list-foreground",
                                        "hover:bg-foreground/[0.05] hover:text-sidebar-foreground dark:hover:bg-foreground/10",
                                      ),
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
                        </div>
                      </div>
                    </div>
                  );
                })}
              </nav>
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
