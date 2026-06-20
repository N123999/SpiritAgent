import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

import {
  BookText,
  Bot,
  ArrowLeft,
  ChevronRight,
  FolderClosed,
  FolderOpen,
  Layers,
  Code2,
  Link2,
  LoaderCircle,
  MoonStar,
  Network,
  Package,
  Palette,
  Plug,
  SquarePen,
  Settings,
  Sparkles,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import { sidebarSessionsScrollTopGapClass } from "@/lib/mask-styles";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AnimatedCollapse,
  AnimatedCollapseContent,
  AnimatedCollapseTrigger,
} from "@/components/ui/animated-collapse";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  readSidebarNoWorkspaceSectionExpanded,
  readSidebarWorkspaceSectionExpanded,
  readWorkspaceSidebarExpandedById,
  writeSidebarNoWorkspaceSectionExpanded,
  writeSidebarWorkspaceSectionExpanded,
  writeWorkspaceSidebarExpandedById,
} from "@/lib/layout-prefs";
import { resolveWorkspaceGroupingRoot } from "@/lib/workspace-grouping";
import { isViteDev } from "@/lib/vite-dev";
import { cn } from "@/lib/utils";
import { shortcutLabel } from "@/lib/desktop-shell";
import i18n from "@/lib/i18n";
import type { SessionListItem } from "@/types";

/** 平台快捷键提示，模块加载时计算（平台不会运行时变化）。 */
const newSessionShortcutLabel = shortcutLabel("N");


function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

type SessionSidebarProps = {
  className?: string;
  /** 窄轨：只换样式/折叠列表，不切换整棵子树，避免与外层 width 动画错拍 */
  narrow: boolean;
  mode?: "sessions" | "settings";
  /** 用户主目录，用于将主目录会话划入「无工作区」区。 */
  userHomeDirectory?: string | null;
  sessions: SessionListItem[];
  activeFilePath: string | null;
  onSelectSession: (path: string) => void;
  onNewSession: () => void;
  onOpenMarketplace?: () => void;
  onOpenAutomations?: () => void;
  onOpenSettings: () => void;
  onBackToSessions?: () => void;
  marketplaceActive?: boolean;
  automationsActive?: boolean;
  settingsTab?: SettingsSidebarTab;
  extensionSettingsId?: string | null;
  extensionSettingsItems?: Array<{
    id: string;
    label: string;
  }>;
  onSettingsTabChange?: (tab: SettingsSidebarTab) => void;
  onExtensionSettingsChange?: (extensionId: string) => void;
  /** Windows 云母：侧栏需半透明+blur，避免透出窗后内容发花 */
  micaStyle?: boolean;
  newSessionBusy?: boolean;
  sessionNavigationBusy?: boolean;
  deleteSessionBusy?: boolean;
  onDeleteSession?: (path: string) => void | Promise<void>;
  deleteWorkspaceBusy?: boolean;
  onDeleteWorkspace?: (workspacePath: string) => void | Promise<void>;
  disabled?: boolean;
  /** 后台会话完成后、用户尚未打开前显示蓝色圆点。 */
  unseenCompletedSessionPaths?: ReadonlySet<string>;
};

export type SettingsSidebarTab =
  | "appearance"
  | "networks"
  | "models"
  | "agents"
  | "mcps"
  | "hooks"
  | "skills"
  | "rules"
  | "extensions"
  | "dreams"
  | "integrations"
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

  return [...groups.values()].sort(
    (left, right) => right.latestModifiedAtUnixMs - left.latestModifiedAtUnixMs,
  );
}

function isNoWorkspaceSession(session: SessionListItem, homeDirectory: string): boolean {
  const root = session.workspaceRoot?.trim();
  if (!root) {
    return true;
  }
  return samePath(root, homeDirectory);
}

function partitionSessionsForSidebar(
  sessions: SessionListItem[],
  homeDirectory: string | null | undefined,
): { bound: SessionListItem[]; unbound: SessionListItem[] } {
  const home = homeDirectory?.trim();
  if (!home) {
    return { bound: sessions, unbound: [] };
  }
  const bound: SessionListItem[] = [];
  const unbound: SessionListItem[] = [];
  for (const session of sessions) {
    if (isNoWorkspaceSession(session, home)) {
      unbound.push(session);
    } else {
      bound.push(session);
    }
  }
  return { bound, unbound };
}

function sortSessionsByModified(sessions: SessionListItem[]): SessionListItem[] {
  return [...sessions].sort((left, right) => right.modifiedAtUnixMs - left.modifiedAtUnixMs);
}

const SIDEBAR_SESSION_PAGE_SIZE = 10;

function visibleCountForSessionIndex(index: number): number {
  if (index < 0) {
    return SIDEBAR_SESSION_PAGE_SIZE;
  }
  return Math.ceil((index + 1) / SIDEBAR_SESSION_PAGE_SIZE) * SIDEBAR_SESSION_PAGE_SIZE;
}

type SessionListLoadMoreProps = {
  hiddenCount: number;
  nested?: boolean;
  disabled?: boolean;
  onLoadMore: () => void;
};

type WorkspaceSessionGroupCollapsibleProps = {
  group: SessionWorkspaceGroup;
  expanded: boolean;
  disabled?: boolean;
  micaStyle?: boolean;
  visibleSessions: SessionListItem[];
  hiddenSessionCount: number;
  unseenCompletedSessionPaths?: ReadonlySet<string>;
  isSessionSelected(path: string): boolean;
  onOpenChange(open: boolean): void;
  onSelectSession(path: string): void;
  onLoadMore(): void;
};

const sidebarSectionHeaderTriggerClass =
  "group flex w-full min-w-0 items-center overflow-hidden px-2.5 pb-1 text-left text-[0.65rem] text-sidebar-item-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/40";

const sidebarSectionChevronClass =
  "hidden size-3 shrink-0 text-muted-foreground/55 transition-transform duration-150 group-hover:inline-flex group-focus-visible:inline-flex";

type SidebarSectionCollapsibleProps = {
  label: string;
  expanded: boolean;
  disabled?: boolean;
  headerClassName?: string;
  onOpenChange(open: boolean): void;
  children: ReactNode;
};

function SidebarSectionCollapsible({
  label,
  expanded,
  disabled,
  headerClassName,
  onOpenChange,
  children,
}: SidebarSectionCollapsibleProps) {
  return (
    <AnimatedCollapse
      open={expanded}
      onOpenChange={(open) => {
        if (disabled) {
          return;
        }
        onOpenChange(open);
      }}
      className="min-w-0"
    >
      <AnimatedCollapseTrigger
        disabled={disabled}
        className={cn(sidebarSectionHeaderTriggerClass, headerClassName)}
      >
        <span className="inline-flex min-w-0 max-w-full items-center gap-1">
          <span className="truncate">{label}</span>
          <ChevronRight
            className={cn(sidebarSectionChevronClass, expanded && "rotate-90")}
            aria-hidden
          />
        </span>
      </AnimatedCollapseTrigger>
      <AnimatedCollapseContent className="min-w-0">{children}</AnimatedCollapseContent>
    </AnimatedCollapse>
  );
}

const WorkspaceSessionGroupCollapsible = memo(function WorkspaceSessionGroupCollapsible({
  group,
  expanded,
  disabled,
  micaStyle,
  visibleSessions,
  hiddenSessionCount,
  unseenCompletedSessionPaths,
  isSessionSelected,
  onOpenChange,
  onSelectSession,
  onLoadMore,
}: WorkspaceSessionGroupCollapsibleProps) {
  return (
    <AnimatedCollapse
      open={expanded}
      onOpenChange={onOpenChange}
      className="min-w-0"
    >
      <AnimatedCollapseTrigger
        disabled={disabled}
        className={cn(
          "group flex h-8 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2.5 text-left text-sm",
          "outline-none",
          sidebarInteractionMotionClass,
          "focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
          sidebarItemDefaultTextClass,
          sessionRowHoverClass(micaStyle),
        )}
        title={group.rootPath ?? group.label}
        data-workspace-path={group.rootPath ?? group.id}
      >
        {expanded ? (
          <FolderOpen className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <FolderClosed className="size-3.5 shrink-0" aria-hidden />
        )}
        <span className="flex min-w-0 flex-1 items-center overflow-hidden">
          <span className="inline-flex min-w-0 max-w-full items-center gap-1">
            <span className="truncate text-xs font-medium">{group.label}</span>
            <ChevronRight
              className={cn(
                "hidden size-3 shrink-0 text-muted-foreground/55 transition-transform duration-150",
                "group-hover:inline-flex group-focus-visible:inline-flex",
                expanded && "rotate-90",
              )}
              aria-hidden
            />
          </span>
        </span>
      </AnimatedCollapseTrigger>

      <AnimatedCollapseContent className="min-w-0">
        <div className="mt-0.5 flex min-w-0 flex-col gap-0.5">
          {visibleSessions.map((session) => (
            <SessionListRow
              key={session.path}
              sessionPath={session.path}
              displayName={session.displayName}
              isBusy={session.isBusy}
              isBlocked={session.isBlocked}
              showCompletedUnseen={unseenCompletedSessionPaths?.has(session.path) === true}
              nested
              selected={isSessionSelected(session.path)}
              disabled={disabled}
              micaStyle={micaStyle}
              onSelectPath={onSelectSession}
            />
          ))}
          <SessionListLoadMore
            hiddenCount={hiddenSessionCount}
            nested
            disabled={disabled}
            onLoadMore={onLoadMore}
          />
        </div>
      </AnimatedCollapseContent>
    </AnimatedCollapse>
  );
});

function SessionListLoadMore({ hiddenCount, nested, disabled, onLoadMore }: SessionListLoadMoreProps) {
  const { t } = useTranslation();
  if (hiddenCount <= 0) {
    return null;
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onLoadMore}
      className={cn(
        "w-full py-1 text-left text-[0.65rem] text-sidebar-item-foreground outline-none",
        nested ? "pr-2.5 pl-8" : "px-2.5",
        "rounded-md hover:text-sidebar-foreground/75 focus-visible:text-sidebar-foreground/75",
        "focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {t("sidebar.loadMoreSessions")}
    </button>
  );
}

type SessionRowStatusTone = "blocked" | "completed";

function sessionRowStatusDotClass(tone: SessionRowStatusTone): string {
  return tone === "blocked"
    ? "bg-yellow-500"
    : "bg-blue-500 dark:bg-blue-400";
}

function SessionRowStatusDot({ tone, label }: { tone: SessionRowStatusTone; label: string }) {
  return (
    <span
      className={cn("size-2 shrink-0 rounded-full", sessionRowStatusDotClass(tone))}
      role="status"
      aria-label={label}
    />
  );
}

type SessionListRowProps = {
  sessionPath: string;
  displayName: string;
  isBusy?: boolean;
  isBlocked?: boolean;
  showCompletedUnseen?: boolean;
  nested: boolean;
  selected: boolean;
  disabled?: boolean;
  micaStyle?: boolean;
  onSelectPath(path: string): void;
};

const SessionListRow = memo(function SessionListRow({
  sessionPath,
  displayName,
  isBusy,
  isBlocked,
  showCompletedUnseen,
  nested,
  selected,
  disabled,
  micaStyle,
  onSelectPath,
}: SessionListRowProps) {
  const { t } = useTranslation();
  const hasIndicator =
    (isBusy && !isBlocked) ||
    (!selected && (isBlocked || showCompletedUnseen));

  return (
    <button
      type="button"
      data-session-path={sessionPath}
      disabled={disabled}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelectPath(sessionPath)}
      className={cn(
        "group flex w-full min-w-0 items-center overflow-hidden rounded-md text-left text-sm outline-none",
        sidebarInteractionMotionClass,
        "focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
        nested
          ? "py-2 pr-2.5 pl-2.5 gap-2"
          : hasIndicator
            ? "h-8 pr-2.5 pl-2.5 gap-2"
            : "h-8 px-2.5",
        selected
          ? sessionRowSelectedClass(micaStyle)
          : cn(sidebarItemDefaultTextClass, sessionRowHoverClass(micaStyle)),
      )}
    >
      {(nested || hasIndicator) && (
        <span className="flex w-3.5 shrink-0 items-center justify-center" aria-hidden>
          {isBusy && !isBlocked ? (
            <Spinner
              className="size-3 shrink-0 text-primary"
              aria-label={t('common.running')}
            />
          ) : !selected && isBlocked ? (
            <SessionRowStatusDot tone="blocked" label={t("sidebar.sessionBlocked")} />
          ) : !selected && showCompletedUnseen ? (
            <SessionRowStatusDot tone="completed" label={t("sidebar.sessionCompleted")} />
          ) : null}
        </span>
      )}
      <span
        className="min-w-0 flex-1 basis-0 truncate text-xs font-medium"
        title={displayName}
      >
        {displayName}
      </span>
    </button>
  );
});

type SessionListNavProps = {
  ariaLabel: string;
  canDeleteSession: boolean;
  contextMenuSession: SessionListItem | null;
  contextMenuSessionRef: RefObject<SessionListItem | null>;
  deleteSessionBusy?: boolean;
  onSessionContextMenuCapture(event: MouseEvent<HTMLElement>): void;
  onContextMenuOpenChange(open: boolean): void;
  onRequestDelete(session: SessionListItem): void;
  children: ReactNode;
};

function SessionListNav({
  ariaLabel,
  canDeleteSession,
  contextMenuSession,
  contextMenuSessionRef,
  deleteSessionBusy,
  onSessionContextMenuCapture,
  onContextMenuOpenChange,
  onRequestDelete,
  children,
}: SessionListNavProps) {
  const { t } = useTranslation();

  const nav = (
    <nav
      className="flex min-w-0 flex-col gap-0.5"
      aria-label={ariaLabel}
      onContextMenuCapture={canDeleteSession ? onSessionContextMenuCapture : undefined}
    >
      {children}
    </nav>
  );

  if (!canDeleteSession) {
    return nav;
  }

  const busy = (contextMenuSession ?? contextMenuSessionRef.current)?.isBusy === true;

  return (
    <ContextMenu onOpenChange={onContextMenuOpenChange}>
      <ContextMenuTrigger asChild>{nav}</ContextMenuTrigger>
      <ContextMenuContent aria-label={t("sidebar.sessionActions")}>
        <ContextMenuItem
          variant="destructive"
          disabled={deleteSessionBusy || busy}
          title={busy ? t("sidebar.cannotDeleteBusySession") : undefined}
          onSelect={() => {
            const session = contextMenuSessionRef.current ?? contextMenuSession;
            if (session) {
              onRequestDelete(session);
            }
          }}
        >
          <Trash2 aria-hidden />
          {t("sidebar.deleteSession")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

type WorkspaceListNavProps = {
  canDeleteWorkspace: boolean;
  canDeleteSession: boolean;
  contextMenuWorkspaceGroup: SessionWorkspaceGroup | null;
  contextMenuWorkspaceGroupRef: RefObject<SessionWorkspaceGroup | null>;
  contextMenuSession: SessionListItem | null;
  contextMenuSessionRef: RefObject<SessionListItem | null>;
  deleteWorkspaceBusy?: boolean;
  deleteSessionBusy?: boolean;
  onContextMenuCapture(event: MouseEvent<HTMLElement>): void;
  onRequestDeleteWorkspace(group: SessionWorkspaceGroup): void;
  onRequestDeleteSession(session: SessionListItem): void;
  children: ReactNode;
};

function WorkspaceListNav({
  canDeleteWorkspace,
  canDeleteSession,
  contextMenuWorkspaceGroup,
  contextMenuWorkspaceGroupRef,
  contextMenuSession,
  contextMenuSessionRef,
  deleteWorkspaceBusy,
  deleteSessionBusy,
  onContextMenuCapture,
  onRequestDeleteWorkspace,
  onRequestDeleteSession,
  children,
}: WorkspaceListNavProps) {
  const { t } = useTranslation();

  const canShowMenu = canDeleteWorkspace || canDeleteSession;

  const inner = (
    <div
      className="min-w-0"
      onContextMenuCapture={canShowMenu ? onContextMenuCapture : undefined}
    >
      {children}
    </div>
  );

  if (!canShowMenu) {
    return inner;
  }

  const isWorkspaceTarget = Boolean(contextMenuWorkspaceGroup ?? contextMenuWorkspaceGroupRef.current);
  const sessionTarget = contextMenuSession ?? contextMenuSessionRef.current;
  const sessionBusy = sessionTarget?.isBusy === true;

  // 不在 onOpenChange(false) 清 target：Radix exit 动画（duration-100）未结束时 Content 仍挂载，
  // 立刻清空会让 isWorkspaceTarget 变 false，退场末帧闪成「删除会话」。capture / 删除确认时再更新即可。
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{inner}</ContextMenuTrigger>
      <ContextMenuContent aria-label={isWorkspaceTarget ? t("sidebar.workspaceActions") : t("sidebar.sessionActions")}>
        {isWorkspaceTarget && canDeleteWorkspace ? (
          <ContextMenuItem
            variant="destructive"
            disabled={deleteWorkspaceBusy}
            onSelect={() => {
              const group = contextMenuWorkspaceGroupRef.current ?? contextMenuWorkspaceGroup;
              if (group) {
                onRequestDeleteWorkspace(group);
              }
            }}
          >
            <Trash2 aria-hidden />
            {t("sidebar.deleteWorkspace")}
          </ContextMenuItem>
        ) : null}
        {!isWorkspaceTarget && canDeleteSession ? (
          <ContextMenuItem
            variant="destructive"
            disabled={deleteSessionBusy || sessionBusy}
            title={sessionBusy ? t("sidebar.cannotDeleteBusySession") : undefined}
            onSelect={() => {
              const session = contextMenuSessionRef.current ?? contextMenuSession;
              if (session) {
                onRequestDeleteSession(session);
              }
            }}
          >
            <Trash2 aria-hidden />
            {t("sidebar.deleteSession")}
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

const settingsTabs: Array<{
  id: SettingsSidebarTab;
  labelKey: string;
  icon: LucideIcon;
}> = [
  {
    id: "models",
    labelKey: "settings.models",
    icon: Layers,
  },
  {
    id: "agents",
    labelKey: "settings.agents",
    icon: Bot,
  },
  {
    id: "skills",
    labelKey: "settings.skills",
    icon: Sparkles,
  },
  {
    id: "rules",
    labelKey: "settings.rules",
    icon: BookText,
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
    id: "hooks",
    labelKey: "settings.hooks",
    icon: Code2,
  },
  {
    id: "appearance",
    labelKey: "settings.appearance",
    icon: Palette,
  },
  {
    id: "networks",
    labelKey: "settings.networks",
    icon: Network,
  },
  {
    id: "integrations",
    labelKey: "settings.integrations",
    icon: Link2,
  },
  ...(isViteDev
    ? [
        {
          id: "developer" as const,
          labelKey: "settings.developer",
          icon: Code2,
        },
      ]
    : []),
];

const sidebarInteractionMotionClass =
  "!transition-[opacity,transform,box-shadow] duration-150 active:!translate-y-0";

/** 侧栏交互项默认字色/图标色；hover 与选中回到 sidebar-foreground */
const sidebarItemDefaultTextClass = "text-sidebar-action-foreground";

const sidebarItemActiveTextClass = "!text-sidebar-foreground";

const sidebarMenuHoverClass = cn(
  "hover:!bg-accent focus-visible:!bg-accent",
  "hover:!text-sidebar-foreground focus-visible:!text-sidebar-foreground",
);

const sidebarSessionListHoverClass = sidebarMenuHoverClass;

const sidebarSelectedHoverClass = cn(
  "hover:!bg-secondary hover:!text-sidebar-foreground",
);

/** Mica 透明壳：选中/悬停使用半透明铺底，避免实心 secondary 挡住云母 */
const sidebarMicaMenuHoverClass = cn(
  "hover:!bg-foreground/[0.06] focus-visible:!bg-foreground/[0.06] dark:hover:!bg-white/[0.06]",
  "hover:!text-sidebar-foreground focus-visible:!text-sidebar-foreground",
);

const SIDEBAR_SCROLL_EDGE_THRESHOLD_PX = 1;

type SidebarScrollEdgeFades = {
  top: boolean;
  bottom: boolean;
};

function readSidebarScrollEdgeFades(viewport: HTMLElement): SidebarScrollEdgeFades {
  const { scrollTop, scrollHeight, clientHeight } = viewport;
  return {
    top: scrollTop > SIDEBAR_SCROLL_EDGE_THRESHOLD_PX,
    bottom: scrollTop + clientHeight < scrollHeight - SIDEBAR_SCROLL_EDGE_THRESHOLD_PX,
  };
}

const SIDEBAR_SCROLL_MASK =
  "linear-gradient(to bottom, rgb(0 0 0 / var(--sidebar-mask-top-alpha)) 0, black 2rem, black calc(100% - 2rem), rgb(0 0 0 / var(--sidebar-mask-bottom-alpha)) 100%)";

function sidebarScrollAreaMaskStyle(top: boolean, bottom: boolean): React.CSSProperties {
  return {
    "--sidebar-mask-top-alpha": top ? "0" : "1",
    "--sidebar-mask-bottom-alpha": bottom ? "0" : "1",
    maskImage: SIDEBAR_SCROLL_MASK,
    WebkitMaskImage: SIDEBAR_SCROLL_MASK,
    transition: "--sidebar-mask-top-alpha 150ms, --sidebar-mask-bottom-alpha 150ms",
  } as React.CSSProperties;
}

const sidebarMicaSelectedClass = cn(
  "!bg-foreground/[0.08] hover:!bg-foreground/[0.12] focus-visible:!bg-foreground/[0.12]",
  "dark:!bg-white/[0.08] dark:hover:!bg-white/[0.12]",
  sidebarItemActiveTextClass,
);

function sidebarItemHoverClass(micaStyle?: boolean) {
  return micaStyle ? sidebarMicaMenuHoverClass : sidebarMenuHoverClass;
}

function sidebarItemSelectedClass(micaStyle?: boolean) {
  return micaStyle
    ? sidebarMicaSelectedClass
    : cn(sidebarItemActiveTextClass, sidebarSelectedHoverClass);
}

function sidebarNavButtonVariant(micaStyle: boolean | undefined, selected: boolean) {
  return micaStyle ? "ghost" : selected ? "secondary" : "ghost";
}

function sessionRowSelectedClass(micaStyle?: boolean) {
  return micaStyle
    ? cn(
        "bg-foreground/[0.08] hover:!bg-foreground/[0.12] dark:bg-white/[0.08] dark:hover:!bg-white/[0.12]",
        sidebarItemActiveTextClass,
      )
    : cn(
        "bg-secondary hover:!bg-secondary",
        sidebarItemActiveTextClass,
      );
}

function sessionRowHoverClass(micaStyle?: boolean) {
  return micaStyle ? sidebarMicaMenuHoverClass : sidebarSessionListHoverClass;
}

function SessionSidebarInner({
  className,
  narrow,
  mode = "sessions",
  userHomeDirectory,
  sessions,
  activeFilePath,
  onSelectSession,
  onNewSession,
  onOpenMarketplace,
  onOpenAutomations,
  onOpenSettings,
  onBackToSessions,
  marketplaceActive = false,
  automationsActive = false,
  settingsTab = "models",
  extensionSettingsId = null,
  extensionSettingsItems = [],
  onSettingsTabChange,
  onExtensionSettingsChange,
  micaStyle,
  newSessionBusy = false,
  sessionNavigationBusy = false,
  deleteSessionBusy = false,
  onDeleteSession,
  deleteWorkspaceBusy = false,
  onDeleteWorkspace,
  disabled,
  unseenCompletedSessionPaths,
}: SessionSidebarProps) {
  const { t, i18n } = useTranslation();
  const settingsMode = mode === "settings";

  useEffect(() => {
    if (settingsMode && settingsTab === "developer" && !isViteDev) {
      onSettingsTabChange?.("models");
    }
  }, [settingsMode, settingsTab, onSettingsTabChange]);

  const { bound, unbound } = useMemo(
    () => partitionSessionsForSidebar(sessions, userHomeDirectory),
    [sessions, userHomeDirectory],
  );
  const workspaceGroups = useMemo(
    () => buildWorkspaceGroups(bound, undefined),
    [bound, i18n.language],
  );
  const unboundSessions = useMemo(() => sortSessionsByModified(unbound), [unbound]);
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState(
    readWorkspaceSidebarExpandedById,
  );
  const [workspaceSectionExpanded, setWorkspaceSectionExpanded] = useState(
    readSidebarWorkspaceSectionExpanded,
  );
  const [noWorkspaceSectionExpanded, setNoWorkspaceSectionExpanded] = useState(
    readSidebarNoWorkspaceSectionExpanded,
  );
  const [visibleCountByWorkspaceGroupId, setVisibleCountByWorkspaceGroupId] = useState<
    Record<string, number>
  >({});
  const [unboundVisibleCount, setUnboundVisibleCount] = useState(SIDEBAR_SESSION_PAGE_SIZE);
  const [deleteTarget, setDeleteTarget] = useState<SessionListItem | null>(null);
  const [deleteWorkspaceTarget, setDeleteWorkspaceTarget] = useState<SessionWorkspaceGroup | null>(null);
  const [contextMenuSession, setContextMenuSession] = useState<SessionListItem | null>(null);
  const contextMenuSessionRef = useRef<SessionListItem | null>(null);
  const [contextMenuWorkspaceGroup, setContextMenuWorkspaceGroup] = useState<SessionWorkspaceGroup | null>(null);
  const contextMenuWorkspaceGroupRef = useRef<SessionWorkspaceGroup | null>(null);
  const scrollFadeRegionRef = useRef<HTMLDivElement>(null);
  const [scrollEdgeFades, setScrollEdgeFades] = useState<SidebarScrollEdgeFades>({
    top: false,
    bottom: false,
  });
  const sessionByPath = useMemo(() => {
    const map = new Map<string, SessionListItem>();
    for (const session of sessions) {
      map.set(session.path, session);
    }
    return map;
  }, [sessions]);
  const canDeleteSession = Boolean(onDeleteSession) && !disabled;
  const canDeleteWorkspace = Boolean(onDeleteWorkspace) && !disabled;

  const workspaceGroupById = useMemo(() => {
    const map = new Map<string, SessionWorkspaceGroup>();
    for (const group of workspaceGroups) {
      map.set(group.rootPath ?? group.id, group);
      map.set(group.id, group);
    }
    return map;
  }, [workspaceGroups]);

  const handleWorkspaceContextMenuCapture = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const workspaceBtn = (event.target as HTMLElement).closest("[data-workspace-path]");
      if (workspaceBtn) {
        const workspacePath = workspaceBtn.getAttribute("data-workspace-path");
        const group = workspacePath ? workspaceGroupById.get(workspacePath) : undefined;
        if (group) {
          contextMenuWorkspaceGroupRef.current = group;
          setContextMenuWorkspaceGroup(group);
          contextMenuSessionRef.current = null;
          setContextMenuSession(null);
          return;
        }
      }

      const sessionRow = (event.target as HTMLElement).closest("[data-session-path]");
      if (sessionRow) {
        const sessionPath = sessionRow.getAttribute("data-session-path");
        const session = sessionPath ? sessionByPath.get(sessionPath) : undefined;
        if (session) {
          contextMenuSessionRef.current = session;
          setContextMenuSession(session);
          contextMenuWorkspaceGroupRef.current = null;
          setContextMenuWorkspaceGroup(null);
          return;
        }
      }
    },
    [sessionByPath, workspaceGroupById],
  );

  const handleWorkspaceContextMenuDelete = useCallback((group: SessionWorkspaceGroup) => {
    contextMenuWorkspaceGroupRef.current = null;
    setContextMenuWorkspaceGroup(null);
    setDeleteWorkspaceTarget(group);
  }, []);

  const handleSessionContextMenuCapture = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const row = (event.target as HTMLElement).closest("[data-session-path]");
      if (!row) {
        return;
      }
      const sessionPath = row.getAttribute("data-session-path");
      const session = sessionPath ? sessionByPath.get(sessionPath) : undefined;
      if (!session) {
        return;
      }
      contextMenuSessionRef.current = session;
      setContextMenuSession(session);
    },
    [sessionByPath],
  );

  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    if (!open) {
      contextMenuSessionRef.current = null;
      setContextMenuSession(null);
    }
  }, []);

  const handleContextMenuDelete = useCallback((session: SessionListItem) => {
    contextMenuSessionRef.current = null;
    setContextMenuSession(null);
    setDeleteTarget(session);
  }, []);

  const isSessionSelected = (sessionPath: string) =>
    !marketplaceActive &&
    !automationsActive &&
    !newSessionBusy &&
    !sessionNavigationBusy &&
    activeFilePath !== null &&
    samePath(sessionPath, activeFilePath);

  useEffect(() => {
    if (!activeFilePath) {
      return;
    }
    const unboundIndex = unboundSessions.findIndex((session) =>
      samePath(session.path, activeFilePath),
    );
    if (unboundIndex >= 0) {
      const needed = visibleCountForSessionIndex(unboundIndex);
      setUnboundVisibleCount((current) => (current >= needed ? current : needed));
      return;
    }
    for (const group of workspaceGroups) {
      const index = group.sessions.findIndex((session) => samePath(session.path, activeFilePath));
      if (index < 0) {
        continue;
      }
      const needed = visibleCountForSessionIndex(index);
      setVisibleCountByWorkspaceGroupId((current) => {
        const previous = current[group.id] ?? SIDEBAR_SESSION_PAGE_SIZE;
        if (previous >= needed) {
          return current;
        }
        return { ...current, [group.id]: needed };
      });
      return;
    }
  }, [activeFilePath, unboundSessions, workspaceGroups]);

  const loadMoreWorkspaceGroupSessions = useCallback((groupId: string, total: number) => {
    setVisibleCountByWorkspaceGroupId((current) => {
      const previous = current[groupId] ?? SIDEBAR_SESSION_PAGE_SIZE;
      return {
        ...current,
        [groupId]: Math.min(previous + SIDEBAR_SESSION_PAGE_SIZE, total),
      };
    });
  }, []);

  const loadMoreUnboundSessions = useCallback(() => {
    setUnboundVisibleCount((current) =>
      Math.min(current + SIDEBAR_SESSION_PAGE_SIZE, unboundSessions.length),
    );
  }, [unboundSessions.length]);

  useEffect(() => {
    const suppressScrollFade = !settingsMode && narrow;
    if (suppressScrollFade) {
      setScrollEdgeFades({ top: false, bottom: false });
      return;
    }

    const region = scrollFadeRegionRef.current;
    if (!region) {
      return;
    }

    const viewport = region.querySelector("[data-radix-scroll-area-viewport]");
    if (!(viewport instanceof HTMLElement)) {
      return;
    }

    const syncScrollEdgeFades = () => {
      setScrollEdgeFades(readSidebarScrollEdgeFades(viewport));
    };

    syncScrollEdgeFades();
    viewport.addEventListener("scroll", syncScrollEdgeFades, { passive: true });
    const resizeObserver = new ResizeObserver(syncScrollEdgeFades);
    resizeObserver.observe(viewport);
    const scrollContent = viewport.firstElementChild;
    if (scrollContent instanceof Element) {
      resizeObserver.observe(scrollContent);
    }

    return () => {
      viewport.removeEventListener("scroll", syncScrollEdgeFades);
      resizeObserver.disconnect();
    };
  }, [
    micaStyle,
    settingsMode,
    narrow,
    settingsTab,
    extensionSettingsId,
    extensionSettingsItems.length,
    sessions.length,
    workspaceGroups.length,
    unboundSessions.length,
    collapsedWorkspaceIds,
    workspaceSectionExpanded,
    noWorkspaceSectionExpanded,
  ]);

  const setWorkspaceGroupExpanded = useCallback((groupId: string, open: boolean) => {
    setCollapsedWorkspaceIds((current) => {
      const next = { ...current, [groupId]: open };
      writeWorkspaceSidebarExpandedById(next);
      return next;
    });
  }, []);

  const setWorkspaceSectionExpandedPersisted = useCallback((open: boolean) => {
    setWorkspaceSectionExpanded(open);
    writeSidebarWorkspaceSectionExpanded(open);
  }, []);

  const setNoWorkspaceSectionExpandedPersisted = useCallback((open: boolean) => {
    setNoWorkspaceSectionExpanded(open);
    writeSidebarNoWorkspaceSectionExpanded(open);
  }, []);

  return (
    <aside
      className={cn(
        "flex h-full w-full min-w-0 flex-col overflow-hidden text-sidebar-item-foreground",
        micaStyle ? "bg-transparent" : "bg-sidebar",
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
              "text-xs",
              sidebarItemDefaultTextClass,
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
              "text-xs",
              sidebarItemDefaultTextClass,
              sidebarInteractionMotionClass,
              sidebarItemHoverClass(micaStyle),
              narrow
                ? "size-8 shrink-0"
                : "h-8 w-full justify-start gap-2",
            )}
            disabled={disabled || newSessionBusy}
            onClick={onNewSession}
          >
            <SquarePen className="size-3.5" aria-hidden />
            <span className={cn(narrow && "sr-only")}>{t('sidebar.newSession')}</span>
            {!narrow && (
              <span className="ml-auto text-[0.65rem] text-sidebar-item-foreground" aria-hidden>
                {newSessionShortcutLabel}
              </span>
            )}
          </Button>
          <Button
            type="button"
            variant={sidebarNavButtonVariant(micaStyle, marketplaceActive)}
            size={narrow ? "icon" : "sm"}
            title={narrow ? t('sidebar.extensions') : undefined}
            aria-current={marketplaceActive ? "page" : undefined}
            className={cn(
              "text-xs",
              sidebarItemDefaultTextClass,
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
          {onOpenAutomations ? (
            <Button
              type="button"
              variant={sidebarNavButtonVariant(micaStyle, automationsActive)}
              size={narrow ? "icon" : "sm"}
              title={narrow ? t('sidebar.automations') : undefined}
              aria-current={automationsActive ? "page" : undefined}
              className={cn(
                "text-xs",
                sidebarItemDefaultTextClass,
                sidebarInteractionMotionClass,
                automationsActive
                  ? sidebarItemSelectedClass(micaStyle)
                  : sidebarItemHoverClass(micaStyle),
                narrow
                  ? "size-8 shrink-0"
                  : "h-8 w-full justify-start gap-2",
              )}
              disabled={disabled}
              onClick={onOpenAutomations}
            >
              <Bot className="size-3.5" aria-hidden />
              <span className={cn(narrow && "sr-only")}>{t('sidebar.automations')}</span>
            </Button>
          ) : null}
        </div>
      )}

      <div
        ref={scrollFadeRegionRef}
        className={cn(
          "relative min-h-0 w-full min-w-0 flex-1 overflow-hidden",
          !settingsMode && sidebarSessionsScrollTopGapClass,
          !settingsMode && narrow && "hidden min-h-0 flex-none",
        )}
        aria-hidden={!settingsMode && narrow}
      >
        <ScrollArea
          className="h-full min-h-0 min-w-0"
          type="hover"
          scrollHideDelay={450}
          style={sidebarScrollAreaMaskStyle(scrollEdgeFades.top, scrollEdgeFades.bottom)}
        >
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
                      "text-xs",
                      sidebarItemDefaultTextClass,
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
                    <p className="px-2.5 pb-1 text-[0.65rem] text-sidebar-item-foreground">
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
                          "text-xs",
                          sidebarItemDefaultTextClass,
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
              {workspaceGroups.length > 0 ? (
                <SidebarSectionCollapsible
                  label={t('sidebar.workspace')}
                  expanded={workspaceSectionExpanded}
                  disabled={disabled}
                  headerClassName="pt-2"
                  onOpenChange={setWorkspaceSectionExpandedPersisted}
                >
                  <WorkspaceListNav
                    canDeleteWorkspace={canDeleteWorkspace}
                    canDeleteSession={canDeleteSession}
                    contextMenuWorkspaceGroup={contextMenuWorkspaceGroup}
                    contextMenuWorkspaceGroupRef={contextMenuWorkspaceGroupRef}
                    contextMenuSession={contextMenuSession}
                    contextMenuSessionRef={contextMenuSessionRef}
                    deleteWorkspaceBusy={deleteWorkspaceBusy}
                    deleteSessionBusy={deleteSessionBusy}
                    onContextMenuCapture={handleWorkspaceContextMenuCapture}
                    onRequestDeleteWorkspace={handleWorkspaceContextMenuDelete}
                    onRequestDeleteSession={handleContextMenuDelete}
                  >
                    {workspaceGroups.map((group) => {
                      const expanded = collapsedWorkspaceIds[group.id] !== false;
                      const visibleCount = visibleCountByWorkspaceGroupId[group.id] ?? SIDEBAR_SESSION_PAGE_SIZE;
                      const visibleSessions = group.sessions.slice(0, visibleCount);
                      const hiddenSessionCount = group.sessions.length - visibleSessions.length;

                      return (
                        <WorkspaceSessionGroupCollapsible
                          key={group.id}
                          group={group}
                          expanded={expanded}
                          disabled={disabled}
                          micaStyle={micaStyle}
                          visibleSessions={visibleSessions}
                          hiddenSessionCount={hiddenSessionCount}
                          unseenCompletedSessionPaths={unseenCompletedSessionPaths}
                          isSessionSelected={isSessionSelected}
                          onOpenChange={(open) => {
                            if (disabled) {
                              return;
                            }
                            setWorkspaceGroupExpanded(group.id, open);
                          }}
                          onSelectSession={onSelectSession}
                          onLoadMore={() => loadMoreWorkspaceGroupSessions(group.id, group.sessions.length)}
                        />
                      );
                    })}
                  </WorkspaceListNav>
                </SidebarSectionCollapsible>
              ) : null}
              {unboundSessions.length > 0 && workspaceGroups.length > 0 ? (
                <div className="h-2" aria-hidden />
              ) : null}
              <SessionListNav
                ariaLabel={t('sidebar.workspaceSessionsAria')}
                canDeleteSession={canDeleteSession}
                contextMenuSession={contextMenuSession}
                contextMenuSessionRef={contextMenuSessionRef}
                deleteSessionBusy={deleteSessionBusy}
                onSessionContextMenuCapture={handleSessionContextMenuCapture}
                onContextMenuOpenChange={handleContextMenuOpenChange}
                onRequestDelete={handleContextMenuDelete}
              >
                {unboundSessions.length > 0 ? (
                  <SidebarSectionCollapsible
                    label={t('sidebar.noWorkspaceSessions')}
                    expanded={noWorkspaceSectionExpanded}
                    disabled={disabled}
                    headerClassName="pt-1"
                    onOpenChange={setNoWorkspaceSectionExpandedPersisted}
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {unboundSessions.slice(0, unboundVisibleCount).map((session) => (
                        <SessionListRow
                          key={session.path}
                          sessionPath={session.path}
                          displayName={session.displayName}
                          isBusy={session.isBusy}
                          isBlocked={session.isBlocked}
                          showCompletedUnseen={unseenCompletedSessionPaths?.has(session.path) === true}
                          nested={false}
                          selected={isSessionSelected(session.path)}
                          disabled={disabled}
                          micaStyle={micaStyle}
                          onSelectPath={onSelectSession}
                        />
                      ))}
                      <SessionListLoadMore
                        hiddenCount={unboundSessions.length - unboundVisibleCount}
                        disabled={disabled}
                        onLoadMore={loadMoreUnboundSessions}
                      />
                    </div>
                  </SidebarSectionCollapsible>
                ) : null}
              </SessionListNav>
            </div>
          )}
        </ScrollArea>
      </div>

      {!settingsMode ? (
        <div
          className={cn(
            "shrink-0 p-2",
            narrow && "mt-auto flex flex-col items-center py-2",
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size={narrow ? "icon" : "sm"}
            className={cn(
              sidebarItemDefaultTextClass,
              sidebarInteractionMotionClass,
              sidebarItemHoverClass(micaStyle),
              narrow ? "size-8" : "h-8 w-full justify-start gap-2",
            )}
            onClick={onOpenSettings}
          >
            <Settings className="size-4" aria-hidden />
            <span className={cn(narrow && "sr-only")}>{t('settings.title')}</span>
          </Button>
        </div>
      ) : null}

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
            <DialogTitle>{t("sidebar.deleteSession")}</DialogTitle>
            <DialogDescription>
              {t("sidebar.deleteSessionConfirm", { name: deleteTarget?.displayName ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteSessionBusy}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleteSessionBusy || !deleteTarget || !onDeleteSession}
              onClick={() => {
                const target = deleteTarget;
                if (!target || !onDeleteSession) {
                  return;
                }
                void (async () => {
                  await onDeleteSession(target.path);
                  setDeleteTarget(null);
                })();
              }}
            >
              {deleteSessionBusy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
              {t("common.delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteWorkspaceTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteWorkspaceTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t("sidebar.deleteWorkspace")}</DialogTitle>
            <DialogDescription>
              {t("sidebar.deleteWorkspaceConfirm", {
                name: deleteWorkspaceTarget?.label ?? "",
                count: deleteWorkspaceTarget?.sessions.length ?? 0,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteWorkspaceTarget(null)}
              disabled={deleteWorkspaceBusy}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleteWorkspaceBusy || !deleteWorkspaceTarget || !onDeleteWorkspace}
              onClick={() => {
                const target = deleteWorkspaceTarget;
                if (!target || !onDeleteWorkspace) {
                  return;
                }
                void (async () => {
                  await onDeleteWorkspace(target.rootPath ?? target.id);
                  setDeleteWorkspaceTarget(null);
                })();
              }}
            >
              {deleteWorkspaceBusy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
              {t("common.delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

export const SessionSidebar = memo(SessionSidebarInner);
