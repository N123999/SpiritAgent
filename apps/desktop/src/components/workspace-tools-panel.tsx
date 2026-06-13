import {
  memo,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";

import { FileText, GitBranch, GitPullRequest, Globe, Plus, Terminal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkspaceBrowserTab, type WorkspaceBrowserTabProps } from "@/components/workspace-browser-tab";
import { WorkspaceFilesTab } from "@/components/workspace-files-tab";
import { WorkspaceGitTab } from "@/components/workspace-git-tab";
import { WorkspacePrTab } from "@/components/workspace-pr-tab";
import { WorkspaceShellTab } from "@/components/workspace-shell-tab";
import {
  DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
  DESKTOP_OVERLAY_LIST_ITEM,
  DESKTOP_OVERLAY_LIST_LIST_GAP,
  DESKTOP_OVERLAY_LIST_LIST_PADDING,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import {
  desktopMicaTintClass,
  desktopMicaWorkspaceTabSelectedClass,
} from "@/lib/desktop-mica-surface";
import { maskFadeHorizontalEnd } from "@/lib/mask-styles";
import {
  WORKSPACE_TOOLS_MIN_WIDTH_PX,
  computeWorkspaceToolsMaxWidthPx,
  writeWorkspaceToolsWidthPx,
} from "@/lib/layout-prefs";
import { cn } from "@/lib/utils";
import type {
  EditorFileTarget,
  WorkspaceEditorViewMode,
} from "@/lib/workspace-editor-navigation";
import {
  addWorkspaceToolTab,
  closeWorkspaceToolTab,
  workspaceToolTabLabel,
  type WorkspaceToolTab,
  type WorkspaceToolTabKind,
} from "@/lib/workspace-tool-tabs";
import type {
  DesktopGitSnapshot,
  GetGitHubPullRequestDetailRequest,
  GitHubAuthStatus,
  GitHubPullRequestDetail,
  GitHubPullRequestForBranchResult,
  GitHistorySnapshot,
  GitWorkingTreeSnapshot,
  SubmitGitChipRequest,
  PlanSnapshot,
  ReadGitHistoryRequest,
  WorkspaceExplorerListResult,
  WorkspaceReadTextFileResult,
  WriteHostTextFileRequest,
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
  git: { labelKey: 'workspace.gitTab', icon: GitBranch },
  browser: { labelKey: 'workspace.browser', icon: Globe },
  pr: { labelKey: 'workspace.prTab', icon: GitPullRequest },
};

export type WorkspaceToolsDockProps = {
  /** 已解析的工作区根路径；未就绪时传空字符串 */
  workspaceRoot: string;
  listExplorerChildren: (relativePath: string) => Promise<WorkspaceExplorerListResult>;
  readWorkspaceTextFile: (relativePath: string) => Promise<WorkspaceReadTextFileResult>;
  writeWorkspaceTextFile: (request: WriteWorkspaceTextFileRequest) => Promise<void>;
  readHostTextFile: (absolutePath: string) => Promise<WorkspaceReadTextFileResult>;
  writeHostTextFile: (request: WriteHostTextFileRequest) => Promise<void>;
  readManagedImagePreviewDataUrl?: (reference: string) => Promise<string | null>;
  plan: PlanSnapshot;
  onStartImplementing?: () => void;
  startImplementingDisabled?: boolean;
  autoRevealPlanNonce?: number;
  /** 仅该 files 选项卡响应 Plan 自动展开 */
  planRevealTabId?: string | null;
  autoRevealFileNonce?: number;
  fileRevealTabId?: string | null;
  fileRevealPath?: string;
  fileRevealAbsolutePath?: string;
  fileRevealScope?: EditorFileTarget["scope"];
  fileRevealViewMode?: WorkspaceEditorViewMode;
  prRevealNonce?: number;
  prRevealTabId?: string | null;
  prRevealRequest?: import("@/lib/workspace-pr-navigation").GitHubPullRequestRevealRequest | null;
  onOpenWorkspaceFile?: (relativePath: string, options?: { viewMode?: WorkspaceEditorViewMode }) => void;
  tabs: WorkspaceToolTab[];
  activeTabId: string;
  onTabsChange: Dispatch<SetStateAction<WorkspaceToolTab[]>>;
  onActiveTabIdChange(id: string): void;
  onBrowserElementPicked?: WorkspaceBrowserTabProps['onElementPicked'];
  onPrDiffAddToSession?: (attachment: import("@/lib/pr-diff-attachment").PrDiffAttachment) => void;
  onBrowserOpenInNewTab?: WorkspaceBrowserTabProps['onOpenUrlInNewTab'];
  /** Electron 桌面版可新建/使用浏览器选项卡；Web 宿主菜单项可见但禁用。 */
  browserTabEnabled?: boolean;
  /** Electron 桌面版可新建 PR 选项卡；Web 宿主菜单项可见但禁用。 */
  prTabEnabled?: boolean;
  getGitHubAuthStatus: () => Promise<GitHubAuthStatus>;
  getGitHubPullRequestForCurrentBranch: () => Promise<GitHubPullRequestForBranchResult>;
  getGitHubPullRequestDetail: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<GitHubPullRequestDetail>;
  getGitHubPullRequestConversation: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<import("@/types").GitHubPullRequestConversationSnapshot>;
  getGitHubPullRequestFiles: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<import("@/types").GitHubPullRequestFilesSnapshot>;
  getGitHubPullRequestCommits: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<import("@/types").GitHubPullRequestCommitsSnapshot>;
  getGitHubPullRequestChecks: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<import("@/types").GitHubPullRequestChecksSnapshot>;
  mergeGitHubPullRequest: (
    request: import("@/types").MergeGitHubPullRequestRequest,
  ) => Promise<import("@/types").GitHubPullRequestMergeResult>;
  markGitHubPullRequestReady: (
    request: GetGitHubPullRequestDetailRequest,
  ) => Promise<GitHubPullRequestDetail>;
  /** 右侧面板宽度（像素） */
  widthPx: number;
  minWidthPx?: number;
  maxWidthPx?: number;
  onWidthPxChange(next: number): void;
  open: boolean;
  gitSnapshot?: DesktopGitSnapshot;
  gitChipBusy?: boolean;
  readGitWorkingTree: () => Promise<GitWorkingTreeSnapshot>;
  readGitHistory: (request?: ReadGitHistoryRequest) => Promise<GitHistorySnapshot>;
  submitGitChip: (request: SubmitGitChipRequest) => Promise<boolean>;
  className?: string;
  /** Windows 云母 / macOS Vibrancy：工作区面板使用半透明主题底色。 */
  useMicaBackdrop?: boolean;
};

function WorkspaceToolsDockInner({
  workspaceRoot,
  listExplorerChildren,
  readWorkspaceTextFile,
  writeWorkspaceTextFile,
  readHostTextFile,
  writeHostTextFile,
  readManagedImagePreviewDataUrl,
  plan,
  onStartImplementing,
  startImplementingDisabled = false,
  autoRevealPlanNonce = 0,
  planRevealTabId = null,
  autoRevealFileNonce = 0,
  fileRevealTabId = null,
  fileRevealPath = "",
  fileRevealAbsolutePath = "",
  fileRevealScope = "workspace",
  fileRevealViewMode = "edit",
  prRevealNonce = 0,
  prRevealTabId = null,
  prRevealRequest = null,
  onOpenWorkspaceFile,
  tabs,
  activeTabId,
  onTabsChange,
  onActiveTabIdChange,
  onBrowserElementPicked,
  onPrDiffAddToSession,
  onBrowserOpenInNewTab,
  browserTabEnabled = false,
  prTabEnabled = false,
  getGitHubAuthStatus,
  getGitHubPullRequestForCurrentBranch,
  getGitHubPullRequestDetail,
  getGitHubPullRequestConversation,
  getGitHubPullRequestFiles,
  getGitHubPullRequestCommits,
  getGitHubPullRequestChecks,
  mergeGitHubPullRequest,
  markGitHubPullRequestReady,
  widthPx,
  minWidthPx = WORKSPACE_TOOLS_MIN_WIDTH_PX,
  maxWidthPx: maxWidthPxProp,
  onWidthPxChange,
  open,
  gitSnapshot,
  gitChipBusy = false,
  readGitWorkingTree,
  readGitHistory,
  submitGitChip,
  className,
  useMicaBackdrop = false,
}: WorkspaceToolsDockProps) {
  const { t } = useTranslation();
  const [isResizing, setIsResizing] = useState(false);
  /** 仅用户首次切到 Shell 选项卡后才挂载终端（避免默认标签即触发 node-pty）；切走后保持挂载。 */
  const [mountedShellTabIds, setMountedShellTabIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const latestWidthPxRef = useRef(widthPx);
  latestWidthPxRef.current = widthPx;
  const [viewportMaxWidthPx, setViewportMaxWidthPx] = useState(computeWorkspaceToolsMaxWidthPx);
  const maxWidthPx = maxWidthPxProp ?? viewportMaxWidthPx;

  useEffect(() => {
    if (maxWidthPxProp !== undefined) {
      return;
    }
    const onWindowResize = () => {
      setViewportMaxWidthPx(computeWorkspaceToolsMaxWidthPx());
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [maxWidthPxProp]);

  useEffect(() => {
    if (!open) {
      setIsResizing(false);
    }
  }, [open]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId),
    [activeTabId, tabs],
  );

  useEffect(() => {
    if (activeTab?.kind !== "shell") {
      return;
    }
    setMountedShellTabIds((prev) => {
      if (prev.has(activeTabId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(activeTabId);
      return next;
    });
  }, [activeTab?.kind, activeTabId]);

  const clampWidth = useCallback(
    (value: number) => Math.min(maxWidthPx, Math.max(minWidthPx, value)),
    [minWidthPx, maxWidthPx],
  );

  useEffect(() => {
    if (widthPx <= maxWidthPx) {
      return;
    }
    onWidthPxChange(clampWidth(widthPx));
  }, [clampWidth, maxWidthPx, onWidthPxChange, widthPx]);

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
      const next = clampWidth(drag.startWidth + delta);
      latestWidthPxRef.current = next;
      onWidthPxChange(next);
    },
    [clampWidth, onWidthPxChange],
  );

  const endResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setIsResizing(false);
    if (dragRef.current) {
      writeWorkspaceToolsWidthPx(latestWidthPxRef.current);
    }
    dragRef.current = null;
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
      if (kind === "pr" && !prTabEnabled) {
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
    [browserTabEnabled, prTabEnabled, onActiveTabIdChange, onTabsChange, tabs, t],
  );

  const handleCloseTab = useCallback(
    (closeId: string) => {
      const next = closeWorkspaceToolTab(tabs, activeTabId, closeId, {
        includeBrowser: browserTabEnabled,
      });
      onTabsChange(next.tabs);
      onActiveTabIdChange(next.activeId);
      setMountedShellTabIds((prev) => {
        if (!prev.has(closeId)) {
          return prev;
        }
        const updated = new Set(prev);
        updated.delete(closeId);
        return updated;
      });
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

  const shellWidth = open ? `calc(0.25rem + ${widthPx}px)` : "0px";

  return (
    <div
      id="workspace-tools-panel-shell"
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
        data-workspace-tools-split
        className={cn(
          "relative flex h-full min-h-0 shrink-0 flex-row self-stretch",
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
            desktopMicaTintClass(useMicaBackdrop),
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
          data-spirit-surface="workspace-panel"
          className={cn(
            "flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden text-foreground",
            desktopMicaTintClass(useMicaBackdrop),
          )}
          style={{ width: widthPx }}
          aria-label={t('workspace.workspaceTools')}
        >
          <div className="flex shrink-0 items-end gap-0 border-b border-border/40 pt-1.5 pb-0 pl-1 pr-1">
            <ScrollArea
              scrollbars="horizontal"
              type="hover"
              scrollHideDelay={450}
              className="min-h-0 min-w-0 flex-1 self-stretch"
            >
              <div
                role="tablist"
                aria-label={t('workspace.toolTabs')}
                className="flex items-end gap-0"
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
                        ? cn(
                            "border-border/40 text-foreground shadow-sm",
                            useMicaBackdrop
                              ? cn("border-b-transparent", desktopMicaWorkspaceTabSelectedClass(useMicaBackdrop))
                              : "border-b-background bg-background",
                          )
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
                    {displayTitle ? (
                      <button
                        type="button"
                        className="absolute inset-y-0 right-0 hidden items-center justify-end rounded-tr-md pr-1 outline-none group-hover/tab:flex"
                        style={{
                          ...maskFadeHorizontalEnd,
                          width: "2rem",
                          background: "inherit",
                        }}
                        aria-label={t('workspace.closeTab', { label })}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleCloseTab(item.id);
                        }}
                      >
                        <X className="size-3 opacity-70" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                );
              })}
              </div>
            </ScrollArea>
            <DropdownMenu modal>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('workspace.newToolTab')}
                  title={t('common.new')}
                  className={cn(
                    'mb-1 size-7 shrink-0 rounded-full p-0 text-muted-foreground shadow-none hover:bg-muted/50 hover:text-foreground',
                    'aria-expanded:bg-muted/35 aria-expanded:text-foreground aria-expanded:hover:bg-muted/50',
                    instantHoverMotionClass,
                  )}
                >
                  <Plus className="size-3.5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="top"
                sideOffset={10}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                }}
                className={cn(
                  'flex w-max min-w-[11rem] max-w-[min(15rem,calc(100vw-1.25rem))] flex-col',
                  DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
                  DESKTOP_OVERLAY_LIST_LIST_PADDING,
                  DESKTOP_OVERLAY_LIST_LIST_GAP,
                )}
              >
                {(["files", "shell", "git", "browser", "pr"] as const).map((kind) => {
                  const meta = TAB_KIND_META[kind];
                  const Icon = meta.icon;
                  const browserDisabled = kind === "browser" && !browserTabEnabled;
                  const prDisabled = kind === "pr" && !prTabEnabled;
                  const disabled = browserDisabled || prDisabled;
                  return (
                    <DropdownMenuItem
                      key={kind}
                      disabled={disabled}
                      title={
                        browserDisabled
                          ? t("workspace.browserElectronOnly")
                          : prDisabled
                            ? t("workspace.prElectronOnly")
                            : undefined
                      }
                      className={cn(
                        'flex w-full cursor-pointer select-none items-center gap-2 rounded-sm text-left outline-none',
                        DESKTOP_OVERLAY_LIST_ITEM,
                        'text-popover-foreground',
                      )}
                      onSelect={() => {
                        handleAddTab(kind);
                      }}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{t(meta.labelKey)}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
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
              const fileRevealEnabled =
                item.kind === "files" &&
                fileRevealTabId != null &&
                item.id === fileRevealTabId;
              const prRevealEnabled =
                item.kind === "pr" && prRevealTabId != null && item.id === prRevealTabId;

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
                        readHostTextFile={readHostTextFile}
                        writeHostTextFile={writeHostTextFile}
                        readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
                        onStartImplementing={onStartImplementing}
                        startImplementingDisabled={startImplementingDisabled}
                        autoRevealPlanNonce={planRevealEnabled ? autoRevealPlanNonce : 0}
                        planRevealEnabled={planRevealEnabled}
                        autoRevealFileNonce={fileRevealEnabled ? autoRevealFileNonce : 0}
                        fileRevealEnabled={fileRevealEnabled}
                        fileRevealPath={fileRevealPath}
                        fileRevealAbsolutePath={fileRevealAbsolutePath}
                        fileRevealScope={fileRevealScope}
                        fileRevealViewMode={fileRevealViewMode}
                        onTitleChange={(title) => handleTabTitleChange(item.id, title)}
                      />
                    </div>
                  ) : item.kind === "shell" ? (
                    mountedShellTabIds.has(item.id) ? (
                      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-2">
                        <WorkspaceShellTab
                          workspaceRoot={workspaceRoot}
                          useMicaBackdrop={useMicaBackdrop}
                          onTitleChange={(title) => handleTabTitleChange(item.id, title)}
                          suspendTerminalResize={isResizing}
                        />
                      </div>
                    ) : null
                  ) : item.kind === "browser" ? (
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                      <WorkspaceBrowserTab
                        browserTabId={item.id}
                        browserUrl={item.browserUrl}
                        browserTabEnabled={browserTabEnabled}
                        isActive={selected}
                        useMicaBackdrop={useMicaBackdrop}
                        onBrowserUrlChange={(url) => handleBrowserUrlChange(item.id, url)}
                        onOpenUrlInNewTab={onBrowserOpenInNewTab}
                        onTitleChange={(title) => handleTabTitleChange(item.id, title)}
                        onElementPicked={onBrowserElementPicked}
                      />
                    </div>
                  ) : item.kind === "pr" ? (
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                      <WorkspacePrTab
                        gitSnapshot={gitSnapshot}
                        isActive={selected}
                        prTabEnabled={prTabEnabled}
                        getGitHubAuthStatus={getGitHubAuthStatus}
                        getGitHubPullRequestForCurrentBranch={getGitHubPullRequestForCurrentBranch}
                        getGitHubPullRequestDetail={getGitHubPullRequestDetail}
                        getGitHubPullRequestConversation={getGitHubPullRequestConversation}
                        getGitHubPullRequestFiles={getGitHubPullRequestFiles}
                        getGitHubPullRequestCommits={getGitHubPullRequestCommits}
                        getGitHubPullRequestChecks={getGitHubPullRequestChecks}
                        mergeGitHubPullRequest={mergeGitHubPullRequest}
                        markGitHubPullRequestReady={markGitHubPullRequestReady}
                        prRevealEnabled={prRevealEnabled}
                        prRevealNonce={prRevealEnabled ? prRevealNonce : 0}
                        prRevealRequest={prRevealEnabled ? prRevealRequest : null}
                        onPrDiffAddToSession={onPrDiffAddToSession}
                      />
                    </div>
                  ) : (
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-2">
                      <WorkspaceGitTab
                        gitSnapshot={gitSnapshot}
                        isActive={selected}
                        gitChipBusy={gitChipBusy}
                        readGitWorkingTree={readGitWorkingTree}
                        readGitHistory={readGitHistory}
                        submitGitChip={submitGitChip}
                        onOpenChangedFile={onOpenWorkspaceFile}
                      />
                    </div>
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

export const WorkspaceToolsDock = memo(WorkspaceToolsDockInner);
