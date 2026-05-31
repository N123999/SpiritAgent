import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ArrowLeft,
  FolderClosed,
  FolderOpen,
  Layers,
  Code2,
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
import { resolveWorkspaceGroupingRoot } from "@/lib/workspace-grouping";
import { cn } from "@/lib/utils";
import i18n from "@/lib/i18n";
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
  extensionSettingsId?: string | null;
  extensionSettingsItems?: Array<{
    id: string;
    label: string;
  }>;
  onSettingsTabChange?: (tab: SettingsSidebarTab) => void;
  onExtensionSettingsChange?: (extensionId: string) => void;
  hostStatus: string;
  mcpState: string | null;
  /** Windows 云母：侧栏需半透明+blur，避免透出窗后内容发花 */
  micaStyle?: boolean;
  newSessionBusy?: boolean;
  sessionNavigationBusy?: boolean;
  disabled?: boolean;
};

export type SettingsSidebarTab =
  | "basic"
  | "appearance"
  | "models"
  | "mcps"
  | "skills"
  | "extensions"
  | "dreams"
  | "developer";

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
    return i18n.t('sidebar.currentWorkspace');
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

  const currentGroupingRoot = currentWorkspaceRoot
    ? resolveWorkspaceGroupingRoot(currentWorkspaceRoot)
    : null;

  for (const session of sessions) {
    const rootPath = session.workspaceRoot?.trim() || currentWorkspaceRoot;
    if (!rootPath) {
      continue;
    }

    const groupingRoot = resolveWorkspaceGroupingRoot(rootPath);
    const id = normalizePath(groupingRoot);
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
      label: deriveWorkspaceLabel(groupingRoot),
      rootPath: groupingRoot,
      sessions: [session],
      latestModifiedAtUnixMs: session.modifiedAtUnixMs,
    });
  }

  return [...groups.values()].sort((left, right) => {
    const leftIsCurrent = Boolean(currentGroupingRoot && samePath(left.rootPath ?? "", currentGroupingRoot));
    const rightIsCurrent = Boolean(currentGroupingRoot && samePath(right.rootPath ?? "", currentGroupingRoot));
    if (leftIsCurrent !== rightIsCurrent) {
      return leftIsCurrent ? -1 : 1;
    }
    return right.latestModifiedAtUnixMs - left.latestModifiedAtUnixMs;
  });
}

const settingsTabs: Array<{
  id: SettingsSidebarTab;
  labelKey: string;
  icon: LucideIcon;
}> = [
  {
    id: "basic",
    labelKey: "settings.basic",
    icon: SlidersHorizontal,
  },
  {
    id: "models",
    labelKey: "settings.models",
    icon: Layers,
  },
  {
    id: "skills",
    labelKey: "settings.skills",
    icon: Sparkles,
  },
  {
    id: "dreams",
    labelKey: "settings.dreams",
    icon: MoonStar,
  },
  {
    id: "extensions",
    labelKey: "settings.extensions",
    icon: Package,
  },
  {
    id: "mcps",
    labelKey: "settings.mcps",
    icon: Plug,
  },
  {
    id: "appearance",
    labelKey: "settings.appearance",
    icon: Palette,
  },
  {
    id: "developer",
    labelKey: "settings.developer",
    icon: Code2,
  },
];

const sidebarInteractionMotionClass =
  "!transition-[opacity,transform,box-shadow] duration-150";

const sidebarMenuHoverClass =
  "hover:!bg-accent hover:!text-accent-foreground focus-visible:!bg-accent focus-visible:!text-accent-foreground";

/** 工作区 / 会话行：hover 只铺底，不把文案提亮（与 composer 区下拉一致） */
const sidebarSessionListHoverClass =
  "hover:!bg-accent focus-visible:!bg-accent focus-visible:!text-accent-foreground";

const sidebarSelectedHoverClass =
  "hover:!bg-secondary hover:!text-secondary-foreground";

/** Mica 透明壳：选中/悬停使用半透明铺底，避免实心 secondary 挡住云母 */
const sidebarMicaMenuHoverClass =
  "hover:!bg-foreground/[0.06] focus-visible:!bg-foreground/[0.06] dark:hover:!bg-white/[0.06]";

const sidebarMicaSelectedClass =
  "!bg-foreground/[0.08] !text-foreground hover:!bg-foreground/[0.12] focus-visible:!bg-foreground/[0.12] dark:!bg-white/[0.08] dark:hover:!bg-white/[0.12]";

function sidebarItemHoverClass(micaStyle?: boolean) {
  return micaStyle ? sidebarMicaMenuHoverClass : sidebarMenuHoverClass;
}

function sidebarItemSelectedClass(micaStyle?: boolean) {
  return micaStyle ? sidebarMicaSelectedClass : sidebarSelectedHoverClass;
}

function sidebarNavButtonVariant(micaStyle: boolean | undefined, selected: boolean) {
  return micaStyle ? "ghost" : selected ? "secondary" : "ghost";
}

function sessionRowSelectedClass(micaStyle?: boolean) {
  return micaStyle
    ? "bg-foreground/[0.08] text-foreground hover:!bg-foreground/[0.12] dark:bg-white/[0.08] dark:hover:!bg-white/[0.12]"
    : "bg-secondary text-secondary-foreground hover:!bg-secondary hover:!text-secondary-foreground";
}

function sessionRowHoverClass(micaStyle?: boolean) {
  return micaStyle ? sidebarMicaMenuHoverClass : sidebarSessionListHoverClass;
}

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
  extensionSettingsId = null,
  extensionSettingsItems = [],
  onSettingsTabChange,
  onExtensionSettingsChange,
  hostStatus,
  mcpState,
  micaStyle,
  newSessionBusy = false,
  sessionNavigationBusy = false,
  disabled,
}: SessionSidebarProps) {
  const { t, i18n } = useTranslation();
  const settingsMode = mode === "settings";
  const workspaceGroups = useMemo(
    () => buildWorkspaceGroups(sessions, workspaceRoot),
    [sessions, workspaceRoot, i18n.language],
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
      aria-label={settingsMode ? t('sidebar.settingsNavAria') : t('sidebar.sessionNavAria')}
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
              "text-xs text-sidebar-foreground/90",
              sidebarInteractionMotionClass,
              sidebarItemHoverClass(micaStyle),
              narrow ? "size-8" : "h-8 w-full justify-start gap-2",
            )}
            onClick={onBackToSessions}
          >
            <ArrowLeft className="size-4" aria-hidden />
            <span className={cn(narrow && "sr-only")}>{t('common.back')}</span>
          </Button>
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
              "text-xs text-sidebar-foreground/90",
              sidebarInteractionMotionClass,
              sidebarItemHoverClass(micaStyle),
              narrow
                ? "size-8 shrink-0"
                : "h-8 w-full justify-start gap-2",
            )}
            disabled={disabled || newSessionBusy}
            onClick={onNewSession}
          >
            <Plus className="size-3.5" aria-hidden />
            <span className={cn(narrow && "sr-only")}>{t('sidebar.newSession')}</span>
          </Button>
          <Button
            type="button"
            variant={sidebarNavButtonVariant(micaStyle, marketplaceActive)}
            size={narrow ? "icon" : "sm"}
            title={narrow ? t('sidebar.extensions') : undefined}
            aria-current={marketplaceActive ? "page" : undefined}
            className={cn(
              "text-xs text-sidebar-foreground/90",
              sidebarInteractionMotionClass,
              marketplaceActive
                ? sidebarItemSelectedClass(micaStyle)
                : sidebarItemHoverClass(micaStyle),
              narrow
                ? "size-8 shrink-0"
                : "h-8 w-full justify-start gap-2",
            )}
            disabled={disabled}
            onClick={onOpenMarketplace}
          >
            <Package className="size-3.5" aria-hidden />
            <span className={cn(narrow && "sr-only")}>{t('sidebar.extensions')}</span>
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
          <div className="shrink-0 px-1.5 pt-3 pb-2.5">
            <p className="px-2.5 text-[0.65rem] text-sidebar-faint-foreground">{t('sidebar.workspace')}</p>
          </div>
        )}
        <ScrollArea className="h-full min-h-0 min-w-0" type="hover" scrollHideDelay={450}>
          {settingsMode ? (
            <nav className="flex min-w-0 flex-col gap-0.5 p-1.5" aria-label={t('sidebar.settingsTabsAria')}>
              {settingsTabs.map((tab) => {
                const selected = extensionSettingsId === null && tab.id === settingsTab;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSettingsTabChange?.(tab.id)}
                    aria-current={selected ? "page" : undefined}
                    title={narrow ? t(tab.labelKey) : undefined}
                    className={cn(
                      buttonVariants({
                        variant: sidebarNavButtonVariant(micaStyle, selected),
                        size: narrow ? "icon" : "sm",
                      }),
                      "text-xs text-sidebar-foreground/90",
                      sidebarInteractionMotionClass,
                      selected ? sidebarItemSelectedClass(micaStyle) : sidebarItemHoverClass(micaStyle),
                      narrow ? "size-8 shrink-0" : "h-8 w-full justify-start gap-2",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                    <span className={cn("min-w-0 truncate", narrow && "sr-only")}>{t(tab.labelKey)}</span>
                  </button>
                );
              })}
              {extensionSettingsItems.length > 0 ? (
                <>
                  <div className="h-2" aria-hidden />
                  {narrow ? null : (
                    <p className="px-2.5 pb-1 text-[0.65rem] text-sidebar-faint-foreground">
                      {t('sidebar.extensionSettings')}
                    </p>
                  )}
                  {extensionSettingsItems.map((item) => {
                    const selected = item.id === extensionSettingsId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => onExtensionSettingsChange?.(item.id)}
                        aria-current={selected ? "page" : undefined}
                        title={narrow ? item.label : undefined}
                        className={cn(
                          buttonVariants({
                            variant: sidebarNavButtonVariant(micaStyle, selected),
                            size: narrow ? "icon" : "sm",
                          }),
                          "text-xs text-sidebar-foreground/90",
                          sidebarInteractionMotionClass,
                          selected ? sidebarItemSelectedClass(micaStyle) : sidebarItemHoverClass(micaStyle),
                          narrow ? "size-8 shrink-0" : "h-8 w-full justify-start gap-2",
                        )}
                      >
                        <Package className="size-3.5" aria-hidden />
                        <span className={cn("min-w-0 truncate", narrow && "sr-only")}>{item.label}</span>
                      </button>
                    );
                  })}
                </>
              ) : null}
            </nav>
          ) : (
            <div className="min-w-0 px-1.5 pb-1.5">
              <nav className="flex min-w-0 flex-col gap-0.5" aria-label={t('sidebar.workspaceSessionsAria')}>
                {workspaceGroups.map((group) => {
                  const expanded = collapsedWorkspaceIds[group.id] !== false;
                  const panelId = `workspace-session-group-${group.id.replace(/[^a-z0-9_-]/g, "-")}`;

                  return (
                    <div key={group.id} className="min-w-0">
                      <button
                        type="button"
                        disabled={disabled}
                        aria-expanded={expanded}
                        aria-controls={panelId}
                        onClick={() => toggleWorkspaceGroup(group.id)}
                        className={cn(
                          "group flex h-8 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2.5 text-left text-sm",
                          "outline-none",
                          sidebarInteractionMotionClass,
                          "focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
                          "text-sidebar-foreground/90",
                          sessionRowHoverClass(micaStyle),
                        )}
                        title={group.rootPath ?? group.label}
                      >
                        {expanded ? (
                          <FolderOpen className="size-3.5 shrink-0" aria-hidden />
                        ) : (
                          <FolderClosed className="size-3.5 shrink-0" aria-hidden />
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
                                disabled={disabled}
                                aria-current={sessionRowSelected ? "true" : undefined}
                                onClick={() => onSelectSession(session.path)}
                                className={cn(
                                  "group flex w-full min-w-0 items-center overflow-hidden rounded-md py-2 pr-2.5 pl-8 text-left text-sm",
                                  "outline-none",
                                  sidebarInteractionMotionClass,
                                  "focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
                                  sessionRowSelected
                                    ? sessionRowSelectedClass(micaStyle)
                                    : cn("text-sidebar-foreground/90", sessionRowHoverClass(micaStyle)),
                                )}
                              >
                                <span
                                  className="min-w-0 flex-1 basis-0 truncate text-xs font-medium"
                                  title={session.displayName}
                                >
                                  {session.displayName}
                                </span>
                                {session.isBusy ? (
                                  <span
                                    className="size-1.5 shrink-0 rounded-full bg-primary animate-pulse"
                                    aria-label={t('common.running')}
                                  />
                                ) : null}
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
              "text-sidebar-foreground/90",
              sidebarInteractionMotionClass,
              sidebarItemHoverClass(micaStyle),
              narrow ? "size-8" : "h-8 w-full justify-start gap-2",
            )}
            onClick={onOpenSettings}
          >
            <Settings2 className="size-4" aria-hidden />
            <span className={cn(narrow && "sr-only")}>{t('settings.title')}</span>
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
