import { useCallback, useMemo, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";

import { FileText, GitBranch, Globe, Plus, Terminal, X } from "lucide-react";
import { ActionPopover, type ActionPopoverItem } from "@/components/ui/action-popover";
import { WorkspaceBrowserTab, type WorkspaceBrowserTabProps } from "@/components/workspace-browser-tab";
import { WorkspaceFilesTab } from "@/components/workspace-files-tab";
import { WorkspaceShellTab } from "@/components/workspace-shell-tab";
import { instantHoverMotionClass } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";
import {
  addWorkspaceToolTab,
  closeWorkspaceToolTab,
  workspaceToolTabLabel,
  type WorkspaceToolTab,
  type WorkspaceToolTabKind,
} from "@/lib/workspace-tool-tabs";
import type {
  PlanSnapshot,
  WorkspaceExplorerListResult,
  WorkspaceReadTextFileResult,
  WriteWorkspaceTextFileRequest,
} from "@/types";

/** @deprecated Use WorkspaceToolTabKind */
export type WorkspaceToolsTab = WorkspaceToolTabKind;

export type { WorkspaceToolTab, WorkspaceToolTabKind };

const TAB_KIND_META: Record<
  WorkspaceToolTabKind,
  { labelKey: string; icon: typeof FileText }
> = {
  files: { labelKey: 'workspace.files', icon: FileText },
  shell: { labelKey: 'workspace.shell', icon: Terminal },
  git: { labelKey: 'workspace.git', icon: GitBranch },
  browser: { labelKey: 'workspace.browser', icon: Globe },
};

export type WorkspaceToolsDockProps = {
  /** 已解析的工作区根路径；未就绪时传空字符串 */
  workspaceRoot: string;
  listExplorerChildren: (relativePath: string) => Promise<WorkspaceExplorerListResult>;
  readWorkspaceTextFile: (relativePath: string) => Promise<WorkspaceReadTextFileResult>;
  writeWorkspaceTextFile: (request: WriteWorkspaceTextFileRequest) => Promise<void>;
  readManagedImagePreviewDataUrl?: (reference: string) => Promise<string | null>;
  plan: PlanSnapshot;
  onStartImplementing?: () => void;
  startImplementingDisabled?: boolean;
  autoRevealPlanNonce?: number;
  /** 仅该 files 选项卡响应 Plan 自动展开 */
  planRevealTabId?: string | null;
  tabs: WorkspaceToolTab[];
  activeTabId: string;
  onTabsChange: Dispatch<SetStateAction<WorkspaceToolTab[]>>;
  onActiveTabIdChange(id: string): void;
  onBrowserElementPicked?: WorkspaceBrowserTabProps['onElementPicked'];
  onBrowserOpenInNewTab?: WorkspaceBrowserTabProps['onOpenUrlInNewTab'];
  /** Electron 桌面版可新建/使用浏览器选项卡；Web 宿主菜单项可见但禁用。 */
  browserTabEnabled?: boolean;
  /** 右侧面板宽度（像素） */
  widthPx: number;
  minWidthPx?: number;
  maxWidthPx?: number;
  onWidthPxChange(next: number): void;
  open: boolean;
  className?: string;
};

const DEFAULT_MIN = 240;
/** 含文件树 + Monaco 时需更宽；与左侧栏同开时过大会挤压中间输入区，900 为经验上限。 */
const DEFAULT_MAX = 900;

function WorkspaceGitTabPlaceholder() {
  const { t } = useTranslation();
  return (
    <div className="p-3 text-muted-foreground">
      <p>{t('workspace.gitPlaceholder')}</p>
    </div>
  );
}

export function WorkspaceToolsDock({
  workspaceRoot,
  listExplorerChildren,
  readWorkspaceTextFile,
  writeWorkspaceTextFile,
  readManagedImagePreviewDataUrl,
  plan,
  onStartImplementing,
  startImplementingDisabled = false,
  autoRevealPlanNonce = 0,
  planRevealTabId = null,
  tabs,
  activeTabId,
  onTabsChange,
  onActiveTabIdChange,
  onBrowserElementPicked,
  onBrowserOpenInNewTab,
  browserTabEnabled = false,
  widthPx,
  minWidthPx = DEFAULT_MIN,
  maxWidthPx = DEFAULT_MAX,
  onWidthPxChange,
  open,
  className,
}: WorkspaceToolsDockProps) {
  const { t } = useTranslation();
  const [isResizing, setIsResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setIsResizing(false);
    }
  }, [open]);

  const clampWidth = useCallback(
    (value: number) => Math.min(maxWidthPx, Math.max(minWidthPx, value)),
    [minWidthPx, maxWidthPx],
  );

  const onResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsResizing(true);
      dragRef.current = { startX: event.clientX, startWidth: widthPx };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [widthPx],
  );

  const onResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const delta = drag.startX - event.clientX;
      onWidthPxChange(clampWidth(drag.startWidth + delta));
    },
    [clampWidth, onWidthPxChange],
  );

  const endResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setIsResizing(false);
    if (dragRef.current) {
      dragRef.current = null;
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // 已释放或无 capture
    }
  }, []);

  const handleAddTab = useCallback(
    (kind: WorkspaceToolTabKind) => {
      if (kind === "browser" && !browserTabEnabled) {
        return;
      }
      const vacant = tabs.find((tab) => tab.kind === kind && !tab.tabTitle);
      if (vacant) {
        onActiveTabIdChange(vacant.id);
        return;
      }
      const meta = TAB_KIND_META[kind];
      const defaultTitle = t(meta.labelKey);
      const next = addWorkspaceToolTab(tabs, kind, defaultTitle);
      onTabsChange(next.tabs);
      onActiveTabIdChange(next.activeId);
    },
    [browserTabEnabled, onActiveTabIdChange, onTabsChange, tabs, t],
  );

  const handleCloseTab = useCallback(
    (closeId: string) => {
      const next = closeWorkspaceToolTab(tabs, activeTabId, closeId, {
        includeBrowser: browserTabEnabled,
      });
      onTabsChange(next.tabs);
      onActiveTabIdChange(next.activeId);
    },
    [activeTabId, browserTabEnabled, onActiveTabIdChange, onTabsChange, tabs],
  );

  const handleBrowserUrlChange = useCallback(
    (tabId: string, url: string) => {
      onTabsChange((prev) =>
        prev.map((item) => (item.id === tabId ? { ...item, browserUrl: url } : item)),
      );
    },
    [onTabsChange],
  );

  const handleTabTitleChange = useCallback(
    (tabId: string, title: string | undefined) => {
      onTabsChange((prev) =>
        prev.map((item) => (item.id === tabId ? { ...item, tabTitle: title || undefined } : item)),
      );
    },
    [onTabsChange],
  );

  const newTabItems = useMemo<readonly ActionPopoverItem[]>(
    () =>
      (["files", "shell", "git", "browser"] as const).map((kind) => {
        const meta = TAB_KIND_META[kind];
        const Icon = meta.icon;
        const browserDisabled = kind === "browser" && !browserTabEnabled;
        return {
          id: `new-${kind}`,
          icon: <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />,
          label: t(meta.labelKey),
          disabled: browserDisabled,
          title: browserDisabled ? t("workspace.browserElectronOnly") : undefined,
          onSelect: () => handleAddTab(kind),
        };
      }),
    [browserTabEnabled, handleAddTab, t],
  );

  const shellWidth = open ? `calc(0.25rem + ${widthPx}px)` : "0px";

  return (
    <div
      className={cn(
        "flex h-full min-h-0 shrink-0 flex-row self-stretch overflow-hidden",
        isResizing
          ? "transition-none"
          : "transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none motion-reduce:duration-0",
        className,
      )}
      style={{ width: shellWidth }}
    >
      <div
        className={cn(
          "flex h-full min-h-0 shrink-0 flex-row self-stretch",
          !open && "pointer-events-none select-none",
        )}
        style={{ width: `calc(0.25rem + ${widthPx}px)` }}
        aria-hidden={!open}
        inert={!open}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('workspace.resizeToolsWidth')}
          className={cn(
            "group relative z-10 w-1 shrink-0 cursor-col-resize touch-none select-none",
            "before:absolute before:inset-y-0 before:-left-1 before:w-3 before:content-['']",
          )}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        >
          <div
            className="pointer-events-none absolute inset-y-0 left-0 w-px bg-border/40 transition-colors group-hover:bg-border/55"
            aria-hidden
          />
        </div>

        <aside
          id="workspace-tools-panel"
          className="flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden bg-background text-foreground"
          style={{ width: widthPx }}
          aria-label={t('workspace.workspaceTools')}
        >
          <div className="flex shrink-0 items-end gap-0 border-b border-border/40 pt-1.5 pb-0 pl-1 pr-1">
            <div
              role="tablist"
              aria-label={t('workspace.toolTabs')}
              className="flex min-w-0 flex-1 items-end gap-0 overflow-x-auto overscroll-x-contain"
            >
              {tabs.map((item) => {
                const meta = TAB_KIND_META[item.kind];
                const Icon = meta.icon;
                const selected = item.id === activeTabId;
                const label = workspaceToolTabLabel(item.kind, tabs, item.id, t);
                const displayTitle = item.tabTitle;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "group/tab relative flex shrink-0 items-stretch rounded-t-md border border-transparent",
                      displayTitle ? "max-w-[9rem]" : "max-w-[3rem]",
                      selected
                        ? "border-border/40 border-b-background bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <button
                      type="button"
                      role="tab"
                      id={`workspace-tool-tab-${item.id}`}
                      aria-selected={selected}
                      aria-controls={`workspace-tool-panel-${item.id}`}
                      tabIndex={selected ? 0 : -1}
                      title={displayTitle ?? label}
                      className="flex min-w-0 flex-1 items-center gap-1 rounded-t-md bg-transparent py-2 pl-2 pr-2 text-xs font-medium outline-none"
                      onClick={() => onActiveTabIdChange(item.id)}
                    >
                      <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
                      {displayTitle ? <span className="truncate">{displayTitle}</span> : null}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "absolute inset-y-0 right-0 hidden items-center justify-end rounded-tr-md pr-1 outline-none group-hover/tab:flex",
                        !displayTitle && "flex",
                      )}
                      style={
                        displayTitle
                          ? {
                              maskImage: "linear-gradient(to right, transparent, black 50%)",
                              WebkitMaskImage: "linear-gradient(to right, transparent, black 50%)",
                              width: "2rem",
                              background: "inherit",
                            }
                          : undefined
                      }
                      aria-label={t('workspace.closeTab', { label })}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleCloseTab(item.id);
                      }}
                    >
                      <X className="size-3 opacity-70" aria-hidden />
                    </button>
                  </div>
                );
              })}
            </div>
            <ActionPopover
              ariaLabel={t('workspace.newToolTab')}
              title={t('common.new')}
              triggerIcon={<Plus className="size-3.5" aria-hidden />}
              items={newTabItems}
              triggerClassName="mb-1"
              contentClassName="text-xs"
            />
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden text-xs" aria-live="polite">
            {tabs.map((item) => {
              const selected = item.id === activeTabId;
              const panelPadding =
                item.kind === "files" || item.kind === "shell" ? "p-0" : "p-0";
              const planRevealEnabled =
                item.kind === "files" &&
                planRevealTabId != null &&
                item.id === planRevealTabId;

              return (
                <div
                  key={item.id}
                  id={`workspace-tool-panel-${item.id}`}
                  role="tabpanel"
                  aria-labelledby={`workspace-tool-tab-${item.id}`}
                  hidden={!selected}
                  inert={!selected}
                  aria-hidden={!selected}
                  className={cn(
                    "absolute inset-0 flex min-h-0 flex-col overflow-hidden",
                    panelPadding,
                    !selected && "invisible",
                  )}
                >
                  {item.kind === "files" ? (
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-2">
                      <WorkspaceFilesTab
                        workspaceRoot={workspaceRoot}
                        plan={plan}
                        listExplorerChildren={listExplorerChildren}
                        readWorkspaceTextFile={readWorkspaceTextFile}
                        writeWorkspaceTextFile={writeWorkspaceTextFile}
                        readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
                        onStartImplementing={onStartImplementing}
                        startImplementingDisabled={startImplementingDisabled}
                        autoRevealPlanNonce={planRevealEnabled ? autoRevealPlanNonce : 0}
                        planRevealEnabled={planRevealEnabled}
                        onTitleChange={(title) => handleTabTitleChange(item.id, title)}
                      />
                    </div>
                  ) : item.kind === "shell" ? (
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-2">
                      <WorkspaceShellTab
                        workspaceRoot={workspaceRoot}
                        onTitleChange={(title) => handleTabTitleChange(item.id, title)}
                      />
                    </div>
                  ) : item.kind === "browser" ? (
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                      <WorkspaceBrowserTab
                        browserUrl={item.browserUrl}
                        browserTabEnabled={browserTabEnabled}
                        onBrowserUrlChange={(url) => handleBrowserUrlChange(item.id, url)}
                        onOpenUrlInNewTab={onBrowserOpenInNewTab}
                        onTitleChange={(title) => handleTabTitleChange(item.id, title)}
                        onElementPicked={onBrowserElementPicked}
                      />
                    </div>
                  ) : (
                    <WorkspaceGitTabPlaceholder />
                  )}
                </div>
              );
            })}
            {tabs.length === 0 ? (
              <p className="p-3 text-muted-foreground">{t('workspace.noOpenTabs')}</p>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
