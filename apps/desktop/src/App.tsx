import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { modelReasoningEffortLabel } from "@spirit-agent/core/reasoning-effort";
import {
  charCountToCodeUnitIndex,
  codeUnitIndexToCharCount,
  currentWorkspaceFileReferenceQuery,
} from "@spirit-agent/host-internal/workspace-file-reference-query";

import {
  SessionSidebarChromeProvider,
  type SessionSidebarChromeApi,
  useSessionSidebarChrome,
} from "@/contexts/session-sidebar-chrome-context";
import { type DesktopAgentMode } from "@/lib/agent-mode";
import {
  resolveComposerDirectMediaTool,
  type DirectMediaTool,
} from "@/lib/composer-direct-media";
import {
  pickEmptySessionGreetingVariant,
  resolveEmptySessionGreeting,
  type EmptySessionGreetingVariantId,
} from "@/lib/empty-session-greeting";
import {
  resolveWorkspaceDisplayLabel,
  resolveWorkspaceSelectorLabel,
  sameWorkspacePath,
} from "@/lib/workspace-display-label";

import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  Download,
  FolderPlus,
  LoaderCircle,
  Maximize2,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HoverDetailTooltip,
  useHoverDetailTooltipContext,
} from "@/components/ui/hover-detail-tooltip";
import { ModelPickerInspectorPanel } from "@/components/model-picker-inspector-panel";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { AgentMarkdownMessage } from "@/components/agent-markdown-message";
import { MarketplaceView } from "@/components/marketplace-view";
import {
  ComposerLocalFileStrip,
  type ComposerLocalFileAttachmentView,
} from "@/components/composer-local-file-strip";
import {
  ComposerRichInput,
  segmentsToMessageText,
  type ComposerRichInputHandle,
  type RichSegment,
} from "@/components/composer-rich-input";
import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import {
  messageContentToRichSegments,
  segmentsToAttachments,
  segmentsToPlainText,
} from "@/lib/composer-segment-model";
import { ComposerInsertMenu } from "@/components/composer-insert-menu";
import { ApprovalLevelMenu } from "@/components/approval-level-menu";
import { ComposerContextUsageRing } from "@/components/composer-context-usage-ring";
import { BranchSelectMenu } from "@/components/branch-select-menu";
import { WorkLocationMenu } from "@/components/work-location-menu";
import { SkillSlashMenu } from "@/components/skill-slash-menu";
import { SettingsView } from "@/components/settings-view";
import { ComposerTodoCard } from "@/components/composer-todo-card";
import { MinimalToolCallCard } from "@/components/minimal-tool-call-card";
import { PendingApprovalCard } from "@/components/pending-approval-card";
import { SessionChromeBreadcrumb } from "@/components/session-chrome-breadcrumb";
import { ToolCallDiffHostProvider } from "@/components/tool-call-diff-host-context";
import { isMinimalToolCallMessage, toolHasExpandableContent } from "@/lib/tool-call-display";
import {
  isGenericPendingThinkingStatusText,
  isSubagentStatusSurfaceMessage,
} from "@/lib/subagent-display";
import {
  assistantCompactionLive,
  shouldShowAssistantCompactionCollapsible,
} from "@/lib/conversation-compaction-ui";
import { resolveTurnContinuePresentation } from "@/lib/conversation-continue-ui";
import {
  hasAssistantBodyTextLaterInTurn,
  isAssistantReasoningLive,
  shouldCollapseThinkingDuringToolPreview,
  shouldShowAssistantThinkingCollapsible,
} from "@/lib/conversation-thinking-ui";
import { isGenericPendingCompactionStatusText } from "@/lib/subagent-display";
import {
  isGrayMetaLeadingMessage,
  isGrayMetaTrailingMessage,
  isStandaloneAssistantAuxMessage,
  shouldCompactAfterPreviousMessage,
  shouldTightenAfterPreviousMetaMessage,
} from "@/lib/message-card-spacing";
import { WorkspaceFileReferenceMenu } from "@/components/workspace-file-reference-menu";
import { ActionPickerDialog } from "@/components/action-picker-dialog";
import { WorkspaceFilePickerDialog } from "@/components/workspace-file-picker-dialog";
import { UserMessageBubble } from "@/components/user-message-bubble";
import { useCompactionUiDemo } from "@/hooks/useCompactionUiDemo";
import { useElementBoxHeight } from "@/hooks/use-element-box-height";
import { useSubagentViewer } from "@/hooks/useSubagentViewer";
import { isRunSubagentToolCallPending } from "@/lib/subagent-viewer-pending";
import { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import { useWorkspaceFileIndex } from "@/hooks/use-workspace-file-index";
import { useLocalFileAttachmentPreviews } from "@/hooks/useLocalFileAttachmentPreviews";
import { useFont } from "@/hooks/useFont";
import { useTheme } from "@/hooks/useTheme";
import { isManagedGeneratedVideoRef } from "@/lib/managed-generated-asset";
import {
  appendComposerLocalFileAttachment,
  composerAttachmentViewFromPath,
  isPreviewableImagePath,
  isPreviewableVideoPath,
  normalizeSlashPath as normalizeAttachmentPath,
  removeComposerLocalFileAttachment,
  snapshotsToComposerAttachmentViews,
} from "@/lib/local-file-attachments";
import {
  FilteredOverlayMenu,
  FilteredOverlayMenuTrigger,
} from "@/components/ui/filtered-overlay-menu";
import {
  DESKTOP_CHROME_TOGGLE_ICON_BTN,
  DESKTOP_SHELL_LAYOUT_TRANSITION,
  DESKTOP_OVERLAY_LIST_ACTION_ITEM,
  DESKTOP_OVERLAY_LIST_GROUP_LABEL,
  DESKTOP_OVERLAY_LIST_ITEM,
  DESKTOP_OVERLAY_LIST_ITEM_PRIMARY,
  DESKTOP_OVERLAY_LIST_ITEM_SECONDARY,
  DESKTOP_OVERLAY_LIST_SUB_TRIGGER,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import { readWorkspaceToolsWidthPx } from "@/lib/layout-prefs";
import {
  buildModelCatalogDetailMap,
  buildModelCatalogDisplayTitleMap,
  modelDisplayTitleFromMap,
} from "@/lib/model-catalog-detail";
import { groupModelsForPicker } from "@/lib/model-picker-groups";
import {
  isNewSessionAction,
  type ActionPaletteItem,
} from "@/lib/action-palette";
import {
  buildSkillSlashSuggestions,
  CREATE_RULE_SLASH_ALIAS,
  CREATE_SKILL_SLASH_ALIAS,
  currentSkillSlashQuery,
  type SkillSlashSuggestion,
} from "@/lib/skill-slash";
import {
  desktopNativeThemeForPreference,
  resolveDark,
  syncDesktopWindowFrame,
  type ThemePreference,
} from "@/lib/theme";
import { cn } from "@/lib/utils";
import { DesktopTitleBar } from "@/components/desktop-title-bar";
import { LaunchSplash } from "@/components/launch-splash";
import { SessionSidebar, type SettingsSidebarTab } from "@/components/session-sidebar";
import { SessionSidebarShell } from "@/components/session-sidebar-shell";
import { WorkspaceToolsDock } from "@/components/workspace-tools-panel";
import {
  addWorkspaceBrowserTabWithUrl,
  addWorkspaceToolTab,
  createInitialWorkspaceToolsState,
  normalizeWorkspaceToolTabsForHost,
  findWorkspaceToolTab,
  focusFirstTabOfKind,
} from "@/lib/workspace-tool-tabs";
import { normalizeBrowserUrl } from "@/lib/browser-url";
import {
  buildOpenEditorFileNavigation,
  type EditorFileTarget,
  type WorkspaceEditorViewMode,
} from "@/lib/workspace-editor-navigation";
import { isMarkdownPath } from "@/lib/file-picker-path";
import type {
  AskQuestionsQuestionSpec,
  DesktopModelReasoningEffort,
  ConversationMessageSnapshot,
  DesktopSnapshot,
  MessageRewindDraftState,
  PendingAssistantAux,
  ToolBlockSnapshot,
  WorkspaceFileReferenceSuggestionsResponse,
} from "@/types";

import {
  conversationMessageStableId,
  resolveConversationListScopeKey,
} from "@/lib/conversation-list-scope";

/** 主会话列最大宽度（居中） */
const CONVERSATION_MAX_W = "max-w-[min(86vw,44rem)]";
/** 消息列表、输入区与顶栏横幅共用的水平内边距（侧栏拉宽后列变窄时避免贴窗缘） */
const CONVERSATION_GUTTER_X = "px-4 sm:px-5";
const CONVERSATION_GUTTER_NEG_X = "-mx-4 sm:-mx-5";
/** composer-dock 未量到高度前的滚动床 fallback（原 12rem） */
const CONVERSATION_COMPOSER_SCROLL_BED_FALLBACK_PX = 192;
/** 末条消息与 composer 叠层之间可继续下滚的额外留白 */
const CONVERSATION_SCROLL_BED_EXTRA_PX = 48;

function formatModelPickerLabel(name: string, reasoningEffort: DesktopModelReasoningEffort): string {
  return `${name} · ${modelReasoningEffortLabel(reasoningEffort)}`;
}

type ModelPickerItem = DesktopSnapshot["config"]["models"][number];

function ModelPickerRow({
  model,
  displayTitle,
  isActive,
  onSelectModel,
}: {
  model: ModelPickerItem;
  displayTitle: string;
  isActive: boolean;
  onSelectModel: () => void;
}) {
  const { getTriggerProps } = useHoverDetailTooltipContext<ModelPickerItem>();
  const { onPointerEnter, isHighlighted } = getTriggerProps(model);

  return (
    <HoverDetailTooltip.Anchor itemId={model.name}>
      <div
        role="menuitem"
        tabIndex={-1}
        className={cn(
          DESKTOP_OVERLAY_LIST_SUB_TRIGGER,
          "cursor-pointer outline-none focus:bg-accent focus:text-accent-foreground",
          (isActive || isHighlighted) && "bg-accent/40",
        )}
        onPointerEnter={onPointerEnter}
        onClick={onSelectModel}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectModel();
          }
        }}
      >
        <span className={cn(DESKTOP_OVERLAY_LIST_ITEM_PRIMARY, "min-w-0 truncate")}>
          {displayTitle}
        </span>
      </div>
    </HoverDetailTooltip.Anchor>
  );
}

function normalizeSlashPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "");
}

type EmptyStateWorkspaceSelectorProps = {
  currentWorkspaceRoot: string;
  workspaceBinding: DesktopSnapshot["workspaceBinding"];
  availableWorkspaces: DesktopSnapshot["availableWorkspaces"];
  disabled?: boolean;
  onSelectWorkspace(workspaceRoot: string): void;
  onSelectNoWorkspace(): void;
  onAddWorkspace(): void;
};

function EmptyStateWorkspaceSelector({
  currentWorkspaceRoot,
  workspaceBinding,
  availableWorkspaces,
  disabled,
  onSelectWorkspace,
  onSelectNoWorkspace,
  onAddWorkspace,
}: EmptyStateWorkspaceSelectorProps) {
  const { t } = useTranslation();
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const filteredWorkspaces = useMemo(() => {
    const query = workspaceFilter.trim().toLowerCase();
    if (!query) {
      return availableWorkspaces;
    }
    return availableWorkspaces.filter((workspace) =>
      workspace.label.toLowerCase().includes(query) || workspace.path.toLowerCase().includes(query),
    );
  }, [availableWorkspaces, workspaceFilter]);
  const currentWorkspaceLabel = useMemo(
    () =>
      resolveWorkspaceSelectorLabel(
        currentWorkspaceRoot,
        workspaceBinding,
        availableWorkspaces,
        t,
      ),
    [availableWorkspaces, currentWorkspaceRoot, t, workspaceBinding],
  );

  return (
    <div className="flex justify-start px-0.5">
      <FilteredOverlayMenu
        variant="workspace-panel"
        filterValue={workspaceFilter}
        onFilterChange={setWorkspaceFilter}
        filterPlaceholder={t('app.searchWorkspace')}
        onOpenChange={(open) => {
          if (!open) {
            setWorkspaceFilter("");
          }
        }}
        trigger={
          <FilteredOverlayMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={t('app.selectWorkspace')}
              className={cn(
                "inline-flex h-8 max-w-[min(24rem,100%)] min-w-0 items-center gap-1 rounded-md border-0 bg-transparent pr-0.5 pl-1 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                instantHoverMotionClass,
              )}
            >
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={currentWorkspaceRoot}>
                {currentWorkspaceLabel}
              </span>
              <ChevronDown className="size-3 shrink-0 text-muted-foreground/80" aria-hidden />
            </button>
          </FilteredOverlayMenuTrigger>
        }
        footer={
          <>
            <DropdownMenuItem onSelect={onAddWorkspace} className={cn("gap-1.5", DESKTOP_OVERLAY_LIST_ACTION_ITEM)}>
              <FolderPlus className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span>{t('app.addWorkspace')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onSelectNoWorkspace}
              className={cn(
                "gap-1.5",
                DESKTOP_OVERLAY_LIST_ACTION_ITEM,
                workspaceBinding === "none" && "bg-accent/40",
              )}
            >
              <MessageSquareText className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span>{t('app.noWorkspace')}</span>
            </DropdownMenuItem>
          </>
        }
      >
        {filteredWorkspaces.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t('app.noMatches')}</p>
        ) : (
          filteredWorkspaces.map((workspace) => {
            const selected =
              workspaceBinding === "project"
              && sameWorkspacePath(workspace.path, currentWorkspaceRoot);
            return (
              <DropdownMenuItem
                key={workspace.path}
                onSelect={() => onSelectWorkspace(workspace.path)}
                className={cn("items-start", DESKTOP_OVERLAY_LIST_ITEM, selected && "bg-accent/40")}
              >
                <div className="min-w-0 flex-1">
                  <div className={DESKTOP_OVERLAY_LIST_ITEM_PRIMARY} title={workspace.label}>
                    {workspace.label}
                  </div>
                  <div className={DESKTOP_OVERLAY_LIST_ITEM_SECONDARY} title={workspace.path}>
                    {workspace.path}
                  </div>
                </div>
              </DropdownMenuItem>
            );
          })
        )}
      </FilteredOverlayMenu>
    </div>
  );
}

type ReadLocalImagePreview = (filePath: string) => Promise<string | null>;
type ReadManagedImagePreview = (reference: string) => Promise<string | null>;
type ReadLocalVideoPreview = (filePath: string) => Promise<string | null>;
type ReadManagedVideoPreview = (reference: string) => Promise<string | null>;
type SaveLocalImageAs = (filePath: string) => Promise<boolean>;

function ToolCallCollapsible({
  tool,
  readLocalImagePreviewDataUrl,
  readLocalVideoPreviewUrl,
  readManagedVideoPreviewUrl,
  saveLocalImageAs,
  onOpenSubagentViewer,
}: {
  tool: ToolBlockSnapshot;
  readLocalImagePreviewDataUrl: ReadLocalImagePreview;
  readLocalVideoPreviewUrl: ReadLocalVideoPreview;
  readManagedVideoPreviewUrl: ReadManagedVideoPreview;
  saveLocalImageAs: SaveLocalImageAs;
  onOpenSubagentViewer?: (toolCallId: string) => void;
}) {
  if (tool.toolName === "finish_task") {
    return null;
  }

  if (tool.toolName === "generate_image") {
    return (
      <ImageGenerationToolCard
        tool={tool}
        readLocalImagePreviewDataUrl={readLocalImagePreviewDataUrl}
        saveLocalImageAs={saveLocalImageAs}
      />
    );
  }

  if (tool.toolName === "generate_video") {
    return (
      <VideoGenerationToolCard
        tool={tool}
        readLocalVideoPreviewUrl={readLocalVideoPreviewUrl}
        readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
      />
    );
  }

  return (
    <MinimalToolCallCard tool={tool} onOpenSubagentViewer={onOpenSubagentViewer} />
  );
}

function ImageGenerationToolCard({
  tool,
  readLocalImagePreviewDataUrl,
  saveLocalImageAs,
}: {
  tool: ToolBlockSnapshot;
  readLocalImagePreviewDataUrl: ReadLocalImagePreview;
  saveLocalImageAs: SaveLocalImageAs;
}) {
  const { t } = useTranslation();
  const previewableImagePath = tool.imagePaths?.find(isPreviewableImagePath) ?? "";
  const imagePath = tool.imagePaths?.find((path) => path.trim().length > 0) ?? "";
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [previewAspectRatio, setPreviewAspectRatio] = useState<number | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreviewDataUrl(null);
    if (!previewableImagePath) {
      setPreviewState("unavailable");
      return () => {
        cancelled = true;
      };
    }

    setPreviewState("loading");
    void readLocalImagePreviewDataUrl(previewableImagePath)
      .then((dataUrl) => {
        if (cancelled) {
          return;
        }
        setPreviewDataUrl(dataUrl);
        setPreviewState(dataUrl ? "ready" : "unavailable");
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewState("unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [previewableImagePath, readLocalImagePreviewDataUrl]);

  useEffect(() => {
    let cancelled = false;
    setPreviewAspectRatio(null);
    if (!previewDataUrl) {
      return () => {
        cancelled = true;
      };
    }

    const image = new Image();
    image.onload = () => {
      if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setPreviewAspectRatio(image.naturalWidth / image.naturalHeight);
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setPreviewAspectRatio(null);
      }
    };
    image.src = previewDataUrl;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [previewDataUrl]);

  const loading = tool.phase === "preview" || tool.phase === "running" || previewState === "loading";
  const canInteract = Boolean(previewDataUrl && previewableImagePath);
  // backdrop-filter 在祖先 opacity 动画期间无法正确合成；卡片 hover 渐显须与 blur 写在同一元素上。
  const floatingActionButtonClass =
    "size-8 rounded-full border border-border/50 bg-background/55 text-foreground shadow-sm backdrop-blur-xl transition-[opacity,background-color,border-color,box-shadow] duration-200 ease-out hover:border-border/60 hover:bg-background/72 dark:border-white/12 dark:bg-input/30 dark:hover:bg-input/40 supports-[backdrop-filter]:bg-background/40 dark:supports-[backdrop-filter]:bg-input/25";
  const floatingActionCardRevealClass =
    "opacity-0 group-hover/image-card:opacity-100 group-focus-within/image-card:opacity-100";
  const viewerFrameStyle = previewAspectRatio
    ? {
        aspectRatio: String(previewAspectRatio),
        width: `min(calc(100dvw - 5rem), calc((100dvh - 6rem) * ${previewAspectRatio}), 70rem)`,
      }
    : undefined;

  const handleSaveImage = async () => {
    if (!imagePath || saving) {
      return;
    }

    setSaving(true);
    try {
      await saveLocalImageAs(imagePath);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-[min(28rem,100%)] py-1">
      <div
        className={cn(
          "group/image-card relative aspect-square overflow-hidden rounded-md border border-border/45 bg-muted/20 transition-colors duration-200",
          canInteract && "cursor-zoom-in hover:border-border/70",
          tool.phase === "failed" && "border-destructive/45 bg-destructive/5",
        )}
        role={canInteract ? "button" : undefined}
        tabIndex={canInteract ? 0 : undefined}
        onClick={canInteract ? () => setViewerOpen(true) : undefined}
        onKeyDown={
          canInteract
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setViewerOpen(true);
                }
              }
            : undefined
        }
      >
        {previewDataUrl ? (
          <img
            src={previewDataUrl}
            alt=""
            className="size-full object-cover transition-transform duration-300 group-hover/image-card:scale-[1.015]"
            draggable={false}
          />
        ) : (
          <div className="flex size-full items-center justify-center px-4 text-center">
            <span
              className={cn(
                "text-sm font-medium",
                loading ? "spirit-thinking-shimmer-text" : "text-muted-foreground",
              )}
            >
              {loading ? t('common.loading') : t('app.previewUnavailable')}
            </span>
          </div>
        )}
        {previewDataUrl ? (
          <div className="pointer-events-none absolute inset-0 z-10">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn(
                "pointer-events-auto absolute bottom-3 left-3",
                floatingActionButtonClass,
                floatingActionCardRevealClass,
              )}
              onClick={(event) => {
                event.stopPropagation();
                void handleSaveImage();
              }}
              disabled={saving}
              title={t('app.downloadImage')}
              aria-label={t('app.downloadImage')}
            >
              {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn(
                "pointer-events-auto absolute right-3 bottom-3",
                floatingActionButtonClass,
                floatingActionCardRevealClass,
              )}
              onClick={(event) => {
                event.stopPropagation();
                setViewerOpen(true);
              }}
              title={t('app.viewLargeImage')}
              aria-label={t('app.viewLargeImage')}
            >
              <Maximize2 className="size-4" aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>
      {!previewDataUrl && imagePath ? (
        <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground" title={imagePath}>
          {imagePath}
        </p>
      ) : null}
      {tool.phase === "failed" && tool.outputExcerpt ? (
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-destructive/20 bg-destructive/5 p-2 font-mono text-xs leading-relaxed text-destructive">
          {tool.outputExcerpt}
        </pre>
      ) : null}

      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent
          showCloseButton={false}
          overlayClassName="bg-background/40 backdrop-blur-md"
          className="w-auto max-w-none gap-0 border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-none"
        >
          {previewDataUrl ? (
            <div
              className="pointer-events-auto relative inline-flex max-h-[calc(100dvh-2rem)] max-w-[calc(100dvw-2rem)] items-center justify-center overflow-hidden rounded-[1.1rem] border border-border/45"
              style={viewerFrameStyle}
            >
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn("absolute top-3 right-3 z-20", floatingActionButtonClass)}
                  title={t('app.closeImagePreview')}
                  aria-label={t('app.closeImagePreview')}
                >
                  <X className="size-4" aria-hidden />
                  <span className="sr-only">{t('app.closeImagePreview')}</span>
                </Button>
              </DialogClose>
              <img
                src={previewDataUrl}
                alt=""
                className="block size-full object-contain"
                draggable={false}
              />
              <div className="pointer-events-none absolute top-3 left-3 z-10">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className={cn("pointer-events-auto", floatingActionButtonClass)}
                  onClick={() => void handleSaveImage()}
                  disabled={saving}
                  title={t('app.downloadImage')}
                  aria-label={t('app.downloadImage')}
                >
                  {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VideoGenerationToolCard({
  tool,
  readLocalVideoPreviewUrl,
  readManagedVideoPreviewUrl,
}: {
  tool: ToolBlockSnapshot;
  readLocalVideoPreviewUrl: ReadLocalVideoPreview;
  readManagedVideoPreviewUrl: ReadManagedVideoPreview;
}) {
  const { t } = useTranslation();
  const videoPath = tool.videoPaths?.find((path) => path.trim().length > 0) ?? "";
  const previewSourcePath =
    tool.videoPaths?.find((path) => isManagedGeneratedVideoRef(path) || isPreviewableVideoPath(path)) ?? "";
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");

  useEffect(() => {
    let cancelled = false;
    setPreviewUrl(null);
    if (!previewSourcePath) {
      setPreviewState("unavailable");
      return () => {
        cancelled = true;
      };
    }

    setPreviewState("loading");
    const resolvePreview = isManagedGeneratedVideoRef(previewSourcePath)
      ? readManagedVideoPreviewUrl(previewSourcePath)
      : readLocalVideoPreviewUrl(previewSourcePath);

    void resolvePreview
      .then((url) => {
        if (cancelled) {
          return;
        }
        setPreviewUrl(url);
        setPreviewState(url ? "ready" : "unavailable");
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewState("unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [previewSourcePath, readLocalVideoPreviewUrl, readManagedVideoPreviewUrl]);

  const loading = tool.phase === "preview" || tool.phase === "running" || previewState === "loading";

  return (
    <div className="w-full max-w-[min(28rem,100%)] py-1">
      <div
        className={cn(
          "relative aspect-square overflow-hidden rounded-md border border-border/45 bg-muted/20 transition-colors duration-200",
          tool.phase === "failed" && "border-destructive/45 bg-destructive/5",
        )}
      >
        {previewUrl ? (
          <video
            src={previewUrl}
            className="size-full object-contain"
            controls
            preload="metadata"
          />
        ) : (
          <div className="flex size-full items-center justify-center px-4 text-center">
            <span
              className={cn(
                "text-sm font-medium",
                loading ? "spirit-thinking-shimmer-text" : "text-muted-foreground",
              )}
            >
              {loading ? t('common.loading') : t('app.previewUnavailable')}
            </span>
          </div>
        )}
      </div>
      {!previewUrl && videoPath ? (
        <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground" title={videoPath}>
          {videoPath}
        </p>
      ) : null}
      {tool.phase === "failed" && tool.outputExcerpt ? (
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-destructive/20 bg-destructive/5 p-2 font-mono text-xs leading-relaxed text-destructive">
          {tool.outputExcerpt}
        </pre>
      ) : null}
    </div>
  );
}

type ComposerSurfaceProps = {
  value: string;
  localFileAttachments: readonly ComposerLocalFileAttachmentView[];
  placeholder: string;
  models: DesktopSnapshot["config"]["models"];
  catalogHints?: DesktopSnapshot["config"]["modelCatalogHints"];
  activeModel: string;
  agentMode: DesktopAgentMode;
  loopEnabled: boolean;
  canSend: boolean;
  canAbort?: boolean;
  busy: boolean;
  readOnly?: boolean;
  onChange(value: string): void;
  onSubmit(): void;
  onAbort?(): void;
  onModelSelect(name: string): void;
  onModelReasoningEffortSelect(name: string, reasoningEffort: DesktopModelReasoningEffort): void;
  onAgentModeChange(mode: DesktopAgentMode): void;
  onLoopEnabledChange?(enabled: boolean): void;
  richInputRef?: React.RefObject<ComposerRichInputHandle | null>;
  onKeyDown?(event: ReactKeyboardEvent<HTMLTextAreaElement>): void;
  onSelectionChange?(selectionStart: number | null): void;
  showInsertButton?: boolean;
  canPickLocalFile?: boolean;
  onInsertWorkspaceFileReferenceTrigger?(): void;
  onPickLocalFile?(): void | Promise<void>;
  onInsertSkillTrigger?(): void;
  onRemoveLocalFileAttachment?(path: string): void;
  onPaste?(event: ReactClipboardEvent<HTMLTextAreaElement>): void;
  browserElementAttachments?: readonly BrowserElementAttachment[];
  onElementAttachmentsChange?(attachments: BrowserElementAttachment[]): void;
  initialSegments?: readonly RichSegment[] | null;
  conversationBusy?: boolean;
  agentModeChipDismissed?: boolean;
  onAgentModeChipDismissChange?(dismissed: boolean): void;
};

function ComposerSurface({
  value,
  localFileAttachments,
  placeholder,
  models,
  catalogHints,
  activeModel,
  agentMode,
  loopEnabled = false,
  canSend,
  canAbort = false,
  busy,
  readOnly = false,
  onChange,
  onSubmit,
  onAbort,
  onModelSelect,
  onModelReasoningEffortSelect,
  onAgentModeChange,
  onLoopEnabledChange,
  richInputRef,
  onKeyDown,
  onSelectionChange,
  showInsertButton = false,
  canPickLocalFile = false,
  onInsertWorkspaceFileReferenceTrigger,
  onPickLocalFile,
  onInsertSkillTrigger,
  onRemoveLocalFileAttachment,
  onPaste,
  browserElementAttachments,
  onElementAttachmentsChange,
  initialSegments,
  conversationBusy = false,
  agentModeChipDismissed = false,
  onAgentModeChipDismissChange,
}: ComposerSurfaceProps) {
  const { t } = useTranslation();
  const [modelFilter, setModelFilter] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const activeModelProfile = useMemo(
    () => models.find((model) => model.name === activeModel),
    [activeModel, models],
  );
  const displayTitleByModelName = useMemo(
    () => buildModelCatalogDisplayTitleMap(models, catalogHints),
    [catalogHints, models],
  );
  const catalogDetailByModelName = useMemo(
    () => buildModelCatalogDetailMap(models, catalogHints),
    [catalogHints, models],
  );
  const activeModelSummary = activeModelProfile
    ? formatModelPickerLabel(
        modelDisplayTitleFromMap(activeModelProfile.name, displayTitleByModelName),
        activeModelProfile.reasoningEffort,
      )
    : activeModel;
  const modelGroups = useMemo(
    () => groupModelsForPicker(models, catalogHints),
    [models, catalogHints],
  );
  const filteredModelGroups = useMemo(() => {
    const query = modelFilter.trim().toLowerCase();
    if (!query) {
      return modelGroups;
    }

    return modelGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((model) => {
          const displayTitle = modelDisplayTitleFromMap(model.name, displayTitleByModelName);
          return (
            model.name.toLowerCase().includes(query)
            || displayTitle.toLowerCase().includes(query)
          );
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [displayTitleByModelName, modelFilter, modelGroups]);

  return (
    <div
      data-spirit-surface="composer-surface"
      className="relative overflow-hidden rounded-2xl border border-border/50 bg-background/55 shadow-sm backdrop-blur-xl focus-within:ring-0 hover:border-ring/60 focus-within:border-ring/60 dark:border-white/10 dark:hover:border-white/12 dark:focus-within:border-white/12 dark:bg-input/30 supports-[backdrop-filter]:bg-background/40 dark:supports-[backdrop-filter]:bg-input/25"
    >
      <ComposerLocalFileStrip
        attachments={localFileAttachments}
        onRemove={(path) => onRemoveLocalFileAttachment?.(path)}
      />
      <ComposerRichInput
        ref={richInputRef}
        value={value}
        elementAttachments={browserElementAttachments}
        initialSegments={initialSegments}
        placeholder={placeholder}
        readOnly={readOnly}
        loopEnabled={loopEnabled}
        loopChipLabel={t('composer.loopChipLabel')}
        agentMode={agentMode}
        planChipLabel={t('composer.planChipLabel')}
        askChipLabel={t('composer.askChipLabel')}
        onTextChange={onChange}
        onElementAttachmentsChange={(atts) => onElementAttachmentsChange?.(atts)}
        onLoopEnabledChange={onLoopEnabledChange}
        onAgentModeChange={onAgentModeChange}
        conversationBusy={conversationBusy}
        agentModeChipDismissed={agentModeChipDismissed}
        onAgentModeChipDismissChange={onAgentModeChipDismissChange}
        onPaste={(e) => onPaste?.(e as unknown as ReactClipboardEvent<HTMLTextAreaElement>)}
        onKeyDown={(e) => {
          onKeyDown?.(e as unknown as ReactKeyboardEvent<HTMLTextAreaElement>);
          if (e.defaultPrevented) return;
          if (
            e.key === 'Enter' &&
            !e.shiftKey &&
            !e.ctrlKey &&
            !e.metaKey
          ) {
            e.preventDefault();
            if (canSend) onSubmit();
          }
        }}
        onSelectionChange={onSelectionChange}
      />
      <div className="flex justify-center px-3 pt-0.5 pb-2">
        <div className="flex w-full max-w-full items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {showInsertButton ? (
              <div className="shrink-0">
                <ComposerInsertMenu
                  disabled={readOnly}
                  canPickLocalFile={canPickLocalFile}
                  onInsertWorkspaceReference={() => onInsertWorkspaceFileReferenceTrigger?.()}
                  onPickLocalFile={() => onPickLocalFile?.()}
                  onInsertSkillTrigger={() => onInsertSkillTrigger?.()}
                />
              </div>
            ) : null}
            {models.length > 0 ? (
              <FilteredOverlayMenu
                variant="filtered-list"
                open={modelMenuOpen}
                onOpenChange={(open) => {
                  setModelMenuOpen(open);
                  if (!open) {
                    setModelFilter("");
                  }
                }}
                filterValue={modelFilter}
                onFilterChange={setModelFilter}
                filterPlaceholder={t('app.filterModels')}
                trigger={
                  <FilteredOverlayMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={t('app.selectModel')}
                      disabled={readOnly}
                      className={cn(
                        "inline-flex h-7 min-w-0 max-w-[min(12rem,100%)] items-center gap-0.5 rounded-md border-0 bg-transparent pr-0.5 pl-1 text-left text-xs font-medium text-muted-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50",
                        instantHoverMotionClass,
                      )}
                    >
                      <span className="min-w-0 truncate" title={activeModelSummary}>
                        {activeModelSummary}
                      </span>
                      <ChevronDown className="size-3 shrink-0 text-muted-foreground/80" aria-hidden />
                    </button>
                  </FilteredOverlayMenuTrigger>
                }
              >
                {filteredModelGroups.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t('app.noMatches')}</p>
                ) : (
                  <HoverDetailTooltip<ModelPickerItem>
                    getItemId={(model) => model.name}
                    openDelayMs={0}
                  >
                    <HoverDetailTooltip.TriggerZone>
                      {filteredModelGroups.map((group) => (
                        <div key={group.provider} className="mb-2 last:mb-0">
                          <div className={DESKTOP_OVERLAY_LIST_GROUP_LABEL}>
                            {t(group.labelKey, { defaultValue: group.fallbackLabel })}
                          </div>
                          {group.items.map((model) => {
                            const displayTitle = modelDisplayTitleFromMap(
                              model.name,
                              displayTitleByModelName,
                            );

                            return (
                              <ModelPickerRow
                                key={`${group.provider}:${model.name}`}
                                model={model}
                                displayTitle={displayTitle}
                                isActive={activeModelProfile?.name === model.name}
                                onSelectModel={() => {
                                  onModelSelect(model.name);
                                  setModelFilter("");
                                  setModelMenuOpen(false);
                                }}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </HoverDetailTooltip.TriggerZone>
                    <HoverDetailTooltip.Content
                      side="right"
                      align="start"
                      sideOffset={8}
                      collisionPadding={16}
                      className="z-[100] w-80 max-w-[min(20rem,calc(100vw-2rem))] p-3"
                    >
                      {(activeItem) => {
                        const model = activeItem as ModelPickerItem | null;
                        if (!model) {
                          return null;
                        }
                        const group = filteredModelGroups.find((entry) =>
                          entry.items.some((item) => item.name === model.name),
                        );
                        const providerLabel = group
                          ? t(group.labelKey, { defaultValue: group.fallbackLabel })
                          : model.provider ?? model.name;

                        return (
                          <ModelPickerInspectorPanel
                            model={model}
                            catalogEntry={catalogDetailByModelName.get(model.name)}
                            providerLabel={providerLabel}
                            onReasoningEffortChange={(modelName, effort) => {
                              onModelReasoningEffortSelect(modelName, effort);
                              onModelSelect(modelName);
                              setModelFilter("");
                              setModelMenuOpen(false);
                            }}
                          />
                        );
                      }}
                    </HoverDetailTooltip.Content>
                  </HoverDetailTooltip>
                )}
              </FilteredOverlayMenu>
            ) : (
              <span className="px-1 text-xs text-muted-foreground">{t('app.noModelsAvailable')}</span>
            )}
          </div>
          <Button
            type="button"
            className={cn(
              "size-8 shrink-0 rounded-full p-0 shadow-none [&_svg]:size-3.5",
              instantHoverMotionClass,
            )}
            onClick={canAbort ? onAbort : onSubmit}
            disabled={canAbort ? false : !canSend || busy}
            title={canAbort ? t('app.abort') : t('app.send')}
          >
            {canAbort ? (
              <Square className="size-3.5" strokeWidth={2.4} aria-hidden />
            ) : busy ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <ArrowUp className="size-3.5" strokeWidth={2.25} aria-hidden />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 随 `active` 切换 `.spirit-thinking-shimmer-text`（样式与动画在 `styles.css`）。 */
function ReasoningLabelWithShimmer({
  active,
  activeLabel,
  idleLabel,
}: {
  active: boolean;
  activeLabel: string;
  idleLabel: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 text-xs font-medium tracking-wide",
        active ? "spirit-thinking-shimmer-text" : "text-muted-foreground",
      )}
    >
      {active ? activeLabel : idleLabel}
    </span>
  );
}

function ThinkingLabelWithShimmer({ active }: { active: boolean }) {
  return (
    <ReasoningLabelWithShimmer active={active} activeLabel="Thinking" idleLabel="Thought" />
  );
}

function CompactionLabelWithShimmer({ active }: { active: boolean }) {
  return (
    <ReasoningLabelWithShimmer active={active} activeLabel="Compacting" idleLabel="Compacted" />
  );
}

function isLiveStreamingThinkingMessage(
  message: ConversationMessageSnapshot | undefined,
  pendingAuxState?: PendingAssistantAux,
  messages?: readonly ConversationMessageSnapshot[],
  messageIndex?: number,
): boolean {
  return Boolean(
    message &&
      isAssistantReasoningLive(message, pendingAuxState, messages, messageIndex),
  );
}

function AssistantThinkingCollapsible({
  message,
  pendingAuxState,
  messages,
  listIndex,
  collapseDuringToolPreview,
  readManagedImagePreviewDataUrl,
  readManagedVideoPreviewUrl,
}: {
  message: ConversationMessageSnapshot;
  pendingAuxState?: PendingAssistantAux;
  messages: readonly ConversationMessageSnapshot[];
  listIndex: number;
  collapseDuringToolPreview: boolean;
  readManagedImagePreviewDataUrl: ReadManagedImagePreview;
  readManagedVideoPreviewUrl: ReadManagedVideoPreview;
}) {
  const thinking = message.aux?.thinking?.trim() ?? "";
  const reasoningLive = isAssistantReasoningLive(message, pendingAuxState, messages, listIndex);
  const showThinkingBody = Boolean(thinking && !isGenericPendingThinkingStatusText(thinking));
  const thinkingActive = reasoningLive && !collapseDuringToolPreview;
  if (!thinking && !reasoningLive) {
    return null;
  }
  if (!showThinkingBody && !thinkingActive) {
    return null;
  }
  const autoExpanded = thinkingActive && showThinkingBody;
  const [manualOpen, setManualOpen] = useState(false);
  const prevAutoExpandedRef = useRef(autoExpanded);

  useEffect(() => {
    if (prevAutoExpandedRef.current && !autoExpanded) {
      setManualOpen(false);
    }
    prevAutoExpandedRef.current = autoExpanded;
  }, [autoExpanded]);

  const expanded = autoExpanded || manualOpen;
  const interactive = !autoExpanded;

  return (
    <Collapsible
      open={expanded}
      onOpenChange={(open) => {
        if (!interactive) {
          return;
        }
        setManualOpen(open);
      }}
      className="min-w-0 py-0.5"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "group flex w-full min-w-0 items-center gap-1 text-left outline-none",
            interactive ? "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50" : "cursor-default",
          )}
        >
          <ThinkingLabelWithShimmer active={thinkingActive} />
          {interactive ? (
            <ChevronRight
              className={cn(
                "size-3 shrink-0 text-muted-foreground/55 transition-all duration-150",
                "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                expanded && "rotate-90",
              )}
              aria-hidden
            />
          ) : null}
        </button>
      </CollapsibleTrigger>
      {showThinkingBody ? (
        <CollapsibleContent className="min-w-0">
          <div className="overflow-hidden pt-1.5 [&_p:last-child]:mb-0 [&_ul:last-child]:mb-0 [&_ol:last-child]:mb-0 [&_blockquote:last-child]:mb-0 [&_pre:last-child]:mb-0">
            <AgentMarkdownMessage
              content={thinking}
              streaming={thinkingActive && expanded}
              tone="muted"
              readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
              readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
            />
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

function AssistantCompactionCollapsible({
  message,
  pendingAuxState,
  readManagedImagePreviewDataUrl,
  readManagedVideoPreviewUrl,
}: {
  message: ConversationMessageSnapshot;
  pendingAuxState?: PendingAssistantAux;
  readManagedImagePreviewDataUrl: ReadManagedImagePreview;
  readManagedVideoPreviewUrl: ReadManagedVideoPreview;
}) {
  const compaction = message.aux?.compaction?.trim() ?? "";
  const compactionLive = assistantCompactionLive(message, pendingAuxState);
  const showCompactionBody = Boolean(
    compaction && !isGenericPendingCompactionStatusText(compaction),
  );
  const compactionActive = compactionLive;
  const autoExpanded = compactionActive && showCompactionBody;
  const [manualOpen, setManualOpen] = useState(false);
  const prevAutoExpandedRef = useRef(autoExpanded);

  useEffect(() => {
    if (prevAutoExpandedRef.current && !autoExpanded) {
      setManualOpen(false);
    }
    prevAutoExpandedRef.current = autoExpanded;
  }, [autoExpanded]);

  const expanded = autoExpanded || manualOpen;
  const interactive = !autoExpanded;

  return (
    <Collapsible
      open={expanded}
      onOpenChange={(open) => {
        if (!interactive) {
          return;
        }
        setManualOpen(open);
      }}
      className="min-w-0 py-0.5"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "group flex w-full min-w-0 items-center gap-1 text-left outline-none",
            interactive ? "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50" : "cursor-default",
          )}
        >
          <CompactionLabelWithShimmer active={compactionActive} />
          {interactive ? (
            <ChevronRight
              className={cn(
                "size-3 shrink-0 text-muted-foreground/55 transition-all duration-150",
                "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                expanded && "rotate-90",
              )}
              aria-hidden
            />
          ) : null}
        </button>
      </CollapsibleTrigger>
      {showCompactionBody ? (
        <CollapsibleContent className="min-w-0">
          <div className="overflow-hidden pt-1.5 [&_p:last-child]:mb-0 [&_ul:last-child]:mb-0 [&_ol:last-child]:mb-0 [&_blockquote:last-child]:mb-0 [&_pre:last-child]:mb-0">
            <AgentMarkdownMessage
              content={compaction}
              streaming={compactionActive}
              tone="muted"
              readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
              readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
            />
          </div>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

function MessageCard({
  composerSessionKey,
  conversationListScopeKey,
  messages,
  message,
  listIndex,
  compactAfterPrevious,
  tightenAfterPreviousMeta,
  showContinueButton,
  continueTarget,
  continueBusy,
  rewindText,
  rewindLocalFileAttachments,
  rewindBrowserElementAttachments,
  rewindSelected,
  rewindCanSubmit,
  rewindBusy,
  rewindRichInputRef,
  onRewindElementAttachmentsChange,
  canPickLocalFile,
  models,
  catalogHints,
  activeModel,
  agentMode,
  onContinue,
  onRewindChange,
  onRewindStart,
  onRewindSubmit,
  onRewindRemoveLocalFileAttachment,
  onRewindPickLocalFile,
  onRewindPaste,
  onModelSelect,
  onModelReasoningEffortSelect,
  onAgentModeChange,
  pendingAuxState,
  readManagedImagePreviewDataUrl,
  readManagedVideoPreviewUrl,
  readLocalImagePreviewDataUrl,
  readLocalVideoPreviewUrl,
  saveLocalImageAs,
  onOpenSubagentViewer,
}: {
  composerSessionKey: string;
  conversationListScopeKey: string;
  messages: readonly ConversationMessageSnapshot[];
  pendingAuxState?: PendingAssistantAux;
  message: ConversationMessageSnapshot;
  listIndex: number;
  compactAfterPrevious: boolean;
  tightenAfterPreviousMeta: boolean;
  showContinueButton: boolean;
  continueTarget?: ConversationMessageSnapshot;
  continueBusy: boolean;
  rewindText: string;
  rewindLocalFileAttachments: readonly ComposerLocalFileAttachmentView[];
  rewindBrowserElementAttachments: readonly BrowserElementAttachment[];
  rewindSelected: boolean;
  rewindCanSubmit: boolean;
  rewindBusy: boolean;
  rewindRichInputRef: React.RefObject<ComposerRichInputHandle | null>;
  onRewindElementAttachmentsChange(attachments: BrowserElementAttachment[]): void;
  canPickLocalFile: boolean;
  models: DesktopSnapshot["config"]["models"];
  catalogHints?: DesktopSnapshot["config"]["modelCatalogHints"];
  activeModel: string;
  agentMode: DesktopAgentMode;
  onContinue(message: ConversationMessageSnapshot): void;
  onRewindChange(value: string): void;
  onRewindStart(message: ConversationMessageSnapshot, listIndex: number): void;
  onRewindSubmit(): void;
  onRewindRemoveLocalFileAttachment(path: string): void;
  onRewindPickLocalFile(): void;
  onRewindPaste(event: ReactClipboardEvent<HTMLTextAreaElement>): void;
  onModelSelect(name: string): void;
  onModelReasoningEffortSelect(name: string, reasoningEffort: DesktopModelReasoningEffort): void;
  onAgentModeChange(mode: DesktopAgentMode): void;
  readManagedImagePreviewDataUrl: ReadManagedImagePreview;
  readManagedVideoPreviewUrl: ReadManagedVideoPreview;
  readLocalImagePreviewDataUrl: ReadLocalImagePreview;
  readLocalVideoPreviewUrl: ReadLocalVideoPreview;
  saveLocalImageAs: SaveLocalImageAs;
  onOpenSubagentViewer?: (toolCallId: string) => void;
}) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  const canStartRewind = isUser && message.canRewind === true && !message.pending;
  const userBubble =
    "rounded-2xl rounded-br-md border border-border/50 bg-muted px-3 py-2.5 shadow-sm";
  const subagentStatusSurface =
    !isUser && message.content.trim() ? isSubagentStatusSurfaceMessage(message) : false;
  const showThinkingCollapsible = shouldShowAssistantThinkingCollapsible(
    message,
    pendingAuxState,
    messages,
    listIndex,
  );
  const showCompactionCollapsible = shouldShowAssistantCompactionCollapsible(
    message,
    pendingAuxState,
  );
  const collapseThinkingDuringToolPreview = shouldCollapseThinkingDuringToolPreview(
    messages,
    listIndex,
  );
  const rewindInitialSegments = useMemo(
    () =>
      rewindSelected
        ? messageContentToRichSegments(message.content, String(message.id))
        : null,
    [rewindSelected, message.content, message.id],
  );
  return (
    <div
      id={conversationMessageStableId(message, composerSessionKey, conversationListScopeKey)}
      data-spirit-surface="message-row"
      data-spirit-message-role={message.role}
      data-spirit-message-pending={message.pending ? "true" : "false"}
      className={cn(
        "scroll-mt-4 flex w-full pb-3 last:pb-0",
        compactAfterPrevious && "-mt-4",
        tightenAfterPreviousMeta && "-mt-3",
        isUser ? "justify-end" : "justify-start",
        rewindSelected && "relative z-40",
      )}
    >
      <div
        data-spirit-surface={isUser ? "message-user" : "message-assistant"}
        className={cn(
          "min-w-0 space-y-2",
          isUser
            ? rewindSelected
              ? "ml-auto w-full max-w-[min(100%,36rem)]"
              : "max-w-[min(72%,22rem)]"
            : "w-full",
        )}
      >
        {rewindSelected && isUser ? (
          <ComposerSurface
            key={`rewind-composer-${message.id}`}
            richInputRef={rewindRichInputRef}
            value={rewindText}
            initialSegments={rewindInitialSegments}
            browserElementAttachments={rewindBrowserElementAttachments}
            onElementAttachmentsChange={onRewindElementAttachmentsChange}
            localFileAttachments={rewindLocalFileAttachments}
            onChange={onRewindChange}
            onSubmit={onRewindSubmit}
            placeholder={t('app.typeMessage')}
            models={models}
            catalogHints={catalogHints}
            activeModel={activeModel}
            agentMode={agentMode}
            loopEnabled={false}
            onModelSelect={onModelSelect}
            onModelReasoningEffortSelect={onModelReasoningEffortSelect}
            onAgentModeChange={onAgentModeChange}
            onLoopEnabledChange={() => {}}
            canSend={rewindCanSubmit}
            busy={rewindBusy}
            showInsertButton
            canPickLocalFile={canPickLocalFile}
            onPickLocalFile={onRewindPickLocalFile}
            onRemoveLocalFileAttachment={onRewindRemoveLocalFileAttachment}
            onPaste={onRewindPaste}
          />
        ) : null}
        {showThinkingCollapsible ? (
          <AssistantThinkingCollapsible
            message={message}
            pendingAuxState={pendingAuxState}
            messages={messages}
            listIndex={listIndex}
            collapseDuringToolPreview={collapseThinkingDuringToolPreview}
            readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
            readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
          />
        ) : null}
        {showCompactionCollapsible ? (
          <AssistantCompactionCollapsible
            message={message}
            pendingAuxState={pendingAuxState}
            readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
            readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
          />
        ) : null}
        {isUser && !rewindSelected ? (
          <UserMessageBubble
            message={message}
            userBubbleClassName={userBubble}
            canStartRewind={canStartRewind}
            onRewindStart={() => onRewindStart(message, listIndex)}
            readLocalImagePreviewDataUrl={readLocalImagePreviewDataUrl}
          />
        ) : null}
        {!isUser && message.content.trim() ? (
          subagentStatusSurface ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{message.content}</p>
          ) : (
          <div data-spirit-surface="message-bubble">
            <AgentMarkdownMessage
              content={message.content}
              streaming={message.pending}
              className="font-sans"
              readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
              readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
            />
          </div>
          )
        ) : null}
        {!isUser && message.aux?.finishTaskNotice ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {message.aux.finishTaskNotice}
          </p>
        ) : null}
        {!isUser && message.tool ? (
          <ToolCallCollapsible
            tool={message.tool}
            readLocalImagePreviewDataUrl={readLocalImagePreviewDataUrl}
            readLocalVideoPreviewUrl={readLocalVideoPreviewUrl}
            readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
            saveLocalImageAs={saveLocalImageAs}
            onOpenSubagentViewer={onOpenSubagentViewer}
          />
        ) : null}
        {!isUser && showContinueButton && continueTarget ? (
          <div className="ml-auto flex max-w-[min(72%,22rem)] justify-end pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-4"
              onClick={() => onContinue(continueTarget)}
              disabled={continueBusy}
            >
              {t('app.continue')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function isGrayMetaLineMessage(message: ConversationMessageSnapshot | undefined): boolean {
  return isGrayMetaLeadingMessage(message) && isGrayMetaTrailingMessage(message);
}

function AskQuestionField({
  draft,
  question,
  onCustomInputChange,
  onMultiSelectToggle,
  onRadioSelect,
  onTextChange,
}: {
  draft: {
    selectedOptionIndexes: number[];
    customInput: string;
    text: string;
  };
  question: AskQuestionsQuestionSpec;
  onCustomInputChange(value: string): void;
  onMultiSelectToggle(index: number, checked: boolean): void;
  onRadioSelect(index: number): void;
  onTextChange(value: string): void;
}) {
  const { t } = useTranslation();
  const selectedValue =
    question.kind === "single_select" && draft.selectedOptionIndexes.length > 0
      ? String(draft.selectedOptionIndexes[0])
      : undefined;

  return (
    <Card className="border-border/60 bg-background/90" size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{question.title}</CardTitle>
          {question.required ? <Badge variant="secondary">{t('app.required')}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {question.kind === "single_select" ? (
          <RadioGroup
            value={selectedValue}
            onValueChange={(value) => onRadioSelect(Number(value))}
            className="gap-3"
          >
            {question.options.map((option, index) => {
              const optionId = `${question.id}-single-${index}`;
              return (
                <Label
                  key={optionId}
                  htmlFor={optionId}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 bg-card/70 p-4"
                >
                  <RadioGroupItem id={optionId} value={String(index)} />
                  <div className="space-y-1">
                    <span className="font-medium">{option.label}</span>
                    {option.summary ? (
                      <p className="text-sm leading-6 text-muted-foreground">
                        {option.summary}
                      </p>
                    ) : null}
                  </div>
                </Label>
              );
            })}
          </RadioGroup>
        ) : null}

        {question.kind === "multi_select" ? (
          <div className="grid gap-3">
            {question.options.map((option, index) => {
              const optionId = `${question.id}-multi-${index}`;
              const checked = draft.selectedOptionIndexes.includes(index);
              return (
                <Label
                  key={optionId}
                  htmlFor={optionId}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 bg-card/70 p-4"
                >
                  <Checkbox
                    id={optionId}
                    checked={checked}
                    onCheckedChange={(next) => onMultiSelectToggle(index, next === true)}
                  />
                  <div className="space-y-1">
                    <span className="font-medium">{option.label}</span>
                    {option.summary ? (
                      <p className="text-sm leading-6 text-muted-foreground">
                        {option.summary}
                      </p>
                    ) : null}
                  </div>
                </Label>
              );
            })}
          </div>
        ) : null}

        {question.kind === "text" ? (
          <div className="space-y-2">
            <Label htmlFor={`${question.id}-text`}>
              {question.customInputLabel ?? t('app.answer')}
            </Label>
            <Textarea
              id={`${question.id}-text`}
              value={draft.text}
              onChange={(event) => onTextChange(event.target.value)}
              placeholder={question.customInputPlaceholder ?? t('app.enterAnswer')}
              className="min-h-28"
            />
          </div>
        ) : null}

        {question.allowCustomInput ? (
          <div className="space-y-2">
            <Label htmlFor={`${question.id}-custom`}>
              {question.customInputLabel ?? t('app.customInput')}
            </Label>
            <Input
              id={`${question.id}-custom`}
              value={draft.customInput}
              onChange={(event) => onCustomInputChange(event.target.value)}
              placeholder={question.customInputPlaceholder ?? t('app.supplementOption')}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function isElectronChrome(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.spiritDesktop) {
    return true;
  }
  return typeof navigator !== "undefined" && /\bElectron\//.test(navigator.userAgent);
}

/** Windows Electron：使用 `titleBarOverlay` + 自绘顶栏；macOS 仍走系统菜单栏 */
function isWin32ElectronShell(): boolean {
  if (!isElectronChrome() || typeof navigator === "undefined") {
    return false;
  }
  return /Windows/i.test(navigator.userAgent);
}

function WebHostPairingGate({
  busy,
  error,
  onPair,
}: {
  busy: boolean;
  error: string;
  onPair(code: string): Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [localError, setLocalError] = useState("");

  const submit = () => {
    const normalized = code.trim();
    if (!normalized) {
      setLocalError(t('app.enterPairingCode'));
      return;
    }
    void onPair(normalized).then((ok) => {
      if (!ok) {
        setLocalError(t('app.pairingFailed'));
      }
    });
  };

  return (
    <div className="flex h-[100dvh] items-center justify-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-sm rounded-lg">
        <CardHeader>
          <CardTitle>{t('app.firstTimePairing')}</CardTitle>
          <CardDescription>{t('app.pairingDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="web-host-pairing-code">{t('app.pairingCode')}</Label>
            <Input
              id="web-host-pairing-code"
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              onChange={(event) => {
                setLocalError("");
                setCode(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !busy) {
                  submit();
                }
              }}
            />
          </div>
          {localError || (error && !error.includes('需要完成首次配对')) ? (
            <p className="text-sm text-destructive">{localError || error}</p>
          ) : null}
          <Button type="button" className="w-full" disabled={busy} onClick={submit}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {t('app.pair')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function DesktopLayoutChromeBar({
  useMicaBackdrop,
  showWorkspaceToggle,
  workspaceToolsOpen = false,
  onToggleWorkspaceTools,
  sessionTitle,
  subagentPromptText,
  onExitSubagentViewer,
  onNewSession,
  newSessionBusy = false,
}: {
  useMicaBackdrop: boolean;
  showWorkspaceToggle: boolean;
  workspaceToolsOpen?: boolean;
  onToggleWorkspaceTools?: () => void;
  sessionTitle?: string | null;
  subagentPromptText?: string | null;
  onExitSubagentViewer?: () => void;
  onNewSession?: () => void;
  newSessionBusy?: boolean;
}) {
  const { t } = useTranslation();
  const { open: sessionSidebarOpen, toggle: onToggleSessionSidebar } = useSessionSidebarChrome();
  const showTrailingActions = showWorkspaceToggle;
  const trimmedSessionTitle = sessionTitle?.trim() ?? "";
  return (
    <div
      role="toolbar"
      aria-label={t('app.sidebarAndTools')}
      data-spirit-surface="layout-chrome"
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 px-1.5",
        showTrailingActions ? "justify-between" : "justify-start",
        useMicaBackdrop ? "bg-transparent" : "bg-background",
      )}
    >
      <div className="flex min-w-0 items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(DESKTOP_CHROME_TOGGLE_ICON_BTN, "mr-1")}
          onClick={onToggleSessionSidebar}
          aria-label={sessionSidebarOpen ? t('app.hideSidebar') : t('app.showSidebar')}
          aria-expanded={sessionSidebarOpen}
          {...(sessionSidebarOpen ? { "aria-controls": "session-sidebar-panel" } : {})}
        >
          {sessionSidebarOpen ? <PanelLeftClose className="size-3.5" aria-hidden /> : <PanelLeftOpen className="size-3.5" aria-hidden />}
        </Button>
        {onNewSession ? (
          <div
            className={cn(
              "shrink-0 overflow-hidden",
              DESKTOP_SHELL_LAYOUT_TRANSITION,
              sessionSidebarOpen
                ? "pointer-events-none mr-0 w-0 opacity-0"
                : "mr-1 w-7 opacity-100",
            )}
            aria-hidden={sessionSidebarOpen}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={DESKTOP_CHROME_TOGGLE_ICON_BTN}
              onClick={onNewSession}
              disabled={newSessionBusy}
              tabIndex={sessionSidebarOpen ? -1 : undefined}
              aria-label={t("sidebar.newSession")}
            >
              <Plus className="size-3.5" aria-hidden />
            </Button>
          </div>
        ) : null}
        {trimmedSessionTitle ? (
          <SessionChromeBreadcrumb
            sessionTitle={trimmedSessionTitle}
            subagentPromptText={subagentPromptText}
            onExitSubagentViewer={onExitSubagentViewer}
          />
        ) : null}
      </div>
      {showTrailingActions ? (
        <div className="flex items-center gap-1">
          {showWorkspaceToggle ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={DESKTOP_CHROME_TOGGLE_ICON_BTN}
              onClick={() => onToggleWorkspaceTools?.()}
              aria-label={workspaceToolsOpen ? t('app.collapseTools') : t('app.expandTools')}
              aria-expanded={workspaceToolsOpen}
              {...(workspaceToolsOpen ? { "aria-controls": "workspace-tools-panel" } : {})}
            >
              {workspaceToolsOpen ? (
                <PanelRightClose className="size-3.5" aria-hidden />
              ) : (
                <PanelRightOpen className="size-3.5" aria-hidden />
              )}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { font, setFont } = useFont();
  const runtime = useDesktopRuntime();
  const snapshot = runtime.snapshot;
  /** 与 Host API 的 `kind` 解耦：壳可能是 Electron，但仍通过 Vite 代理走 Web Host（侧栏会显示 Localhost Web Host）。Mica 与 `spirit-desktop-native` 仍应对 Electron 窗口生效。 */
  const isElectronShell = isElectronChrome();
  const useMicaBackdrop =
    isElectronShell && (snapshot?.config.windowsMica !== false);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    if (isElectronShell) {
      document.documentElement.classList.add("spirit-desktop-native");
    } else {
      document.documentElement.classList.remove("spirit-desktop-native");
    }
  }, [isElectronShell]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    if (useMicaBackdrop) {
      document.documentElement.classList.add("spirit-desktop-mica");
    } else {
      document.documentElement.classList.remove("spirit-desktop-mica");
    }
  }, [useMicaBackdrop]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const styleNodes = Array.from(
      document.head.querySelectorAll<HTMLStyleElement>('style[data-spirit-extension-css="true"]'),
    );
    for (const node of styleNodes) {
      node.remove();
    }

    const layers = snapshot?.extensionCss ?? [];
    for (const layer of layers) {
      const style = document.createElement("style");
      style.dataset.spiritExtensionCss = "true";
      style.dataset.extensionId = layer.extensionId;
      style.dataset.sourcePath = layer.sourcePath;
      if (layer.media) {
        style.media = layer.media;
      }
      style.textContent = layer.cssText;
      document.head.append(style);
    }

    return () => {
      for (const node of document.head.querySelectorAll<HTMLStyleElement>('style[data-spirit-extension-css="true"]')) {
        node.remove();
      }
    };
  }, [snapshot?.extensionCss]);

  // 与 `config.windows_mica` 持久化对齐（保存 Mica 开关后桌面宿主会先按系统主题同步一帧，此处用 `html.dark` 再拉齐）
  useEffect(() => {
    if (!isElectronShell) {
      return;
    }
    syncDesktopWindowFrame(resolveDark(theme), desktopNativeThemeForPreference(theme));
    // 主题变更由 `applyThemeToDocument` 同步边框；此处仅随 Mica 配置变更
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 windowsMica / Electron 壳
  }, [isElectronShell, snapshot?.config.windowsMica]);

  const compactionDemo = useCompactionUiDemo();
  const subagentViewer = useSubagentViewer(runtime.setSubagentViewerTarget);
  const subagentViewActive = subagentViewer.active && Boolean(snapshot?.subagentViewer);
  const handleOpenSubagentViewer = useCallback(
    (toolCallId: string) => {
      compactionDemo.stop();
      void subagentViewer.open(toolCallId);
    },
    [compactionDemo, subagentViewer],
  );
  const models = snapshot?.config.models ?? [];
  const composerSessionKey = snapshot?.composerSessionKey ?? "";
  const emptySessionGreetingCacheRef = useRef(new Map<string, EmptySessionGreetingVariantId>());
  const workspaceDisplayLabel = useMemo(
    () =>
      resolveWorkspaceDisplayLabel(
        snapshot?.workspaceRoot ?? "",
        snapshot?.workspaceBinding ?? "project",
        snapshot?.availableWorkspaces ?? [],
      ),
    [
      snapshot?.availableWorkspaces,
      snapshot?.workspaceBinding,
      snapshot?.workspaceRoot,
      i18n.language,
    ],
  );
  const includeWorkspaceGreetingVariants = workspaceDisplayLabel !== null;
  const emptySessionGreeting = useMemo(() => {
    const sessionKey = composerSessionKey.trim() || "__no-session__";
    let variantId = emptySessionGreetingCacheRef.current.get(sessionKey);
    if (!variantId) {
      variantId = pickEmptySessionGreetingVariant({
        includeWorkspaceVariants: includeWorkspaceGreetingVariants,
      });
      emptySessionGreetingCacheRef.current.set(sessionKey, variantId);
    }
    return resolveEmptySessionGreeting(t, variantId, workspaceDisplayLabel);
  }, [
    composerSessionKey,
    includeWorkspaceGreetingVariants,
    workspaceDisplayLabel,
    t,
    i18n.language,
  ]);
  const sessionMessages = snapshot?.conversation.messages ?? [];
  const messages = subagentViewActive
    ? (snapshot?.subagentViewer?.messages ?? [])
    : compactionDemo.active
      ? compactionDemo.messages
      : sessionMessages;
  const conversationListScopeKey = resolveConversationListScopeKey({
    subagentViewActive,
    subagentToolCallId: subagentViewer.toolCallId,
    compactionDemoActive: compactionDemo.active,
  });
  const turnContinue = useMemo(
    () => (compactionDemo.active || subagentViewActive ? undefined : resolveTurnContinuePresentation(messages)),
    [compactionDemo.active, messages, subagentViewActive],
  );
  const isEmptySession = !compactionDemo.active && !subagentViewActive && sessionMessages.length === 0;
  /** 仅空会话展示工作区/分支等待选控件；有消息后隐藏（含无工作区绑定会话）。 */
  const showWorkspaceBindingControls = isEmptySession;
  const conversationPendingAuxState = subagentViewActive
    ? snapshot?.subagentViewer?.pendingAuxState
    : compactionDemo.active
      ? compactionDemo.pendingAuxState
      : snapshot?.conversation.pendingAuxState;
  const [conversationListRemountEpoch, setConversationListRemountEpoch] = useState(0);
  const prevSessionMessageCountRef = useRef(sessionMessages.length);

  useEffect(() => {
    const count = sessionMessages.length;
    if (count < prevSessionMessageCountRef.current) {
      setConversationListRemountEpoch((epoch) => epoch + 1);
    }
    prevSessionMessageCountRef.current = count;
  }, [sessionMessages.length]);

  const rewindWarnings = snapshot?.conversation.rewindWarnings ?? [];
  const pendingApproval = snapshot?.conversation.pendingToolApproval;
  const showPendingApprovalInComposer = Boolean(
    pendingApproval
    && (
      !subagentViewActive
      || pendingApproval.subagentSessionId === snapshot?.subagentViewer?.sessionId
    ),
  );
  const { ref: composerDockRef, heightPx: composerDockHeightPx } = useElementBoxHeight<HTMLDivElement>();
  const conversationScrollBedPaddingPx =
    composerDockHeightPx > 0
      ? Math.max(
          CONVERSATION_COMPOSER_SCROLL_BED_FALLBACK_PX,
          composerDockHeightPx + CONVERSATION_SCROLL_BED_EXTRA_PX,
        )
      : CONVERSATION_COMPOSER_SCROLL_BED_FALLBACK_PX;
  const pendingQuestions = runtime.pendingQuestions;
  useLocalFileAttachmentPreviews(
    runtime.composerLocalFileAttachments,
    runtime.setComposerLocalFileAttachments,
    runtime.readLocalImagePreviewDataUrl,
  );

  const [composerBrowserElementAttachments, setComposerBrowserElementAttachments] = useState<BrowserElementAttachment[]>([]);

  const activeSessionReadOnly = snapshot?.activeSession?.readOnly === true;
  const composerDirectMediaMode = useMemo(() => {
    if (!snapshot?.config) {
      return null;
    }
    return resolveComposerDirectMediaTool(snapshot.config.activeModel, snapshot.config);
  }, [snapshot?.config]);
  const composerPlaceholder = activeSessionReadOnly
    ? t("app.readOnlySession")
    : composerDirectMediaMode === "generate_image"
      ? t("composer.placeholderGenerateImage")
      : composerDirectMediaMode === "generate_video"
        ? t("composer.placeholderGenerateVideo")
        : t("app.typeMessage");
  const conversationInterruptible = runtime.summary.canInterrupt && !runtime.busyAction;
  const continueBusy = Boolean(runtime.busyAction) || snapshot?.conversation.isBusy === true;
  const composerCanSend =
    !compactionDemo.active &&
    !subagentViewActive &&
    (Boolean(runtime.composer.trim()) || runtime.composerLocalFileAttachments.length > 0) &&
    !activeSessionReadOnly &&
    runtime.busyAction !== "session" &&
    !pendingApproval &&
    !pendingQuestions &&
    !(runtime.busyAction === "send" && !conversationInterruptible);
  const startImplementingDisabled =
    !snapshot?.runtimeReady ||
    activeSessionReadOnly ||
    runtime.busyAction === "session" ||
    Boolean(pendingApproval) ||
    Boolean(pendingQuestions) ||
    (runtime.busyAction === "send" && !conversationInterruptible);
  const [rewindDraft, setRewindDraft] = useState<MessageRewindDraftState | null>(null);
  const previousComposerSessionKeyRef = useRef(composerSessionKey);

  useEffect(() => {
    if (previousComposerSessionKeyRef.current !== composerSessionKey) {
      previousComposerSessionKeyRef.current = composerSessionKey;
      if (subagentViewer.active) {
        void subagentViewer.close();
      }
    }
  }, [composerSessionKey, subagentViewer]);

  useEffect(() => {
    if (subagentViewer.active && !snapshot?.subagentViewer) {
      const toolCallId = subagentViewer.toolCallId;
      const stillStarting = toolCallId
        ? isRunSubagentToolCallPending(snapshot?.conversation.messages ?? [], toolCallId)
        : false;
      if (stillStarting) {
        return;
      }
      void subagentViewer.close();
    }
  }, [snapshot?.conversation.messages, snapshot?.subagentViewer, subagentViewer]);

  useEffect(() => {
    if (rewindDraft && subagentViewer.active) {
      void subagentViewer.close();
    }
  }, [rewindDraft, subagentViewer]);
  useLocalFileAttachmentPreviews(
    rewindDraft?.localFileAttachments ?? [],
    (update) => {
      setRewindDraft((current) => {
        if (!current) {
          return current;
        }
        const localFileAttachments =
          typeof update === "function" ? update(current.localFileAttachments) : update;
        return { ...current, localFileAttachments };
      });
    },
    runtime.readLocalImagePreviewDataUrl,
  );

  const [activeSurface, setActiveSurface] = useState<"conversation" | "settings" | "marketplace">(
    "conversation",
  );
  const [lastNonSettingsSurface, setLastNonSettingsSurface] = useState<"conversation" | "marketplace">(
    "conversation",
  );
  const [settingsTab, setSettingsTab] = useState<SettingsSidebarTab>("models");
  const [extensionSettingsId, setExtensionSettingsId] = useState<string | null>(null);
  const sessionSidebarChromeApiRef = useRef<SessionSidebarChromeApi | null>(null);

  const [workspaceToolsOpen, setWorkspaceToolsOpen] = useState(false);
  const initialWorkspaceToolsRef = useRef<ReturnType<
    typeof createInitialWorkspaceToolsState
  > | null>(null);
  if (initialWorkspaceToolsRef.current === null) {
    initialWorkspaceToolsRef.current = createInitialWorkspaceToolsState(false);
  }
  const initialWorkspaceTools = initialWorkspaceToolsRef.current;
  const [workspaceToolTabs, setWorkspaceToolTabs] = useState(() => initialWorkspaceTools.tabs);
  const [activeWorkspaceToolTabId, setActiveWorkspaceToolTabId] = useState(
    () => initialWorkspaceTools.activeTabId,
  );
  const activeWorkspaceToolTabIdRef = useRef(activeWorkspaceToolTabId);
  activeWorkspaceToolTabIdRef.current = activeWorkspaceToolTabId;
  const workspaceToolTabsRef = useRef(workspaceToolTabs);
  workspaceToolTabsRef.current = workspaceToolTabs;
  const workspaceToolsHostSyncedRef = useRef<typeof runtime.hostKind | null>(null);
  const browserTabEnabled = runtime.hostKind === "electron";
  const [workspaceFilesPlanRevealNonce, setWorkspaceFilesPlanRevealNonce] = useState(0);
  const [workspaceFilesPlanRevealTargetId, setWorkspaceFilesPlanRevealTargetId] = useState<
    string | null
  >(null);
  const [workspaceFileRevealNonce, setWorkspaceFileRevealNonce] = useState(0);
  const [workspaceFileRevealTargetId, setWorkspaceFileRevealTargetId] = useState<string | null>(
    null,
  );
  const [workspaceFileRevealPath, setWorkspaceFileRevealPath] = useState("");
  const [workspaceFileRevealAbsolutePath, setWorkspaceFileRevealAbsolutePath] = useState("");
  const [workspaceFileRevealScope, setWorkspaceFileRevealScope] = useState<
    EditorFileTarget["scope"]
  >("workspace");
  const [workspaceFileRevealViewMode, setWorkspaceFileRevealViewMode] =
    useState<WorkspaceEditorViewMode>("edit");
  const [workspaceToolsWidthPx, setWorkspaceToolsWidthPx] = useState(readWorkspaceToolsWidthPx);

  const openBrowserUrlInNewTab = useCallback((rawUrl: string) => {
    if (runtime.hostKind !== "electron") {
      return;
    }
    const url = normalizeBrowserUrl(rawUrl);
    if (!url) {
      return;
    }
    setWorkspaceToolsOpen(true);
    let nextActiveId = "";
    setWorkspaceToolTabs((prev) => {
      const next = addWorkspaceBrowserTabWithUrl(prev, url);
      nextActiveId = next.activeId;
      return next.tabs;
    });
    if (nextActiveId) {
      setActiveWorkspaceToolTabId(nextActiveId);
    }
  }, [runtime.hostKind]);

  const openEditorFile = useCallback((target: EditorFileTarget) => {
    const navigation = buildOpenEditorFileNavigation({
      tabs: workspaceToolTabsRef.current,
      activeTabId: activeWorkspaceToolTabIdRef.current,
      target,
    });
    setWorkspaceToolsOpen(true);
    setWorkspaceToolTabs(navigation.tabs);
    setActiveWorkspaceToolTabId(navigation.activeTabId);
    setWorkspaceFileRevealTargetId(navigation.filesTabId);
    setWorkspaceFileRevealScope(target.scope);
    setWorkspaceFileRevealViewMode(target.viewMode);
    if (target.scope === "workspace") {
      setWorkspaceFileRevealPath(target.relativePath);
      setWorkspaceFileRevealAbsolutePath("");
    } else {
      setWorkspaceFileRevealPath("");
      setWorkspaceFileRevealAbsolutePath(target.absolutePath);
    }
    setWorkspaceFileRevealNonce((value) => value + 1);
  }, []);

  const openWorkspaceFile = useCallback(
    (relativePath: string, options?: { viewMode?: WorkspaceEditorViewMode }) => {
      openEditorFile({
        scope: "workspace",
        relativePath,
        viewMode: options?.viewMode ?? "edit",
      });
    },
    [openEditorFile],
  );

  useEffect(() => {
    if (!runtime.apiReady || runtime.hostKind == null) {
      return;
    }
    if (workspaceToolsHostSyncedRef.current === runtime.hostKind) {
      return;
    }
    workspaceToolsHostSyncedRef.current = runtime.hostKind;
    const includeBrowser = runtime.hostKind === "electron";
    setWorkspaceToolTabs((prev) => {
      const normalized = normalizeWorkspaceToolTabsForHost(
        prev,
        activeWorkspaceToolTabIdRef.current,
        includeBrowser,
      );
      if (normalized.activeId !== activeWorkspaceToolTabIdRef.current) {
        setActiveWorkspaceToolTabId(normalized.activeId);
      }
      return normalized.tabs;
    });
  }, [runtime.apiReady, runtime.hostKind]);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.subscribeBrowserOpenUrl) {
      return;
    }
    return bridge.subscribeBrowserOpenUrl(openBrowserUrlInNewTab);
  }, [openBrowserUrlInNewTab]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'p') {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        setActionPickerOpen(true);
        return;
      }
      setFilePickerOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const [composerCursorCodeUnits, setComposerCursorCodeUnits] = useState(0);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(-1);
  const [fileReferenceSuggestions, setFileReferenceSuggestions] =
    useState<WorkspaceFileReferenceSuggestionsResponse>(null);
  const [fileReferenceSelectedIndex, setFileReferenceSelectedIndex] = useState(-1);
  const [dismissedFileReferenceKey, setDismissedFileReferenceKey] = useState<string | null>(null);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [actionPickerOpen, setActionPickerOpen] = useState(false);
  const [branchCheckoutDialogOpen, setBranchCheckoutDialogOpen] = useState(false);
  const [branchCheckoutBlockedByChanges, setBranchCheckoutBlockedByChanges] = useState(false);
  const pendingComposerSendRef = useRef<{
    text: string;
    localFilePaths?: string[];
  } | null>(null);
  const activeFilePath = snapshot?.activeSession?.filePath ?? null;
  const commitBusy = runtime.busyAction === "git";
  const gitChipBusy =
    runtime.busyAction === "send" || snapshot?.conversation.isBusy === true;
  const sessionNavigationBusy = runtime.busyAction === "session";
  const newSessionBusy = runtime.busyAction === "reset";
  const composerRichInputRef = useRef<ComposerRichInputHandle | null>(null);
  const rewindRichInputRef = useRef<ComposerRichInputHandle | null>(null);

  const handleComposerAgentModeChange = useCallback(
    (agentMode: DesktopAgentMode) => {
      void runtime.saveSettingsPatch({ agentMode });
      if (agentMode === "plan" || agentMode === "ask") {
        runtime.setAgentModeChipDismissed(false);
      }
      if (agentMode === "plan") {
        composerRichInputRef.current?.insertPlanChip({ clearText: false });
      } else if (agentMode === "ask") {
        composerRichInputRef.current?.insertAskChip({ clearText: false });
      } else {
        composerRichInputRef.current?.removeAgentModeChip();
      }
    },
    [runtime],
  );
  const handleNewSession = useCallback(() => {
    setLastNonSettingsSurface("conversation");
    setActiveSurface("conversation");
    void runtime.resetSession();
  }, [runtime]);
  const previousPlanModifiedAtRef = useRef<number | undefined>(undefined);
  const previousPlanExistsRef = useRef<boolean | undefined>(undefined);
  const previousActiveSessionPathRef = useRef<string | null>(null);
  const winElectronChrome = isWin32ElectronShell();
  const settingsMode = activeSurface === "settings";
  const marketplaceMode = activeSurface === "marketplace";
  const slashQuery = useMemo(() => currentSkillSlashQuery(runtime.composer), [runtime.composer]);
  const slashSuggestions = useMemo(
    () => buildSkillSlashSuggestions(slashQuery, snapshot?.skillsList ?? []),
    [slashQuery, snapshot?.skillsList],
  );

  useEffect(() => {
    const plan = snapshot?.plan;
    const sessionPath = snapshot?.activeSession?.filePath ?? null;
    if (!plan) {
      return;
    }

    const sessionChanged =
      previousActiveSessionPathRef.current !== null &&
      previousActiveSessionPathRef.current !== sessionPath;

    const previousExists = previousPlanExistsRef.current;
    const previousModifiedAt = previousPlanModifiedAtRef.current;

    previousActiveSessionPathRef.current = sessionPath;
    previousPlanExistsRef.current = plan.exists;
    previousPlanModifiedAtRef.current = plan.modifiedAtUnixMs;

    if (sessionChanged) {
      return;
    }

    const created = previousExists === false && plan.exists;
    const modified =
      plan.exists &&
      plan.modifiedAtUnixMs !== undefined &&
      previousModifiedAt !== undefined &&
      plan.modifiedAtUnixMs !== previousModifiedAt;

    if (!created && !modified) {
      return;
    }

    setWorkspaceToolsOpen(true);

    const activeTab = findWorkspaceToolTab(workspaceToolTabs, activeWorkspaceToolTabId);
    let targetFilesTabId: string;
    if (activeTab?.kind === "files") {
      targetFilesTabId = activeWorkspaceToolTabId;
    } else {
      const firstFilesId = focusFirstTabOfKind(workspaceToolTabs, "files");
      if (firstFilesId) {
        targetFilesTabId = firstFilesId;
        setActiveWorkspaceToolTabId(firstFilesId);
      } else {
        const added = addWorkspaceToolTab(workspaceToolTabs, "files");
        setWorkspaceToolTabs(added.tabs);
        setActiveWorkspaceToolTabId(added.activeId);
        targetFilesTabId = added.activeId;
      }
    }

    setWorkspaceFilesPlanRevealTargetId(targetFilesTabId);
    setWorkspaceFilesPlanRevealNonce((value) => value + 1);
  }, [
    activeFilePath,
    activeWorkspaceToolTabId,
    snapshot?.plan.exists,
    snapshot?.plan.modifiedAtUnixMs,
    snapshot?.plan,
    workspaceToolTabs,
  ]);
  const composerCursorChars = useMemo(
    () => codeUnitIndexToCharCount(runtime.composer, composerCursorCodeUnits),
    [composerCursorCodeUnits, runtime.composer],
  );
  const fileReferenceQuery = useMemo(
    () => currentWorkspaceFileReferenceQuery(runtime.composer, composerCursorChars),
    [composerCursorChars, runtime.composer],
  );
  const fileReferenceQueryKey = useMemo(
    () =>
      fileReferenceQuery
        ? `${fileReferenceQuery.start}\u0000${fileReferenceQuery.end}\u0000${fileReferenceQuery.raw}`
        : "",
    [fileReferenceQuery],
  );
  const workspaceFileIndex = useWorkspaceFileIndex({
    workspaceRoot: snapshot?.workspaceRoot ?? "",
    workspaceBinding: snapshot?.workspaceBinding ?? "project",
    primeWorkspaceFileReferenceIndex: runtime.primeWorkspaceFileReferenceIndex,
    getWorkspaceFileReferenceIndex: runtime.getWorkspaceFileReferenceIndex,
  });
  const extensionSettingsItems = useMemo(
    () =>
      (snapshot?.extensionsList ?? [])
        .filter((item) => item.desktopSettingsPage)
        .map((item) => ({
          id: item.id,
          label: item.desktopSettingsPage?.title ?? item.displayName,
        })),
    [snapshot?.extensionsList],
  );

  useEffect(() => {
    setSlashSelectedIndex(-1);
  }, [slashQuery]);

  useEffect(() => {
    if (!fileReferenceQuery || dismissedFileReferenceKey === fileReferenceQueryKey) {
      setFileReferenceSuggestions(null);
      setFileReferenceSelectedIndex(-1);
      return;
    }

    if (!workspaceFileIndex.ready) {
      setFileReferenceSuggestions({
        query: fileReferenceQuery,
        suggestions: [],
      });
      return;
    }

    setFileReferenceSuggestions({
      query: fileReferenceQuery,
      suggestions: workspaceFileIndex.search(fileReferenceQuery.raw),
    });
  }, [
    dismissedFileReferenceKey,
    fileReferenceQuery,
    fileReferenceQueryKey,
    workspaceFileIndex.ready,
    workspaceFileIndex.fileCount,
    workspaceFileIndex.search,
  ]);

  useEffect(() => {
    if (slashSuggestions.length === 0) {
      if (slashSelectedIndex !== -1) {
        setSlashSelectedIndex(-1);
      }
      return;
    }
    if (slashSelectedIndex >= slashSuggestions.length) {
      setSlashSelectedIndex(-1);
    }
  }, [slashSelectedIndex, slashSuggestions.length]);

  useEffect(() => {
    const suggestionCount = fileReferenceSuggestions?.suggestions.length ?? 0;
    if (suggestionCount === 0) {
      if (fileReferenceSelectedIndex !== -1) {
        setFileReferenceSelectedIndex(-1);
      }
      return;
    }

    if (fileReferenceSelectedIndex >= suggestionCount) {
      setFileReferenceSelectedIndex(-1);
    }
  }, [fileReferenceSelectedIndex, fileReferenceSuggestions?.suggestions.length]);

  useEffect(() => {
    if (!rewindDraft) {
      return;
    }
    const anchor = messages[rewindDraft.listIndex];
    const stillAvailable =
      anchor?.id === rewindDraft.messageId && anchor.canRewind === true;
    if (!stillAvailable) {
      setRewindDraft(null);
    }
  }, [messages, rewindDraft]);

  const startMessageRewind = (message: ConversationMessageSnapshot, listIndex: number) => {
    if (!runtime.summary.canSend || runtime.busyAction || message.canRewind !== true) {
      return;
    }
    const segments = messageContentToRichSegments(message.content, String(message.id));
    setRewindDraft({
      messageId: message.id,
      listIndex,
      text: segmentsToPlainText(segments),
      browserElementAttachments: segmentsToAttachments(segments),
      localFileAttachments: snapshotsToComposerAttachmentViews(message.localFileAttachments),
    });
  };

  const submitMessageRewind = () => {
    if (!rewindDraft) {
      return;
    }
    const segs = rewindRichInputRef.current?.getSegments() ?? [];
    const wireText = segmentsToMessageText(segs) || rewindDraft.text;
    void runtime
      .rewindAndSubmitMessage({
        messageId: rewindDraft.messageId,
        text: wireText,
        ...(rewindDraft.localFileAttachments.length > 0
          ? { localFilePaths: rewindDraft.localFileAttachments.map((item) => item.path) }
          : {}),
      })
      .then((ok) => {
        if (ok) {
          setRewindDraft(null);
        }
      });
  };

  const applySlashSuggestion = (replacement: string) => {
    runtime.setComposer(replacement);
    setSlashSelectedIndex(-1);
    queueMicrotask(() => {
      composerRichInputRef.current?.focus();
    });
  };

  const applyLoopSlash = useCallback(() => {
    setSlashSelectedIndex(-1);
    void runtime.setLoopEnabled(true);
    runtime.setComposer("");
    composerRichInputRef.current?.insertLoopChip({ clearText: true });
  }, [runtime]);

  const applyPlanSlash = useCallback(() => {
    setSlashSelectedIndex(-1);
    void runtime.saveSettingsPatch({ agentMode: "plan" });
    runtime.setComposer("");
    composerRichInputRef.current?.insertPlanChip({ clearText: true });
  }, [runtime]);

  const applyAskSlash = useCallback(() => {
    setSlashSelectedIndex(-1);
    void runtime.saveSettingsPatch({ agentMode: "ask" });
    runtime.setComposer("");
    composerRichInputRef.current?.insertAskChip({ clearText: true });
  }, [runtime]);

  const applySlashSuggestionItem = useCallback(
    (suggestion: SkillSlashSuggestion) => {
      if (suggestion.kind === "loop") {
        applyLoopSlash();
        return;
      }
      if (suggestion.kind === "plan") {
        applyPlanSlash();
        return;
      }
      if (suggestion.kind === "ask") {
        applyAskSlash();
        return;
      }
      applySlashSuggestion(`${suggestion.alias} `);
    },
    [applyLoopSlash, applyPlanSlash, applyAskSlash],
  );

  const ensureConversationSurface = useCallback(() => {
    setLastNonSettingsSurface("conversation");
    setActiveSurface("conversation");
  }, []);

  const isActionPaletteItemDisabled = useCallback(
    (item: ActionPaletteItem) => {
      if (!runtime.busyAction) {
        return false;
      }
      if (isNewSessionAction(item)) {
        return true;
      }
      return item.kind === "log-session" || item.kind === "compact";
    },
    [runtime.busyAction],
  );

  const runActionPaletteItem = useCallback(
    (item: ActionPaletteItem) => {
      ensureConversationSurface();
      if (isNewSessionAction(item)) {
        handleNewSession();
        return;
      }
      if (item.kind === "loop") {
        applyLoopSlash();
        return;
      }
      if (item.kind === "plan") {
        applyPlanSlash();
        return;
      }
      if (item.kind === "ask") {
        applyAskSlash();
        return;
      }
      if (item.kind === "log-session" || item.kind === "compact") {
        void runtime.sendMessage({ text: item.alias });
        return;
      }
      applySlashSuggestion(`${item.alias} `);
    },
    [
      applyAskSlash,
      applyLoopSlash,
      applyPlanSlash,
      ensureConversationSurface,
      handleNewSession,
      runtime,
    ],
  );

  const applyFileReferenceSuggestion = (path: string) => {
    const query = fileReferenceSuggestions?.query;
    if (!query) {
      return;
    }

    composerRichInputRef.current?.insertWorkspaceFileReference(path, query, true);
    setFileReferenceSelectedIndex(-1);
    setDismissedFileReferenceKey(null);
  };

  const insertComposerText = (text: string) => {
    const selectionStart = composerCursorCodeUnits;
    const selectionEnd = selectionStart;
    const nextValue = `${runtime.composer.slice(0, selectionStart)}${text}${runtime.composer.slice(selectionEnd)}`;
    const nextCursorCodeUnits = selectionStart + text.length;
    runtime.setComposer(nextValue);
    setComposerCursorCodeUnits(nextCursorCodeUnits);
    setSlashSelectedIndex(-1);
    setFileReferenceSelectedIndex(-1);
    setFileReferenceSuggestions(null);
    setDismissedFileReferenceKey(null);
    queueMicrotask(() => {
      composerRichInputRef.current?.focus();
    });
  };

  const insertFileReferenceTrigger = () => {
    insertComposerText("@");
  };

  const insertSkillTriggerFromPalette = () => {
    insertComposerText("/");
  };

  const removeLocalFileAttachment = (path: string) => {
    removeComposerLocalFileAttachment(runtime.setComposerLocalFileAttachments, path);
  };

  const removeRewindLocalFileAttachment = (path: string) => {
    setRewindDraft((current) => {
      if (!current) {
        return current;
      }
      const localFileAttachments = current.localFileAttachments.filter(
        (item) => normalizeAttachmentPath(item.path) !== normalizeAttachmentPath(path),
      );
      return { ...current, localFileAttachments };
    });
  };

  const attachLocalFilePath = useCallback(
    (filePath: string) => {
      appendComposerLocalFileAttachment(runtime.setComposerLocalFileAttachments, filePath, {
        onAfterAttach: () => {
          queueMicrotask(() => {
            composerRichInputRef.current?.focus();
          });
        },
      });
    },
    [runtime.setComposerLocalFileAttachments],
  );

  const handleBrowserElementPicked = useCallback(
    async (attachment: BrowserElementAttachment) => {
      composerRichInputRef.current?.insertAttachment(attachment);
      const base64 = attachment.screenshotDataUrl.replace(/^data:image\/png;base64,/, '');
      const bridge = window.spiritDesktop;
      if (bridge?.ingestBrowserElementScreenshot) {
        const filePath = await bridge.ingestBrowserElementScreenshot(base64);
        if (filePath) {
          attachLocalFilePath(filePath);
        }
      }
    },
    [attachLocalFilePath],
  );

  const attachRewindLocalFilePath = useCallback((filePath: string) => {
    setRewindDraft((current) => {
      if (!current) {
        return current;
      }
      const normalizedPath = normalizeAttachmentPath(filePath);
      if (
        current.localFileAttachments.some(
          (item) => normalizeAttachmentPath(item.path) === normalizedPath,
        )
      ) {
        return current;
      }
      return {
        ...current,
        localFileAttachments: [
          ...current.localFileAttachments,
          composerAttachmentViewFromPath(normalizedPath),
        ],
      };
    });
  }, []);

  const pickLocalFileFromPalette = () => {
    void runtime.pickLocalFile().then((filePath) => {
      if (!filePath) {
        return;
      }
      attachLocalFilePath(filePath);
    });
  };

  const handleComposerPaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      if (activeSessionReadOnly || runtime.hostKind !== "electron") {
        return;
      }

      const hasClipboardImage = Array.from(event.clipboardData?.items ?? []).some(
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      );
      if (!hasClipboardImage) {
        return;
      }

      event.preventDefault();
      void runtime.ingestClipboardImage().then((filePath) => {
        if (filePath) {
          attachLocalFilePath(filePath);
        }
      });
    },
    [activeSessionReadOnly, attachLocalFilePath, runtime],
  );

  const handleRewindComposerPaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      if (activeSessionReadOnly || runtime.hostKind !== "electron" || !rewindDraft) {
        return;
      }

      const hasClipboardImage = Array.from(event.clipboardData?.items ?? []).some(
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      );
      if (!hasClipboardImage) {
        return;
      }

      event.preventDefault();
      void runtime.ingestClipboardImage().then((filePath) => {
        if (filePath) {
          attachRewindLocalFilePath(filePath);
        }
      });
    },
    [activeSessionReadOnly, attachRewindLocalFilePath, rewindDraft, runtime],
  );

  const pickRewindLocalFileFromPalette = () => {
    void runtime.pickLocalFile().then((filePath) => {
      if (!filePath) {
        return;
      }
      attachRewindLocalFilePath(filePath);
    });
  };

  const submitComposerMessage = () => {
    const segs = composerRichInputRef.current?.getSegments() ?? [];
    const fullText = segmentsToMessageText(segs) || runtime.composer;
    const payload = {
      text: fullText,
      ...(runtime.composerLocalFileAttachments.length > 0
        ? {
            localFilePaths: runtime.composerLocalFileAttachments.map((item) => item.path),
          }
        : {}),
    };

    if (
      isEmptySession &&
      snapshot?.git.isRepository &&
      snapshot.git.workLocation === "local"
    ) {
      const selectedBranch = snapshot.git.selectedBranch ?? snapshot.git.branch;
      if (selectedBranch && snapshot.git.branch && selectedBranch !== snapshot.git.branch) {
        pendingComposerSendRef.current = payload;
        setBranchCheckoutDialogOpen(true);
        return;
      }
    }

    void runtime.sendMessage(payload).then((ok) => {
      if (ok) {
        setComposerBrowserElementAttachments([]);
        composerRichInputRef.current?.resetAfterSend(runtime.settings.agentMode);
      }
    });
  };

  const confirmBranchCheckoutAndSend = () => {
    void (async () => {
      const pending = pendingComposerSendRef.current;
      const selectedBranch = snapshot?.git.selectedBranch ?? snapshot?.git.branch;
      if (!pending || !selectedBranch) {
        setBranchCheckoutDialogOpen(false);
        return;
      }

      const result = await runtime.checkoutGitBranch(selectedBranch);
      if (result.ok) {
        pendingComposerSendRef.current = null;
        setBranchCheckoutBlockedByChanges(false);
        setBranchCheckoutDialogOpen(false);
        void runtime.sendMessage(pending).then((ok) => {
          if (ok) {
            composerRichInputRef.current?.resetAfterSend(runtime.settings.agentMode);
          }
        });
        return;
      }

      if (result.reason === "local-changes") {
        setBranchCheckoutBlockedByChanges(true);
        return;
      }
    })();
  };

  const discardBranchChangesAndCheckoutSend = () => {
    void (async () => {
      const pending = pendingComposerSendRef.current;
      const selectedBranch = snapshot?.git.selectedBranch ?? snapshot?.git.branch;
      if (!pending || !selectedBranch) {
        setBranchCheckoutDialogOpen(false);
        return;
      }

      const result = await runtime.checkoutGitBranch(selectedBranch, { discardLocalChanges: true });
      if (!result.ok) {
        return;
      }

      pendingComposerSendRef.current = null;
      setBranchCheckoutBlockedByChanges(false);
      setBranchCheckoutDialogOpen(false);
      void runtime.sendMessage(pending).then((ok) => {
        if (ok) {
          composerRichInputRef.current?.resetAfterSend(runtime.settings.agentMode);
        }
      });
    })();
  };

  const handleComposerSuggestionKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const fileReferenceItems = fileReferenceSuggestions?.suggestions ?? [];
    if (fileReferenceItems.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setFileReferenceSelectedIndex((current) => {
          if (current < 0) {
            return 0;
          }
          return (current + 1) % fileReferenceItems.length;
        });
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setFileReferenceSelectedIndex((current) =>
          current <= 0 ? fileReferenceItems.length - 1 : current - 1,
        );
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedFileReferenceKey(fileReferenceQueryKey);
        setFileReferenceSelectedIndex(-1);
        setFileReferenceSuggestions(null);
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        const selected = fileReferenceItems[fileReferenceSelectedIndex] ?? fileReferenceItems[0];
        if (selected) {
          applyFileReferenceSuggestion(selected);
        }
        return;
      }

      if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        const selected = fileReferenceItems[fileReferenceSelectedIndex] ?? fileReferenceItems[0];
        if (selected) {
          applyFileReferenceSuggestion(selected);
        }
        return;
      }
    }

    if (!slashQuery || slashSuggestions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSlashSelectedIndex((current) => {
        if (current < 0) {
          return 0;
        }
        return (current + 1) % slashSuggestions.length;
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSlashSelectedIndex((current) =>
        current <= 0 ? slashSuggestions.length - 1 : current - 1,
      );
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      const selected = slashSuggestions[slashSelectedIndex] ?? slashSuggestions[0];
      if (selected) {
        applySlashSuggestionItem(selected);
      }
      return;
    }

    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      const selected = slashSuggestions[slashSelectedIndex] ?? slashSuggestions[0];
      if (selected) {
        applySlashSuggestionItem(selected);
      }
    }
  };

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    handleComposerSuggestionKeyDown(event);
    if (event.defaultPrevented) {
      return;
    }
    if (
      pendingApproval &&
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      runtime.busyAction !== "approve"
    ) {
      event.preventDefault();
      void runtime.submitApproval({ kind: "allow" });
    }
  };

  const launchSplashActive =
    snapshot === null &&
    !runtime.hostConnectionError.trim() &&
    !runtime.runtimeError.trim();

  if (runtime.webHostPairingRequired && runtime.hostKind === "web" && !snapshot) {
    return (
      <WebHostPairingGate
        busy={runtime.busyAction === "bootstrap"}
        error={runtime.runtimeError}
        onPair={runtime.pairWebHost}
      />
    );
  }

  return (
    <SessionSidebarChromeProvider apiRef={sessionSidebarChromeApiRef}>
    <div
      data-spirit-surface="app-shell"
      data-spirit-shell-kind={isElectronShell ? "electron" : "web"}
      data-spirit-theme={resolveDark(theme) ? "dark" : "light"}
      data-spirit-mica={useMicaBackdrop ? "true" : "false"}
      className={cn(
        "flex h-[100dvh] min-h-0 flex-col text-foreground",
        useMicaBackdrop ? "bg-transparent" : "bg-background",
      )}
    >
      <LaunchSplash active={launchSplashActive} />
      {winElectronChrome ? (
        <DesktopTitleBar useMicaBackdrop={useMicaBackdrop} />
      ) : null}
      <div data-spirit-surface="app-body" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!winElectronChrome ? (
          <div
            className={cn(
              "h-px w-full shrink-0",
              // 非 Electron：壳顶部分隔线
              useMicaBackdrop
                ? "bg-black/5 dark:bg-white/10"
                : "bg-border/30 dark:bg-white/12",
            )}
            role="separator"
            aria-orientation="horizontal"
          />
        ) : null}
        <div data-spirit-surface="main-frame" className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <SessionSidebarShell useMicaBackdrop={useMicaBackdrop}>
          <SessionSidebar
            narrow={false}
            mode={settingsMode ? "settings" : "sessions"}
            userHomeDirectory={snapshot?.userHomeDirectory ?? null}
            sessions={runtime.sessions}
            activeFilePath={activeFilePath}
            onNewSession={handleNewSession}
            onSelectSession={(path) => {
              setLastNonSettingsSurface("conversation");
              setActiveSurface("conversation");
              void runtime.openSession(path);
            }}
            onOpenMarketplace={() => {
              sessionSidebarChromeApiRef.current?.openSidebar();
              setLastNonSettingsSurface("marketplace");
              setActiveSurface("marketplace");
            }}
            onOpenSettings={() => {
              sessionSidebarChromeApiRef.current?.openSidebar();
              if (activeSurface !== "settings") {
                setLastNonSettingsSurface(activeSurface === "marketplace" ? "marketplace" : "conversation");
              }
              setActiveSurface("settings");
            }}
            onBackToSessions={() => setActiveSurface(lastNonSettingsSurface)}
            marketplaceActive={marketplaceMode}
            settingsTab={settingsTab}
            extensionSettingsId={extensionSettingsId}
            extensionSettingsItems={extensionSettingsItems}
            onSettingsTabChange={(tab) => {
              setExtensionSettingsId(null);
              setSettingsTab(tab);
            }}
            onExtensionSettingsChange={(id) => setExtensionSettingsId(id)}
            micaStyle={useMicaBackdrop}
            newSessionBusy={newSessionBusy}
            sessionNavigationBusy={sessionNavigationBusy}
            deleteSessionBusy={sessionNavigationBusy}
            onDeleteSession={(path) => {
              void runtime.deleteSession(path);
            }}
            unseenCompletedSessionPaths={runtime.unseenCompletedSessionPaths}
          />
        </SessionSidebarShell>

        {settingsMode ? (
          <div data-spirit-surface="settings-shell" className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
            <DesktopLayoutChromeBar
              useMicaBackdrop={useMicaBackdrop}
              showWorkspaceToggle={false}
            />
            <SettingsView
              tab={settingsTab}
              extensionSettingsId={extensionSettingsId}
              theme={theme}
              onThemeChange={setTheme}
              font={font}
              onFontChange={setFont}
              settings={runtime.settings}
              snapshot={snapshot}
              runtimeError={runtime.runtimeError}
              apiReady={runtime.apiReady}
              busyAction={runtime.busyAction}
              modelsBusy={runtime.busyAction === "models"}
              modelsPreviewBusy={runtime.busyAction === "modelsPreview"}
              mcpsBusy={runtime.busyAction === "mcps"}
              skillsBusy={runtime.busyAction === "skills"}
              rulesBusy={runtime.busyAction === "rules"}
              extensionsBusy={runtime.busyAction === "extensions"}
              lspInstallBusy={runtime.lspInstallBusy}
              isElectronShell={isElectronShell}
              onSavePatch={runtime.saveSettingsPatch}
              onInstallLspProvider={runtime.installLspProvider}
              onResetWebHostPairing={runtime.resetWebHostPairing}
              onAddModel={runtime.addModel}
              onAddProviderModels={runtime.addProviderModels}
              onPreviewModels={runtime.previewModels}
              onRemoveModel={runtime.removeModel}
              onRemoveProviderModels={runtime.removeProviderModels}
              onAddMcpServer={runtime.addMcpServer}
              onImportExtension={runtime.importExtension}
              onDeleteExtension={runtime.deleteExtension}
              onUpdateExtensionSettings={runtime.updateExtensionSettings}
              onUpdateExtensionSecret={runtime.updateExtensionSecret}
              onDeleteMcpServer={runtime.deleteMcpServer}
              onInspectMcpServer={runtime.inspectMcpServer}
              onCreateSkill={runtime.createSkill}
              onCreateRule={runtime.createRule}
              onStartCompactionUiDemo={() => {
                setActiveSurface("conversation");
                compactionDemo.start();
              }}
              onDeleteSkill={runtime.deleteSkill}
              onDeleteRule={runtime.deleteRule}
              onListDreamsOverview={runtime.listDreamsOverview}
              onGenerateSkillNavigate={() => {
                setLastNonSettingsSurface("conversation");
                setActiveSurface("conversation");
                applySlashSuggestion(`${CREATE_SKILL_SLASH_ALIAS} `);
              }}
              onGenerateRuleNavigate={() => {
                setLastNonSettingsSurface("conversation");
                setActiveSurface("conversation");
                applySlashSuggestion(`${CREATE_RULE_SLASH_ALIAS} `);
              }}
            />
          </div>
        ) : marketplaceMode ? (
          <div data-spirit-surface="marketplace-layout" className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
            <DesktopLayoutChromeBar
              useMicaBackdrop={useMicaBackdrop}
              showWorkspaceToggle={false}
            />
            <MarketplaceView
              snapshot={snapshot}
              apiReady={runtime.apiReady}
              busyAction={runtime.busyAction}
              runtimeError={runtime.runtimeError}
              onListMarketplaceExtensions={runtime.listMarketplaceExtensions}
              onGetMarketplaceExtensionDetail={runtime.getMarketplaceExtensionDetail}
              onGetMarketplaceExtensionReadme={runtime.getMarketplaceExtensionReadme}
              onPrepareMarketplaceExtensionInstall={runtime.prepareMarketplaceExtensionInstall}
              onInstallMarketplaceExtension={runtime.installMarketplaceExtension}
            />
          </div>
        ) : (
          <div data-spirit-surface="conversation-layout" className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden bg-background min-w-0">
            <div data-spirit-surface="conversation-shell" className="flex min-h-0 min-w-0 flex-1 flex-col bg-background min-w-0">
              <DesktopLayoutChromeBar
                useMicaBackdrop={useMicaBackdrop}
                showWorkspaceToggle
                workspaceToolsOpen={workspaceToolsOpen}
                onToggleWorkspaceTools={() => setWorkspaceToolsOpen((c) => !c)}
                sessionTitle={isEmptySession ? null : snapshot?.activeSession?.displayName}
                subagentPromptText={
                  subagentViewActive ? snapshot?.subagentViewer?.promptText : null
                }
                onExitSubagentViewer={
                  subagentViewActive
                    ? () => {
                        void subagentViewer.close();
                      }
                    : undefined
                }
                onNewSession={isEmptySession ? undefined : handleNewSession}
                newSessionBusy={newSessionBusy}
              />
            <div data-spirit-surface="conversation-stage" className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background text-sm">
              {compactionDemo.active ? (
                <div
                  data-spirit-surface="compaction-ui-demo-banner"
                  className="shrink-0 bg-background"
                >
                  <div
                    className={cn(
                      "mx-auto flex w-full flex-wrap items-center justify-between gap-2 py-2",
                      CONVERSATION_GUTTER_X,
                      CONVERSATION_MAX_W,
                    )}
                  >
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{t('app.compactionDemo')}</span>
                      <span className="hidden sm:inline">
                        {" "}
                        · {t('app.compactionDemoDescription')}
                      </span>
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={compactionDemo.stop}>
                      {t('app.exitDemo')}
                    </Button>
                  </div>
                </div>
              ) : null}
              {rewindDraft ? (
                <button
                  type="button"
                  aria-label={t('app.cancelRewind')}
                  className="fixed inset-0 z-30 cursor-default bg-background/35 backdrop-blur-sm"
                  onClick={() => setRewindDraft(null)}
                />
              ) : null}
              <ScrollArea
                data-spirit-surface="conversation-scroll"
                className="min-h-0 flex-1 bg-background"
                type="hover"
                scrollHideDelay={450}
              >
                {/* min-h-full：短内容仍铺满视口；pb ≥ dock 实测高度 + 留白，审批卡弹出时同步增高 */}
                <div
                  data-spirit-surface="conversation-scroll-body"
                  className="min-h-full w-full bg-background"
                  style={
                    !isEmptySession || subagentViewActive
                      ? { paddingBottom: conversationScrollBedPaddingPx }
                      : undefined
                  }
                >
                  {!isEmptySession || subagentViewActive ? (
                    <div
                      data-spirit-surface="conversation-list-shell"
                      className={cn(
                        "mx-auto w-full overflow-x-hidden pt-6 sm:pt-7",
                        CONVERSATION_GUTTER_X,
                        CONVERSATION_MAX_W,
                      )}
                    >
                      <ToolCallDiffHostProvider
                        value={{
                          workspaceRoot: snapshot?.workspaceRoot ?? "",
                          readWorkspaceTextFile: runtime.readWorkspaceTextFile,
                        }}
                      >
                      <div
                        key={`${composerSessionKey || "__no-session__"}:${conversationListScopeKey}:e${conversationListRemountEpoch}`}
                        data-spirit-surface="conversation-list"
                        className="space-y-3"
                      >
                        {subagentViewActive && messages.length === 0 ? (
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            {t("app.subagentViewerEmpty")}
                          </p>
                        ) : null}
                        {messages.map((message, index) => {
                          const previous = messages[index - 1];
                          const compactAfterPrevious = shouldCompactAfterPreviousMessage(previous, message);
                          const tightenAfterPreviousMeta = shouldTightenAfterPreviousMetaMessage(previous, message);
                          return (
                            <MessageCard
                              key={conversationMessageStableId(message, composerSessionKey, conversationListScopeKey)}
                              composerSessionKey={composerSessionKey}
                              conversationListScopeKey={conversationListScopeKey}
                              messages={messages}
                              pendingAuxState={conversationPendingAuxState}
                              listIndex={index}
                              message={message}
                              compactAfterPrevious={compactAfterPrevious}
                              tightenAfterPreviousMeta={tightenAfterPreviousMeta}
                              showContinueButton={
                                turnContinue?.showContinueAtIndex === index &&
                                !activeSessionReadOnly &&
                                snapshot?.conversation.isBusy !== true
                              }
                              continueTarget={turnContinue?.continuableMessage}
                              continueBusy={continueBusy}
                              rewindSelected={rewindDraft?.listIndex === index}
                              rewindText={
                                rewindDraft?.listIndex === index ? rewindDraft.text : ""
                              }
                              rewindLocalFileAttachments={
                                rewindDraft?.listIndex === index
                                  ? rewindDraft.localFileAttachments
                                  : []
                              }
                              rewindBrowserElementAttachments={
                                rewindDraft?.listIndex === index
                                  ? rewindDraft.browserElementAttachments
                                  : []
                              }
                              rewindRichInputRef={rewindRichInputRef}
                              onRewindElementAttachmentsChange={(attachments) => {
                                setRewindDraft((current) =>
                                  current && current.listIndex === index
                                    ? { ...current, browserElementAttachments: attachments }
                                    : current,
                                );
                              }}
                              rewindCanSubmit={
                                runtime.summary.canSend &&
                                runtime.busyAction !== "rewind" &&
                                runtime.busyAction !== "session" &&
                                rewindDraft?.listIndex === index &&
                                (Boolean(rewindDraft.text.trim()) ||
                                  rewindDraft.browserElementAttachments.length > 0 ||
                                  rewindDraft.localFileAttachments.length > 0)
                              }
                              canPickLocalFile={runtime.hostKind === "electron"}
                              rewindBusy={runtime.busyAction === "rewind"}
                              models={models}
                              catalogHints={snapshot?.config.modelCatalogHints}
                              activeModel={runtime.settings.activeModel}
                              agentMode={runtime.settings.agentMode}
                              onContinue={(targetMessage) => {
                                void runtime.continueAssistantCompletion(targetMessage.id);
                              }}
                              onRewindStart={startMessageRewind}
                              onRewindChange={(value) => {
                                setRewindDraft((current) =>
                                  current ? { ...current, text: value } : current,
                                );
                              }}
                              onRewindSubmit={submitMessageRewind}
                              onRewindRemoveLocalFileAttachment={removeRewindLocalFileAttachment}
                              onRewindPickLocalFile={pickRewindLocalFileFromPalette}
                              onRewindPaste={handleRewindComposerPaste}
                              onModelSelect={runtime.setActiveModel}
                              onModelReasoningEffortSelect={runtime.setModelReasoningEffort}
                              onAgentModeChange={handleComposerAgentModeChange}
                              readManagedImagePreviewDataUrl={runtime.readManagedImagePreviewDataUrl}
                              readManagedVideoPreviewUrl={runtime.readManagedVideoPreviewUrl}
                              readLocalImagePreviewDataUrl={runtime.readLocalImagePreviewDataUrl}
                              readLocalVideoPreviewUrl={runtime.readLocalVideoPreviewUrl}
                              saveLocalImageAs={runtime.saveLocalImageAs}
                              onOpenSubagentViewer={
                                subagentViewActive ? undefined : handleOpenSubagentViewer
                              }
                            />
                          );
                        })}
                      </div>
                      </ToolCallDiffHostProvider>
                    </div>
                  ) : null}
                </div>
              </ScrollArea>

              <div
                ref={composerDockRef}
                data-spirit-surface="composer-dock"
                className={cn(
                  "pointer-events-none absolute inset-x-0 z-10 bg-transparent",
                  isEmptySession
                    ? cn(
                        "inset-y-0 flex items-center justify-center pb-[env(safe-area-inset-bottom,0px)]",
                        CONVERSATION_GUTTER_X,
                      )
                    : "bottom-0 pt-2 pb-0",
                )}
              >
                <div
                  className={cn(
                    "pointer-events-auto mx-auto w-full",
                    CONVERSATION_GUTTER_X,
                    CONVERSATION_MAX_W,
                  )}
                >
                {isEmptySession ? (
                  <div data-spirit-surface="conversation-empty">
                    <p
                      className="mb-6 text-center text-2xl font-medium tracking-tight text-foreground sm:text-3xl"
                      data-testid="empty-session-greeting"
                    >
                      {emptySessionGreeting}
                    </p>
                  </div>
                ) : null}
                <div className="space-y-2">
                {showWorkspaceBindingControls ? (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5">
                    <EmptyStateWorkspaceSelector
                      currentWorkspaceRoot={snapshot?.workspaceRoot ?? ""}
                      workspaceBinding={snapshot?.workspaceBinding ?? "project"}
                      availableWorkspaces={snapshot?.availableWorkspaces ?? []}
                      disabled={runtime.busyAction === "bootstrap" || runtime.busyAction === "session"}
                      onSelectWorkspace={(workspaceRoot) => {
                        if (
                          snapshot?.workspaceBinding === "project"
                          && snapshot.workspaceRoot
                          && sameWorkspacePath(snapshot.workspaceRoot, workspaceRoot)
                        ) {
                          return;
                        }
                        void runtime.switchWorkspaceRoot(workspaceRoot);
                      }}
                      onSelectNoWorkspace={() => {
                        if (snapshot?.workspaceBinding === "none") {
                          return;
                        }
                        void runtime.switchToNoWorkspaceBinding();
                      }}
                      onAddWorkspace={() => {
                        void (async () => {
                          const workspaceRoot = await runtime.pickWorkspaceDirectory();
                          if (!workspaceRoot) {
                            return;
                          }
                          await runtime.rememberWorkspaceRoot(workspaceRoot);
                        })();
                      }}
                    />
                    {isEmptySession ? (
                    <>
                    <BranchSelectMenu
                      branches={snapshot?.git.branches ?? []}
                      selectedBranch={snapshot?.git.selectedBranch}
                      currentBranch={snapshot?.git.branch}
                      disabled={
                        runtime.busyAction === "bootstrap"
                        || runtime.busyAction === "session"
                        || commitBusy
                      }
                      onBranchChange={(branch) => {
                        void runtime.setPendingGitBranch(branch);
                      }}
                    />
                    <WorkLocationMenu
                      workLocation={snapshot?.git.workLocation ?? "local"}
                      disabled={
                        runtime.busyAction === "bootstrap"
                        || runtime.busyAction === "session"
                        || commitBusy
                        || snapshot?.git.isRepository !== true
                      }
                      onWorkLocationChange={(workLocation) => {
                        void runtime.setWorkLocation(workLocation);
                      }}
                    />
                    <ApprovalLevelMenu
                      approvalLevel={snapshot?.conversation.approvalLevel ?? "default"}
                      disabled={activeSessionReadOnly}
                      onApprovalLevelChange={(level) => {
                        void runtime.setApprovalLevel(level);
                      }}
                    />
                    </>
                    ) : null}
                  </div>
                ) : null}
                {runtime.runtimeError ? (
                  <div className="rounded-md border border-destructive/35 bg-destructive/10 px-2.5 py-2 text-xs leading-relaxed text-destructive">
                    {runtime.runtimeError}
                  </div>
                ) : null}

                {rewindWarnings.length > 0 ? (
                  <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-100">
                    <p>{t('app.rewindComplete', { count: rewindWarnings.length })}</p>
                    <p className="mt-1 truncate" title={rewindWarnings[0]?.message}>
                      {rewindWarnings[0]?.path}: {rewindWarnings[0]?.message}
                    </p>
                  </div>
                ) : null}

                {showPendingApprovalInComposer && pendingApproval ? (
                  <PendingApprovalCard
                    pendingApproval={pendingApproval}
                    approvalGuidance={runtime.approvalGuidance}
                    approveBusy={runtime.busyAction === "approve"}
                    onApprovalGuidanceChange={runtime.setApprovalGuidance}
                    onSubmitApproval={(decision) => {
                      if (decision.kind === "allow") {
                        void runtime.submitApproval({
                          kind: "allow",
                          ...(decision.persistTrust ? { persistTrust: true } : {}),
                        });
                        return;
                      }
                      if (decision.kind === "deny") {
                        void runtime.submitApproval({ kind: "deny" });
                        return;
                      }
                      void runtime.submitApproval({
                        kind: "guidance",
                        userMessage: decision.userMessage ?? "",
                      });
                    }}
                  />
                ) : null}

                <div className="relative">
                <div className="relative z-10 flex flex-col">
                  {snapshot?.conversation.todos ? (
                    <div className="relative z-20 mx-4 -mb-px shrink-0">
                      <ComposerTodoCard
                        todos={snapshot.conversation.todos}
                        sessionKey={snapshot.composerSessionKey}
                      />
                    </div>
                  ) : null}
                  {fileReferenceSuggestions ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-full z-20 pb-2">
                      <div className="pointer-events-auto">
                        <WorkspaceFileReferenceMenu
                          suggestions={fileReferenceSuggestions.suggestions}
                          selectedIndex={fileReferenceSelectedIndex}
                          onSelectIndex={setFileReferenceSelectedIndex}
                          onApplySuggestion={applyFileReferenceSuggestion}
                        />
                      </div>
                    </div>
                  ) : null}
                  {slashQuery ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-full z-20 pb-2">
                      <div className="pointer-events-auto">
                        <SkillSlashMenu
                          suggestions={slashSuggestions}
                          selectedIndex={slashSelectedIndex}
                          onSelectIndex={setSlashSelectedIndex}
                          onApplySuggestion={applySlashSuggestionItem}
                        />
                      </div>
                    </div>
                  ) : null}
                  <ComposerSurface
                    value={runtime.composer}
                    onChange={runtime.setComposer}
                    onSubmit={submitComposerMessage}
                    browserElementAttachments={composerBrowserElementAttachments}
                    onElementAttachmentsChange={setComposerBrowserElementAttachments}
                    onAbort={() => void runtime.abortConversation()}
                    placeholder={composerPlaceholder}
                    localFileAttachments={runtime.composerLocalFileAttachments}
                    models={models}
                    catalogHints={snapshot?.config.modelCatalogHints}
                    activeModel={runtime.settings.activeModel}
                    agentMode={runtime.settings.agentMode}
                    loopEnabled={snapshot?.conversation.loopEnabled === true}
                    onModelSelect={runtime.setActiveModel}
                    onModelReasoningEffortSelect={runtime.setModelReasoningEffort}
                    onAgentModeChange={handleComposerAgentModeChange}
                    onLoopEnabledChange={(enabled) => {
                      void runtime.setLoopEnabled(enabled);
                    }}
                    richInputRef={composerRichInputRef}
                    onKeyDown={handleComposerKeyDown}
                    onSelectionChange={(selectionStart) => {
                      if (selectionStart !== null) {
                        setComposerCursorCodeUnits(selectionStart);
                      }
                    }}
                    canSend={composerCanSend}
                    canAbort={conversationInterruptible}
                    busy={runtime.busyAction === "send" && !conversationInterruptible}
                    conversationBusy={continueBusy}
                    agentModeChipDismissed={runtime.agentModeChipDismissed}
                    onAgentModeChipDismissChange={runtime.setAgentModeChipDismissed}
                    readOnly={activeSessionReadOnly}
                    showInsertButton
                    canPickLocalFile={runtime.hostKind === "electron"}
                    onInsertWorkspaceFileReferenceTrigger={insertFileReferenceTrigger}
                    onPickLocalFile={pickLocalFileFromPalette}
                    onInsertSkillTrigger={insertSkillTriggerFromPalette}
                    onRemoveLocalFileAttachment={removeLocalFileAttachment}
                    onPaste={handleComposerPaste}
                  />
                </div>
                  {!isEmptySession ? (
                    <div
                      className={cn(
                        "pointer-events-none relative z-0 -mt-4 bg-background pt-[calc(1rem+0.375rem)] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]",
                        CONVERSATION_GUTTER_NEG_X,
                        CONVERSATION_GUTTER_X,
                      )}
                    >
                      <div className="pointer-events-auto relative z-[11] flex items-center justify-between gap-3 px-3">
                        <ApprovalLevelMenu
                          approvalLevel={snapshot?.conversation.approvalLevel ?? "default"}
                          disabled={activeSessionReadOnly}
                          onApprovalLevelChange={(level) => {
                            void runtime.setApprovalLevel(level);
                          }}
                        />
                        <ComposerContextUsageRing
                          usage={snapshot?.conversation.contextUsage}
                        />
                      </div>
                      {snapshot?.conversation.pendingQuestions ? (
                        <p className="px-0.5 text-xs leading-relaxed text-muted-foreground">
                          {t('app.completeQuestionsAbove')}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                </div>
                </div>
              </div>
            </div>
            </div>
            <div data-spirit-surface="workspace-dock">
            <WorkspaceToolsDock
              workspaceRoot={snapshot?.workspaceRoot ?? ""}
              listExplorerChildren={runtime.listWorkspaceExplorerChildren}
              readWorkspaceTextFile={runtime.readWorkspaceTextFile}
              writeWorkspaceTextFile={runtime.writeWorkspaceTextFile}
              readHostTextFile={runtime.readHostTextFile}
              writeHostTextFile={runtime.writeHostTextFile}
              readManagedImagePreviewDataUrl={runtime.readManagedImagePreviewDataUrl}
              plan={snapshot?.plan ?? { path: "", exists: false }}
              onStartImplementing={() => {
                void runtime.submitStartImplementing();
              }}
              startImplementingDisabled={
                startImplementingDisabled || !snapshot?.plan?.exists
              }
              autoRevealPlanNonce={workspaceFilesPlanRevealNonce}
              planRevealTabId={workspaceFilesPlanRevealTargetId}
              autoRevealFileNonce={workspaceFileRevealNonce}
              fileRevealTabId={workspaceFileRevealTargetId}
              fileRevealPath={workspaceFileRevealPath}
              fileRevealAbsolutePath={workspaceFileRevealAbsolutePath}
              fileRevealScope={workspaceFileRevealScope}
              fileRevealViewMode={workspaceFileRevealViewMode}
              onOpenWorkspaceFile={openWorkspaceFile}
              tabs={workspaceToolTabs}
              activeTabId={activeWorkspaceToolTabId}
              onTabsChange={setWorkspaceToolTabs}
              onActiveTabIdChange={setActiveWorkspaceToolTabId}
              onBrowserElementPicked={handleBrowserElementPicked}
              onBrowserOpenInNewTab={openBrowserUrlInNewTab}
              browserTabEnabled={browserTabEnabled}
              open={workspaceToolsOpen}
              widthPx={workspaceToolsWidthPx}
              onWidthPxChange={setWorkspaceToolsWidthPx}
              gitSnapshot={snapshot?.git}
              gitChipBusy={gitChipBusy}
              readGitWorkingTree={runtime.readGitWorkingTree}
              readGitHistory={runtime.readGitHistory}
              submitGitChip={runtime.submitGitChip}
            />
            </div>
          </div>
        )}
        </div>
      </div>

      <ActionPickerDialog
        open={actionPickerOpen}
        onOpenChange={setActionPickerOpen}
        onSelect={runActionPaletteItem}
        isItemDisabled={isActionPaletteItemDisabled}
      />

      <WorkspaceFilePickerDialog
        open={filePickerOpen}
        onOpenChange={setFilePickerOpen}
        workspaceRoot={snapshot?.workspaceRoot ?? ''}
        workspaceBinding={snapshot?.workspaceBinding ?? 'project'}
        onOpenWorkspaceFile={(relativePath) => {
          openWorkspaceFile(relativePath, {
            viewMode: isMarkdownPath(relativePath) ? "preview" : "edit",
          });
        }}
        onOpenExternalFile={(absolutePath) => {
          openEditorFile({
            scope: "external",
            absolutePath,
            viewMode: isMarkdownPath(absolutePath) ? "preview" : "edit",
          });
        }}
        statHostTextFile={runtime.statHostTextFile}
        indexReady={workspaceFileIndex.ready}
        searchWorkspaceFiles={workspaceFileIndex.search}
      />

      <Dialog open={Boolean(pendingQuestions)}>
        <DialogContent className="max-w-4xl p-0" showCloseButton={false}>
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>
              {pendingQuestions?.request.title ?? t('app.needMoreQuestions')}
            </DialogTitle>
            <DialogDescription>
              {t('app.questionnaireDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="spirit-scroll max-h-[70vh] space-y-4 overflow-y-auto px-6 py-2">
            {pendingQuestions?.request.questions.map((question) => {
              const draft =
                runtime.questionDrafts[question.id] ?? {
                  selectedOptionIndexes: [],
                  customInput: "",
                  text: "",
                };

              return (
                <AskQuestionField
                  key={question.id}
                  draft={draft}
                  question={question}
                  onCustomInputChange={(value) =>
                    runtime.updateQuestionDraft(question.id, (current) => ({
                      ...current,
                      customInput: value,
                    }))
                  }
                  onMultiSelectToggle={(index, checked) =>
                    runtime.updateQuestionDraft(question.id, (current) => {
                      const next = checked
                        ? [...current.selectedOptionIndexes, index]
                        : current.selectedOptionIndexes.filter((item) => item !== index);
                      return {
                        ...current,
                        selectedOptionIndexes: Array.from(new Set(next)).sort(
                          (left, right) => left - right,
                        ),
                      };
                    })
                  }
                  onRadioSelect={(index) =>
                    runtime.updateQuestionDraft(question.id, (current) => ({
                      ...current,
                      selectedOptionIndexes: [index],
                    }))
                  }
                  onTextChange={(value) =>
                    runtime.updateQuestionDraft(question.id, (current) => ({
                      ...current,
                      text: value,
                    }))
                  }
                />
              );
            })}

            {runtime.questionError ? (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                {runtime.questionError}
              </div>
            ) : null}
          </div>

          <DialogFooter className="mt-0" showCloseButton={false}>
            <Button
              variant="outline"
              onClick={() => void runtime.skipQuestions()}
              disabled={runtime.busyAction === "questions"}
            >
              {t('app.skip')}
            </Button>
            <Button
              onClick={() => void runtime.submitQuestions()}
              disabled={runtime.busyAction === "questions"}
            >
              {runtime.busyAction === "questions" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              {t('app.submitAnswers')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={branchCheckoutDialogOpen}
        onOpenChange={(open) => {
          setBranchCheckoutDialogOpen(open);
          if (!open) {
            pendingComposerSendRef.current = null;
            setBranchCheckoutBlockedByChanges(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>
              {branchCheckoutBlockedByChanges ? t('app.cannotSwitchBranch') : t('app.switchBranch')}
            </DialogTitle>
            <DialogDescription>
              {branchCheckoutBlockedByChanges ? (
                <>
                  {t('app.uncommittedChangesCannotSwitch', { branch: snapshot?.git.selectedBranch ?? snapshot?.git.branch ?? '' })}
                  {t('app.discardChangesWarning')}
                </>
              ) : (
                <>
                  {t('app.willSwitchBranch', { branch: snapshot?.git.selectedBranch ?? snapshot?.git.branch ?? '' })}
                  {snapshot?.git.hasChanges
                    ? ` ${t('app.uncommittedChangesMayFail')}`
                    : null}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {runtime.runtimeError ? (
            <p className="text-sm leading-relaxed text-destructive">{runtime.runtimeError}</p>
          ) : null}
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                pendingComposerSendRef.current = null;
                setBranchCheckoutBlockedByChanges(false);
                setBranchCheckoutDialogOpen(false);
              }}
              disabled={commitBusy}
            >
              {t('common.cancel')}
            </Button>
            {branchCheckoutBlockedByChanges ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={discardBranchChangesAndCheckoutSend}
                disabled={commitBusy}
              >
                {commitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t('app.discardAndSwitch')}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={confirmBranchCheckoutAndSend}
                disabled={commitBusy}
              >
                {commitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t('app.switchAndSend')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
    </SessionSidebarChromeProvider>
  );
}
