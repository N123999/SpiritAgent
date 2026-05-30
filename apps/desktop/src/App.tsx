import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  modelReasoningEffortOptions,
  modelReasoningEffortLabel,
} from "@spirit-agent/agent-core/reasoning-effort";
import {
  charCountToCodeUnitIndex,
  codeUnitIndexToCharCount,
  currentWorkspaceFileReferenceQuery,
  replaceWorkspaceFileReferenceQuery,
} from "@spirit-agent/host-internal/workspace-file-reference-query";

import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FolderPlus,
  LoaderCircle,
  Maximize2,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { MarkdownMessage } from "@/components/markdown-message";
import { MarketplaceView } from "@/components/marketplace-view";
import {
  ComposerLocalFileStrip,
  type ComposerLocalFileAttachmentView,
} from "@/components/composer-local-file-strip";
import { ComposerInsertMenu } from "@/components/composer-insert-menu";
import { ApprovalLevelMenu } from "@/components/approval-level-menu";
import { BranchSelectMenu } from "@/components/branch-select-menu";
import { WorkLocationMenu } from "@/components/work-location-menu";
import { SkillSlashMenu } from "@/components/skill-slash-menu";
import { SettingsView } from "@/components/settings-view";
import { MinimalToolCallCard } from "@/components/minimal-tool-call-card";
import { isMinimalToolCallMessage, toolHasExpandableContent } from "@/lib/tool-call-display";
import { isSubagentStatusSurfaceMessage } from "@/lib/subagent-display";
import {
  isGrayMetaLeadingMessage,
  isGrayMetaTrailingMessage,
  isStandaloneAssistantAuxMessage,
  shouldCompactAfterPreviousMessage,
  shouldTightenAfterPreviousMetaMessage,
} from "@/lib/message-card-spacing";
import { WorkspaceFileReferenceMenu } from "@/components/workspace-file-reference-menu";
import { UserMessageBubble } from "@/components/user-message-bubble";
import { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import { useLocalFileAttachmentPreviews } from "@/hooks/useLocalFileAttachmentPreviews";
import { useFont } from "@/hooks/useFont";
import { useTheme } from "@/hooks/useTheme";
import {
  appendComposerLocalFileAttachment,
  composerAttachmentViewFromPath,
  isPreviewableImagePath,
  normalizeSlashPath as normalizeAttachmentPath,
  removeComposerLocalFileAttachment,
  snapshotsToComposerAttachmentViews,
} from "@/lib/local-file-attachments";
import {
  DESKTOP_CHROME_COMMIT_BTN,
  DESKTOP_CHROME_TOGGLE_ICON_BTN,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import { groupModelsForPicker } from "@/lib/model-picker-groups";
import {
  buildSkillSlashSuggestions,
  CREATE_SKILL_SLASH_ALIAS,
  currentSkillSlashQuery,
  START_IMPLEMENTING_SLASH_ALIAS,
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
import {
  SessionSidebar,
  mcpBadgeText,
  type SettingsSidebarTab,
} from "@/components/session-sidebar";
import { WorkspaceToolsDock, type WorkspaceToolsTab } from "@/components/workspace-tools-panel";
import type {
  AskQuestionsQuestionSpec,
  DesktopCommitMode,
  DesktopModelReasoningEffort,
  ConversationMessageSnapshot,
  DesktopSnapshot,
  MessageRewindDraftState,
  ToolBlockSnapshot,
  WorkspaceFileReferenceSuggestionsResponse,
} from "@/types";

function mcpStateVariant(
  state: DesktopSnapshot["mcpStatus"]["state"],
): "outline" | "secondary" | "default" | "destructive" {
  switch (state) {
    case "loading":
      return "secondary";
    case "ready":
      return "default";
    case "error":
      return "destructive";
    default:
      return "outline";
  }
}

/** 复合 DOM id/`key`，避免 `message.id` 碰撞导致子树被 React 错误复用。 */
function conversationMessageDomId(message: ConversationMessageSnapshot, index: number): string {
  const toolPart = message.tool?.toolCallId ?? (message.tool ? `${message.tool.toolName}:${message.tool.phase}` : "");
  return `message-${index}-${message.id}-${message.pending ? "p" : "m"}-${toolPart}`;
}

/** 主会话列最大宽度（居中） */
const CONVERSATION_MAX_W = "max-w-[min(86vw,44rem)]";

function formatModelPickerLabel(name: string, reasoningEffort: DesktopModelReasoningEffort): string {
  return `${name} · ${modelReasoningEffortLabel(reasoningEffort)}`;
}

const commitModeOptions: Array<{
  value: DesktopCommitMode;
  label: string;
  hint: string;
}> = [
  {
    value: "commit",
    label: "提交",
    hint: "仅在本地创建一次提交。",
  },
  {
    value: "commit-and-push",
    label: "提交并推送",
    hint: "提交后立即推送到当前分支远端。",
  },
];

function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function sameWorkspacePath(left: string, right: string): boolean {
  return normalizeWorkspacePath(left) === normalizeWorkspacePath(right);
}

function deriveWorkspaceLabel(workspaceRoot: string): string {
  const normalized = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/g, "");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) || normalized : normalized;
}

function normalizeSlashPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "");
}

type EmptyStateWorkspaceSelectorProps = {
  currentWorkspaceRoot: string;
  availableWorkspaces: DesktopSnapshot["availableWorkspaces"];
  disabled?: boolean;
  onSelectWorkspace(workspaceRoot: string): void;
  onAddWorkspace(): void;
};

function EmptyStateWorkspaceSelector({
  currentWorkspaceRoot,
  availableWorkspaces,
  disabled,
  onSelectWorkspace,
  onAddWorkspace,
}: EmptyStateWorkspaceSelectorProps) {
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
  const currentWorkspaceLabel = useMemo(() => {
    const matched = availableWorkspaces.find((workspace) =>
      sameWorkspacePath(workspace.path, currentWorkspaceRoot),
    );
    return matched?.label ?? deriveWorkspaceLabel(currentWorkspaceRoot);
  }, [availableWorkspaces, currentWorkspaceRoot]);

  return (
    <div className="flex justify-start px-0.5">
      <DropdownMenu onOpenChange={(open) => !open && setWorkspaceFilter("") }>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="选择工作区"
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
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="top"
          className="w-[min(24rem,calc(100vw-1.25rem))] p-0 text-xs"
        >
          <div className="border-b border-border/40 p-1.5">
            <Input
              value={workspaceFilter}
              onChange={(event) => setWorkspaceFilter(event.target.value)}
              placeholder="搜索工作区"
              className="h-8 w-full min-w-0 text-xs"
              onKeyDown={(event) => event.stopPropagation()}
              autoComplete="off"
            />
          </div>
          <div className="max-h-[min(18rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto p-1">
            {filteredWorkspaces.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">无匹配项</p>
            ) : (
              filteredWorkspaces.map((workspace) => {
                const selected = sameWorkspacePath(workspace.path, currentWorkspaceRoot);
                return (
                  <DropdownMenuItem
                    key={workspace.path}
                    onSelect={() => onSelectWorkspace(workspace.path)}
                    className={cn("items-start px-2 py-2", selected && "bg-accent/40")}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground" title={workspace.label}>
                        {workspace.label}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground" title={workspace.path}>
                        {workspace.path}
                      </div>
                    </div>
                  </DropdownMenuItem>
                );
              })
            )}
          </div>
          <div className="border-t border-border/40 p-1">
            <DropdownMenuItem onSelect={onAddWorkspace} className="gap-2 px-2 py-2 text-sm">
              <FolderPlus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span>添加工作区</span>
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

type ReadLocalImagePreview = (filePath: string) => Promise<string | null>;
type ReadManagedImagePreview = (reference: string) => Promise<string | null>;
type SaveLocalImageAs = (filePath: string) => Promise<boolean>;

function ToolCallCollapsible({
  tool,
  readLocalImagePreviewDataUrl,
  saveLocalImageAs,
}: {
  tool: ToolBlockSnapshot;
  readLocalImagePreviewDataUrl: ReadLocalImagePreview;
  saveLocalImageAs: SaveLocalImageAs;
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

  return <MinimalToolCallCard tool={tool} />;
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
  const floatingActionButtonClass =
    "size-8 rounded-full border border-border/50 bg-background/55 text-foreground shadow-sm backdrop-blur-xl transition-[background-color,border-color,box-shadow,transform] hover:border-border/60 hover:bg-background/72 dark:border-white/12 dark:bg-input/30 dark:hover:bg-input/40 supports-[backdrop-filter]:bg-background/40 dark:supports-[backdrop-filter]:bg-input/25";
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
              {loading ? "Loading" : "预览不可用"}
            </span>
          </div>
        )}
        {previewDataUrl ? (
          <div className="pointer-events-none absolute inset-0 z-10 opacity-0 transition duration-200 group-hover/image-card:opacity-100 group-focus-within/image-card:opacity-100">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn("pointer-events-auto absolute bottom-3 left-3", floatingActionButtonClass)}
              onClick={(event) => {
                event.stopPropagation();
                void handleSaveImage();
              }}
              disabled={saving}
              title="下载图片"
              aria-label="下载图片"
            >
              {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn("pointer-events-auto absolute right-3 bottom-3", floatingActionButtonClass)}
              onClick={(event) => {
                event.stopPropagation();
                setViewerOpen(true);
              }}
              title="查看大图"
              aria-label="查看大图"
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
                  title="关闭图片预览"
                  aria-label="关闭图片预览"
                >
                  <X className="size-4" aria-hidden />
                  <span className="sr-only">关闭图片预览</span>
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
                  title="下载图片"
                  aria-label="下载图片"
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

type ComposerSurfaceProps = {
  value: string;
  localFileAttachments: readonly ComposerLocalFileAttachmentView[];
  placeholder: string;
  models: DesktopSnapshot["config"]["models"];
  catalogHints?: DesktopSnapshot["config"]["modelCatalogHints"];
  activeModel: string;
  planMode: boolean;
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
  onPlanModeChange(planMode: boolean): void;
  onLoopEnabledChange(enabled: boolean): void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  onKeyDown?(event: ReactKeyboardEvent<HTMLTextAreaElement>): void;
  onSelectionChange?(selectionStart: number | null): void;
  showInsertButton?: boolean;
  canPickLocalFile?: boolean;
  onInsertWorkspaceFileReferenceTrigger?(): void;
  onPickLocalFile?(): void | Promise<void>;
  onInsertSkillTrigger?(): void;
  onRemoveLocalFileAttachment?(path: string): void;
  onPaste?(event: ReactClipboardEvent<HTMLTextAreaElement>): void;
  showLoopSwitch?: boolean;
};

function ComposerSurface({
  value,
  localFileAttachments,
  placeholder,
  models,
  catalogHints,
  activeModel,
  planMode,
  loopEnabled,
  canSend,
  canAbort = false,
  busy,
  readOnly = false,
  onChange,
  onSubmit,
  onAbort,
  onModelSelect,
  onModelReasoningEffortSelect,
  onPlanModeChange,
  onLoopEnabledChange,
  textareaRef,
  onKeyDown,
  onSelectionChange,
  showInsertButton = false,
  canPickLocalFile = false,
  onInsertWorkspaceFileReferenceTrigger,
  onPickLocalFile,
  onInsertSkillTrigger,
  onRemoveLocalFileAttachment,
  onPaste,
  showLoopSwitch = true,
}: ComposerSurfaceProps) {
  const [modelFilter, setModelFilter] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const activeModelProfile = useMemo(
    () => models.find((model) => model.name === activeModel),
    [activeModel, models],
  );
  const activeModelSummary = activeModelProfile
    ? formatModelPickerLabel(activeModelProfile.name, activeModelProfile.reasoningEffort)
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
        items: group.items.filter((model) => model.name.toLowerCase().includes(query)),
      }))
      .filter((group) => group.items.length > 0);
  }, [modelFilter, modelGroups]);

  return (
    <div
      data-spirit-surface="composer-surface"
      className="relative overflow-hidden rounded-2xl border border-border/50 bg-background/55 shadow-sm backdrop-blur-xl transition-[border-color,box-shadow] focus-within:border-ring/60 focus-within:ring-0 dark:border-white/12 dark:bg-input/30 supports-[backdrop-filter]:bg-background/40 dark:supports-[backdrop-filter]:bg-input/25"
    >
      <ComposerLocalFileStrip
        attachments={localFileAttachments}
        onRemove={(path) => onRemoveLocalFileAttachment?.(path)}
      />
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          onSelectionChange?.(event.target.selectionStart);
        }}
        onSelect={(event) => {
          onSelectionChange?.(event.currentTarget.selectionStart);
        }}
        onPaste={(event) => {
          onPaste?.(event);
        }}
        disabled={readOnly}
        placeholder={placeholder}
        className="spirit-scroll block max-h-[12rem] min-h-[3rem] w-full resize-none overflow-y-auto rounded-none border-0 bg-transparent px-3 pt-2.5 pb-1.5 text-sm leading-relaxed shadow-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none dark:bg-transparent dark:disabled:bg-transparent md:min-h-[3.5rem]"
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) {
            return;
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (canSend) {
              onSubmit();
            }
          }
        }}
      />
      <div className="flex justify-center px-3 pt-0.5 pb-2">
        <div className="flex w-full max-w-full items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {showInsertButton ? (
              <ComposerInsertMenu
                disabled={readOnly}
                canPickLocalFile={canPickLocalFile}
                onInsertWorkspaceReference={() => onInsertWorkspaceFileReferenceTrigger?.()}
                onPickLocalFile={() => onPickLocalFile?.()}
                onInsertSkillTrigger={() => onInsertSkillTrigger?.()}
              />
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="运行方式"
                  disabled={readOnly}
                  className={cn(
                    "inline-flex h-7 max-w-[9rem] shrink-0 items-center gap-0.5 rounded-md border-0 bg-transparent pr-0.5 pl-1 text-left text-xs font-medium text-muted-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50",
                    instantHoverMotionClass,
                  )}
                >
                  <span className="min-w-0 flex-1 truncate" title={planMode ? "Plan" : "Agent"}>
                    {planMode ? "Plan" : "Agent"}
                  </span>
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground/80" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="min-w-[8rem] text-xs">
                <DropdownMenuItem
                  onSelect={() => onPlanModeChange(false)}
                  className={cn(!planMode && "bg-accent/40")}
                >
                  Agent
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => onPlanModeChange(true)}
                  className={cn(planMode && "bg-accent/40")}
                >
                  Plan
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {showLoopSwitch ? (
              <button
                type="button"
                role="switch"
                aria-checked={loopEnabled}
                disabled={readOnly}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  instantHoverMotionClass,
                  loopEnabled
                    ? "bg-primary/12 text-primary hover:bg-primary/16"
                    : "bg-transparent text-muted-foreground hover:bg-muted/50",
                )}
                onClick={() => onLoopEnabledChange(!loopEnabled)}
                title={loopEnabled ? "Loop On" : "Loop Off"}
              >
                <span>Loop</span>
                <span className={cn("text-[10px]", loopEnabled ? "text-primary" : "text-muted-foreground/80")}>
                  {loopEnabled ? "On" : "Off"}
                </span>
              </button>
            ) : null}
            {models.length > 0 ? (
              <DropdownMenu
                open={modelMenuOpen}
                onOpenChange={(open) => {
                  setModelMenuOpen(open);
                  if (!open) {
                    setModelFilter("");
                  }
                }}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="选择模型"
                    disabled={readOnly}
                    className={cn(
                      "inline-flex h-7 max-w-[12rem] shrink-0 items-center gap-0.5 rounded-md border-0 bg-transparent pr-0.5 pl-1 text-left text-xs font-medium text-muted-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50",
                      instantHoverMotionClass,
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate" title={activeModelSummary}>
                      {activeModelSummary}
                    </span>
                    <ChevronDown className="size-3 shrink-0 text-muted-foreground/80" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  side="top"
                  className="w-max min-w-[max(11rem,var(--radix-dropdown-menu-trigger-width))] max-w-[min(20rem,calc(100vw-1.25rem))] p-0 text-xs"
                >
                  <div className="border-b border-border/40 p-1.5">
                    <Input
                      value={modelFilter}
                      onChange={(event) => setModelFilter(event.target.value)}
                      placeholder="筛选模型"
                      className="h-8 w-full min-w-0 text-xs"
                      onKeyDown={(event) => event.stopPropagation()}
                      autoComplete="off"
                    />
                  </div>
                  <ScrollArea
                    type="always"
                    className="[&>[data-radix-scroll-area-viewport]]:max-h-[min(18rem,var(--radix-dropdown-menu-content-available-height))] [&>[data-radix-scroll-area-viewport]]:overscroll-contain"
                    onWheel={(event) => {
                      event.stopPropagation();
                    }}
                    onTouchMove={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <div className="p-1 pr-2">
                      {filteredModelGroups.length === 0 ? (
                        <p className="px-2 py-4 text-center text-xs text-muted-foreground">无匹配项</p>
                      ) : (
                        filteredModelGroups.map((group) => (
                          <div key={group.provider} className="mb-2 last:mb-0">
                            <div className="px-2 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">
                              {group.label}
                            </div>
                            {group.items.map((model) => {
                              const modelSummary = formatModelPickerLabel(
                                model.name,
                                model.reasoningEffort,
                              );

                              return (
                                <DropdownMenuSub key={`${group.provider}:${model.name}`}>
                                  <DropdownMenuSubTrigger
                                    className={cn(
                                      "items-start gap-2 px-2 py-2 pr-2",
                                      activeModelProfile?.name === model.name && "bg-accent/40",
                                    )}
                                    onClick={() => {
                                      onModelSelect(model.name);
                                      setModelFilter("");
                                      setModelMenuOpen(false);
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        onModelSelect(model.name);
                                        setModelFilter("");
                                        setModelMenuOpen(false);
                                      }
                                    }}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-sm font-medium text-foreground" title={model.name}>
                                        {model.name}
                                      </div>
                                      <div className="truncate text-[11px] text-muted-foreground" title={modelSummary}>
                                        {modelReasoningEffortLabel(model.reasoningEffort)}
                                      </div>
                                    </div>
                                  </DropdownMenuSubTrigger>
                                  <DropdownMenuSubContent className="min-w-[10rem] text-xs">
                                    {modelReasoningEffortOptions({
                                      provider: model.provider,
                                      model: model.name,
                                      ...(model.supportedReasoningEfforts !== undefined
                                        ? { supportedEfforts: model.supportedReasoningEfforts }
                                        : {}),
                                      transportKind: model.transportKind,
                                    }).map((option) => (
                                      <DropdownMenuItem
                                        key={option.value}
                                        onSelect={() => {
                                          onModelReasoningEffortSelect(model.name, option.value);
                                          onModelSelect(model.name);
                                          setModelFilter("");
                                          setModelMenuOpen(false);
                                        }}
                                        className={cn(
                                          model.reasoningEffort === option.value && "bg-accent/40",
                                        )}
                                        title={modelSummary}
                                      >
                                        {option.label}
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuSubContent>
                                </DropdownMenuSub>
                              );
                            })}
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="px-1 text-xs text-muted-foreground">无可用模型</span>
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
            title={canAbort ? "中止" : "发送（Ctrl+Enter）"}
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
function ThinkingLabelWithShimmer({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 text-xs font-medium tracking-wide",
        active ? "spirit-thinking-shimmer-text" : "text-muted-foreground",
      )}
    >
      {active ? "Thinking" : "Thought"}
    </span>
  );
}

/** 推理流进行中：有 thinking 且尚未写入正文；正文开始后自动收起。 */
function assistantReasoningLive(message: ConversationMessageSnapshot): boolean {
  return (
    message.pending &&
    Boolean(message.aux?.thinking?.trim()) &&
    !message.content.trim()
  );
}

function isLiveStreamingThinkingMessage(message: ConversationMessageSnapshot | undefined): boolean {
  return Boolean(
    message?.role === "assistant" &&
      message.pending &&
      Boolean(message.aux?.thinking?.trim()) &&
      !message.content.trim(),
  );
}

function toolPhaseCollapsesLiveThinking(phase: ToolBlockSnapshot["phase"]): boolean {
  return phase === "preview" || phase === "running" || phase === "pending-approval";
}

function shouldCollapseThinkingDuringToolPreview(
  messages: readonly ConversationMessageSnapshot[],
  messageIndex: number,
): boolean {
  const message = messages[messageIndex];
  const liveThinking = isLiveStreamingThinkingMessage(message);

  for (let index = messageIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index];
    if (!candidate) {
      continue;
    }
    if (candidate.role === "user") {
      break;
    }
    if (candidate.role === "assistant" && candidate.tool) {
      if (toolPhaseCollapsesLiveThinking(candidate.tool.phase)) {
        return true;
      }
      if (liveThinking) {
        return true;
      }
    }
  }

  return false;
}

function AssistantThinkingCollapsible({
  message,
  collapseDuringToolPreview,
}: {
  message: ConversationMessageSnapshot;
  collapseDuringToolPreview: boolean;
}) {
  const thinking = message.aux?.thinking;
  if (!thinking) {
    return null;
  }

  const reasoningLive = assistantReasoningLive(message);
  const thinkingActive = reasoningLive && !collapseDuringToolPreview;
  const autoExpanded = thinkingActive;
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
      <CollapsibleContent className="min-w-0">
        <pre className="whitespace-pre-wrap break-words pt-1.5 font-sans text-sm leading-relaxed text-muted-foreground">
          {thinking}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function MessageCard({
  messages,
  message,
  listIndex,
  compactAfterPrevious,
  tightenAfterPreviousMeta,
  canContinue,
  continueBusy,
  rewindText,
  rewindLocalFileAttachments,
  rewindSelected,
  rewindCanSubmit,
  rewindBusy,
  canPickLocalFile,
  models,
  catalogHints,
  activeModel,
  planMode,
  onContinue,
  onRewindChange,
  onRewindStart,
  onRewindSubmit,
  onRewindRemoveLocalFileAttachment,
  onRewindPickLocalFile,
  onRewindPaste,
  onModelSelect,
  onModelReasoningEffortSelect,
  onPlanModeChange,
  readManagedImagePreviewDataUrl,
  readLocalImagePreviewDataUrl,
  saveLocalImageAs,
}: {
  messages: readonly ConversationMessageSnapshot[];
  message: ConversationMessageSnapshot;
  listIndex: number;
  compactAfterPrevious: boolean;
  tightenAfterPreviousMeta: boolean;
  canContinue: boolean;
  continueBusy: boolean;
  rewindText: string;
  rewindLocalFileAttachments: readonly ComposerLocalFileAttachmentView[];
  rewindSelected: boolean;
  rewindCanSubmit: boolean;
  rewindBusy: boolean;
  canPickLocalFile: boolean;
  models: DesktopSnapshot["config"]["models"];
  catalogHints?: DesktopSnapshot["config"]["modelCatalogHints"];
  activeModel: string;
  planMode: boolean;
  onContinue(message: ConversationMessageSnapshot): void;
  onRewindChange(value: string): void;
  onRewindStart(message: ConversationMessageSnapshot, listIndex: number): void;
  onRewindSubmit(): void;
  onRewindRemoveLocalFileAttachment(path: string): void;
  onRewindPickLocalFile(): void;
  onRewindPaste(event: ReactClipboardEvent<HTMLTextAreaElement>): void;
  onModelSelect(name: string): void;
  onModelReasoningEffortSelect(name: string, reasoningEffort: DesktopModelReasoningEffort): void;
  onPlanModeChange(planMode: boolean): void;
  readManagedImagePreviewDataUrl: ReadManagedImagePreview;
  readLocalImagePreviewDataUrl: ReadLocalImagePreview;
  saveLocalImageAs: SaveLocalImageAs;
}) {
  const isUser = message.role === "user";
  const canStartRewind = isUser && message.canRewind === true && !message.pending;
  const userBubble =
    "rounded-2xl rounded-br-md border border-border/50 bg-muted px-3 py-2.5 shadow-sm";

  return (
    <div
      id={conversationMessageDomId(message, listIndex)}
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
            value={rewindText}
            localFileAttachments={rewindLocalFileAttachments}
            onChange={onRewindChange}
            onSubmit={onRewindSubmit}
            placeholder="输入消息…"
            models={models}
            catalogHints={catalogHints}
            activeModel={activeModel}
            planMode={planMode}
            loopEnabled={false}
            onModelSelect={onModelSelect}
            onModelReasoningEffortSelect={onModelReasoningEffortSelect}
            onPlanModeChange={onPlanModeChange}
            onLoopEnabledChange={() => {}}
            showLoopSwitch={false}
            canSend={rewindCanSubmit}
            busy={rewindBusy}
            showInsertButton
            canPickLocalFile={canPickLocalFile}
            onPickLocalFile={onRewindPickLocalFile}
            onRemoveLocalFileAttachment={onRewindRemoveLocalFileAttachment}
            onPaste={onRewindPaste}
          />
        ) : null}
        {!isUser && message.aux?.thinking ? (
          <AssistantThinkingCollapsible
            message={message}
            collapseDuringToolPreview={shouldCollapseThinkingDuringToolPreview(messages, listIndex)}
          />
        ) : null}
        {!isUser && message.aux?.compaction ? (
          <div className="border-l border-dashed border-muted-foreground/35 py-0.5 pl-2.5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">
              Compaction
            </p>
            <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-muted-foreground">
              {message.aux.compaction}
            </pre>
          </div>
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
          isSubagentStatusSurfaceMessage(message) ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{message.content}</p>
          ) : (
          <div data-spirit-surface="message-bubble">
            <MarkdownMessage
              content={message.content}
              className="font-sans"
              readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
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
            saveLocalImageAs={saveLocalImageAs}
          />
        ) : null}
        {!isUser && canContinue ? (
          <div className="ml-auto flex max-w-[min(72%,22rem)] justify-end pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-4"
              onClick={() => onContinue(message)}
              disabled={continueBusy}
            >
              继续
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
  const selectedValue =
    question.kind === "single_select" && draft.selectedOptionIndexes.length > 0
      ? String(draft.selectedOptionIndexes[0])
      : undefined;

  return (
    <Card className="border-border/60 bg-background/90" size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{question.title}</CardTitle>
          {question.required ? <Badge variant="secondary">必答</Badge> : null}
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
              {question.customInputLabel ?? "回答"}
            </Label>
            <Textarea
              id={`${question.id}-text`}
              value={draft.text}
              onChange={(event) => onTextChange(event.target.value)}
              placeholder={question.customInputPlaceholder ?? "请输入回答"}
              className="min-h-28"
            />
          </div>
        ) : null}

        {question.allowCustomInput ? (
          <div className="space-y-2">
            <Label htmlFor={`${question.id}-custom`}>
              {question.customInputLabel ?? "自定义输入"}
            </Label>
            <Input
              id={`${question.id}-custom`}
              value={draft.customInput}
              onChange={(event) => onCustomInputChange(event.target.value)}
              placeholder={question.customInputPlaceholder ?? "补充一个未列出的选项"}
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
  const [code, setCode] = useState("");
  const [localError, setLocalError] = useState("");

  const submit = () => {
    const normalized = code.trim();
    if (!normalized) {
      setLocalError("请输入配对码。");
      return;
    }
    void onPair(normalized).then((ok) => {
      if (!ok) {
        setLocalError("配对失败，请检查配对码。");
      }
    });
  };

  return (
    <div className="flex h-[100dvh] items-center justify-center bg-background px-4 text-foreground">
      <Card className="w-full max-w-sm rounded-lg">
        <CardHeader>
          <CardTitle>首次配对</CardTitle>
          <CardDescription>输入 Desktop 设置页显示的配对码。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="web-host-pairing-code">配对码</Label>
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
          {localError || (error && !error.includes("需要完成首次配对")) ? (
            <p className="text-sm text-destructive">{localError || error}</p>
          ) : null}
          <Button type="button" className="w-full" disabled={busy} onClick={submit}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            配对
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function DesktopLayoutChromeBar({
  useMicaBackdrop,
  sessionSidebarOpen,
  onToggleSessionSidebar,
  showWorkspaceToggle,
  showCommitButton = false,
  commitDisabled = false,
  commitBusy = false,
  onOpenCommitDialog,
  showMergeButton = false,
  mergeDisabled = false,
  mergeBusy = false,
  onOpenMergeDialog,
  workspaceToolsOpen = false,
  onToggleWorkspaceTools,
}: {
  useMicaBackdrop: boolean;
  sessionSidebarOpen: boolean;
  onToggleSessionSidebar(): void;
  showWorkspaceToggle: boolean;
  showCommitButton?: boolean;
  commitDisabled?: boolean;
  commitBusy?: boolean;
  onOpenCommitDialog?: () => void;
  showMergeButton?: boolean;
  mergeDisabled?: boolean;
  mergeBusy?: boolean;
  onOpenMergeDialog?: () => void;
  workspaceToolsOpen?: boolean;
  onToggleWorkspaceTools?: () => void;
}) {
  const showTrailingActions = showWorkspaceToggle || showCommitButton || showMergeButton;
  return (
    <div
      role="toolbar"
      aria-label="侧栏与工具区"
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 px-1.5",
        showTrailingActions ? "justify-between" : "justify-start",
        useMicaBackdrop ? "bg-transparent" : "bg-background",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={DESKTOP_CHROME_TOGGLE_ICON_BTN}
        onClick={onToggleSessionSidebar}
        aria-label={sessionSidebarOpen ? "隐藏侧栏" : "展开侧栏"}
        aria-expanded={sessionSidebarOpen}
        {...(sessionSidebarOpen ? { "aria-controls": "session-sidebar-panel" } : {})}
      >
        {sessionSidebarOpen ? <PanelLeftClose className="size-3.5" aria-hidden /> : <PanelLeftOpen className="size-3.5" aria-hidden />}
      </Button>
      {showTrailingActions ? (
        <div className="flex items-center gap-1">
          {showMergeButton ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={DESKTOP_CHROME_COMMIT_BTN}
              disabled={mergeDisabled}
              onClick={onOpenMergeDialog}
            >
              {mergeBusy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
              <span>Merge</span>
            </Button>
          ) : null}
          {showCommitButton ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={DESKTOP_CHROME_COMMIT_BTN}
              disabled={commitDisabled}
              onClick={onOpenCommitDialog}
            >
              {commitBusy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
              <span>Commit</span>
            </Button>
          ) : null}
          {showWorkspaceToggle ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={DESKTOP_CHROME_TOGGLE_ICON_BTN}
              onClick={() => onToggleWorkspaceTools?.()}
              aria-label={workspaceToolsOpen ? "收拢工具区" : "展开工具区"}
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

  const models = snapshot?.config.models ?? [];
  const messages = snapshot?.conversation.messages ?? [];
  const isEmptySession = messages.length === 0;
  const rewindWarnings = snapshot?.conversation.rewindWarnings ?? [];
  const pendingApproval = snapshot?.conversation.pendingToolApproval;
  const pendingQuestions = runtime.pendingQuestions;
  useLocalFileAttachmentPreviews(
    runtime.composerLocalFileAttachments,
    runtime.setComposerLocalFileAttachments,
    runtime.readLocalImagePreviewDataUrl,
  );
  const activeSessionReadOnly = snapshot?.activeSession?.readOnly === true;
  const conversationInterruptible = runtime.summary.canInterrupt && !runtime.busyAction;
  const continueBusy = Boolean(runtime.busyAction) || snapshot?.conversation.isBusy === true;
  const composerCanSend =
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
  const [settingsTab, setSettingsTab] = useState<SettingsSidebarTab>("basic");
  const [extensionSettingsId, setExtensionSettingsId] = useState<string | null>(null);
  const [sessionSidebarOpen, setSessionSidebarOpen] = useState(true);
  const [workspaceToolsOpen, setWorkspaceToolsOpen] = useState(false);
  const [workspaceToolsTab, setWorkspaceToolsTab] = useState<WorkspaceToolsTab>("files");
  const [workspaceFilesPlanRevealNonce, setWorkspaceFilesPlanRevealNonce] = useState(0);
  const [workspaceToolsWidthPx, setWorkspaceToolsWidthPx] = useState(420);
  const [composerCursorCodeUnits, setComposerCursorCodeUnits] = useState(0);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(-1);
  const [fileReferenceSuggestions, setFileReferenceSuggestions] =
    useState<WorkspaceFileReferenceSuggestionsResponse>(null);
  const [fileReferenceSelectedIndex, setFileReferenceSelectedIndex] = useState(-1);
  const [dismissedFileReferenceKey, setDismissedFileReferenceKey] = useState<string | null>(null);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [branchCheckoutDialogOpen, setBranchCheckoutDialogOpen] = useState(false);
  const [branchCheckoutBlockedByChanges, setBranchCheckoutBlockedByChanges] = useState(false);
  const pendingComposerSendRef = useRef<{
    text: string;
    localFilePaths?: string[];
  } | null>(null);
  const [commitMessageDraft, setCommitMessageDraft] = useState("");
  const [commitMode, setCommitMode] = useState<DesktopCommitMode>("commit");
  const activeFilePath = snapshot?.activeSession?.filePath ?? null;
  const canOpenCommitDialog = snapshot?.git.isRepository === true;
  const isWorktreeSession = snapshot?.git.isWorktreeSession === true;
  const canOpenMergeDialog =
    isWorktreeSession &&
    Boolean(snapshot?.git.worktreeBranch) &&
    Boolean(snapshot?.git.primaryRepoRoot);
  const commitBusy = runtime.busyAction === "git";
  const sessionNavigationBusy = runtime.busyAction === "session";
  const newSessionBusy = runtime.busyAction === "reset";
  const commitActionDisabled =
    !canOpenCommitDialog ||
    snapshot?.git.hasChanges !== true ||
    commitBusy;
  const mergeActionDisabled = !canOpenMergeDialog || commitBusy;
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previousPlanModifiedAtRef = useRef<number | undefined>(undefined);
  const previousPlanExistsRef = useRef<boolean | undefined>(undefined);
  const planAutoOpenInitializedRef = useRef(false);
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
    if (!plan) {
      return;
    }

    const previousExists = previousPlanExistsRef.current;
    const previousModifiedAt = previousPlanModifiedAtRef.current;
    previousPlanExistsRef.current = plan.exists;
    previousPlanModifiedAtRef.current = plan.modifiedAtUnixMs;

    if (!planAutoOpenInitializedRef.current) {
      planAutoOpenInitializedRef.current = true;
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
    setWorkspaceToolsTab("files");
    setWorkspaceFilesPlanRevealNonce((value) => value + 1);
  }, [snapshot?.plan.exists, snapshot?.plan.modifiedAtUnixMs, snapshot?.plan]);
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
  const fileReferenceRequestIdRef = useRef(0);
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

    const requestId = fileReferenceRequestIdRef.current + 1;
    fileReferenceRequestIdRef.current = requestId;
    const input = runtime.composer;
    const cursorChars = composerCursorChars;
    const timeout = window.setTimeout(() => {
      void runtime
        .listWorkspaceFileReferenceSuggestions({
          input,
          cursorChars,
        })
        .then((result) => {
          if (fileReferenceRequestIdRef.current !== requestId) {
            return;
          }
          setFileReferenceSuggestions(result);
        })
        .catch(() => {
          if (fileReferenceRequestIdRef.current !== requestId) {
            return;
          }
          setFileReferenceSuggestions(null);
        });
    }, 90);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    dismissedFileReferenceKey,
    fileReferenceQueryKey,
    runtime,
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
    setRewindDraft({
      messageId: message.id,
      listIndex,
      text: message.content,
      localFileAttachments: snapshotsToComposerAttachmentViews(message.localFileAttachments),
    });
  };

  const submitMessageRewind = () => {
    if (!rewindDraft) {
      return;
    }
    void runtime
      .rewindAndSubmitMessage({
        messageId: rewindDraft.messageId,
        text: rewindDraft.text,
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
      composerTextareaRef.current?.focus();
    });
  };

  const applyFileReferenceSuggestion = (path: string) => {
    const query = fileReferenceSuggestions?.query;
    if (!query) {
      return;
    }

    const next = replaceWorkspaceFileReferenceQuery(runtime.composer, query, path, true);
    const nextCursorCodeUnits = charCountToCodeUnitIndex(next.text, next.cursorChars);
    runtime.setComposer(next.text);
    setComposerCursorCodeUnits(nextCursorCodeUnits);
    setFileReferenceSelectedIndex(-1);
    setDismissedFileReferenceKey(null);
    queueMicrotask(() => {
      const textarea = composerTextareaRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(nextCursorCodeUnits, nextCursorCodeUnits);
    });
  };

  const insertComposerText = (text: string) => {
    const textarea = composerTextareaRef.current;
    const selectionStart = textarea?.selectionStart ?? composerCursorCodeUnits;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const nextValue = `${runtime.composer.slice(0, selectionStart)}${text}${runtime.composer.slice(selectionEnd)}`;
    const nextCursorCodeUnits = selectionStart + text.length;
    runtime.setComposer(nextValue);
    setComposerCursorCodeUnits(nextCursorCodeUnits);
    setSlashSelectedIndex(-1);
    setFileReferenceSelectedIndex(-1);
    setFileReferenceSuggestions(null);
    setDismissedFileReferenceKey(null);
    queueMicrotask(() => {
      const nextTextarea = composerTextareaRef.current;
      nextTextarea?.focus();
      nextTextarea?.setSelectionRange(nextCursorCodeUnits, nextCursorCodeUnits);
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
            composerTextareaRef.current?.focus();
          });
        },
      });
    },
    [runtime.setComposerLocalFileAttachments],
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
    const payload = {
      text: runtime.composer,
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

    void runtime.sendMessage(payload);
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
        void runtime.sendMessage(pending);
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
      void runtime.sendMessage(pending);
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
        applySlashSuggestion(`${selected.alias} `);
      }
      return;
    }

    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      const selected = slashSuggestions[slashSelectedIndex] ?? slashSuggestions[0];
      if (selected) {
        applySlashSuggestion(`${selected.alias} `);
      }
    }
  };

  const submitCommitDialog = () => {
    void runtime.commitChanges({
      mode: commitMode,
      ...(commitMessageDraft.trim() ? { message: commitMessageDraft.trim() } : {}),
    }).then((ok) => {
      if (!ok) {
        return;
      }
      setCommitDialogOpen(false);
      setCommitMode("commit");
      setCommitMessageDraft("");
    });
  };

  const submitMergeDialog = () => {
    void runtime.mergeWorktreeToMain().then((ok) => {
      if (!ok) {
        return;
      }
      setMergeDialogOpen(false);
    });
  };

  const chromeBarGitActions = {
    showCommitButton: canOpenCommitDialog,
    commitDisabled: commitActionDisabled,
    commitBusy,
    onOpenCommitDialog: () => setCommitDialogOpen(true),
    showMergeButton: canOpenMergeDialog,
    mergeDisabled: mergeActionDisabled,
    mergeBusy: commitBusy,
    onOpenMergeDialog: () => setMergeDialogOpen(true),
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
        <DesktopTitleBar useMicaBackdrop={useMicaBackdrop} sessionSidebarOpen={sessionSidebarOpen} />
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
        <div
          data-spirit-surface="session-sidebar-shell"
          className={cn(
            "h-full min-h-0 shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none motion-reduce:duration-0",
            sessionSidebarOpen ? "w-[min(16rem,40vw)]" : "w-0",
          )}
        >
          <div
            data-spirit-surface="session-sidebar"
            className={cn(
              "h-full min-w-0 w-[min(16rem,40vw)]",
              !sessionSidebarOpen && "pointer-events-none select-none",
            )}
            aria-hidden={!sessionSidebarOpen}
            inert={!sessionSidebarOpen}
          >
            <SessionSidebar
              narrow={false}
              mode={settingsMode ? "settings" : "sessions"}
              workspaceRoot={snapshot?.workspaceRoot ?? null}
              sessions={runtime.sessions}
              activeFilePath={activeFilePath}
              onNewSession={() => {
                setLastNonSettingsSurface("conversation");
                setActiveSurface("conversation");
                void runtime.resetSession();
              }}
              onSelectSession={(path) => {
                setLastNonSettingsSurface("conversation");
                setActiveSurface("conversation");
                void runtime.openSession(path);
              }}
              onOpenMarketplace={() => {
                setSessionSidebarOpen(true);
                setLastNonSettingsSurface("marketplace");
                setActiveSurface("marketplace");
              }}
              onOpenSettings={() => {
                setSessionSidebarOpen(true);
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
              hostStatus={runtime.summary.hostStatus}
              mcpState={mcpBadgeText(snapshot)}
              micaStyle={useMicaBackdrop}
              newSessionBusy={newSessionBusy}
              sessionNavigationBusy={sessionNavigationBusy}
            />
          </div>
        </div>

        {settingsMode ? (
          <div data-spirit-surface="settings-shell" className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
            <DesktopLayoutChromeBar
              useMicaBackdrop={useMicaBackdrop}
              sessionSidebarOpen={sessionSidebarOpen}
              onToggleSessionSidebar={() => setSessionSidebarOpen((o) => !o)}
              showWorkspaceToggle={false}
              {...chromeBarGitActions}
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
              extensionsBusy={runtime.busyAction === "extensions"}
              isElectronShell={isElectronShell}
              onSavePatch={runtime.saveSettingsPatch}
              onResetWebHostPairing={runtime.resetWebHostPairing}
              onAddModel={runtime.addModel}
              onAddProviderModels={runtime.addProviderModels}
              onPreviewModels={runtime.previewModels}
              onRemoveModel={runtime.removeModel}
              onRemoveProviderModels={runtime.removeProviderModels}
              onAddMcpServer={runtime.addMcpServer}
              onImportExtension={runtime.importExtension}
              onDeleteExtension={runtime.deleteExtension}
              onRunExtension={runtime.runExtension}
              onUpdateExtensionSettings={runtime.updateExtensionSettings}
              onUpdateExtensionSecret={runtime.updateExtensionSecret}
              onDeleteMcpServer={runtime.deleteMcpServer}
              onInspectMcpServer={runtime.inspectMcpServer}
              onCreateSkill={runtime.createSkill}
              onDeleteSkill={runtime.deleteSkill}
              onListDreamsOverview={runtime.listDreamsOverview}
              onGenerateSkillNavigate={() => {
                setLastNonSettingsSurface("conversation");
                setActiveSurface("conversation");
                applySlashSuggestion(`${CREATE_SKILL_SLASH_ALIAS} `);
              }}
            />
          </div>
        ) : marketplaceMode ? (
          <div data-spirit-surface="marketplace-layout" className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
            <DesktopLayoutChromeBar
              useMicaBackdrop={useMicaBackdrop}
              sessionSidebarOpen={sessionSidebarOpen}
              onToggleSessionSidebar={() => setSessionSidebarOpen((o) => !o)}
              showWorkspaceToggle={false}
              {...chromeBarGitActions}
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
                sessionSidebarOpen={sessionSidebarOpen}
                onToggleSessionSidebar={() => setSessionSidebarOpen((o) => !o)}
                showWorkspaceToggle
                {...chromeBarGitActions}
                workspaceToolsOpen={workspaceToolsOpen}
                onToggleWorkspaceTools={() => setWorkspaceToolsOpen((c) => !c)}
              />
            <div data-spirit-surface="conversation-stage" className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background text-sm">
              {rewindDraft ? (
                <button
                  type="button"
                  aria-label="取消回溯编辑"
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
                {/* min-h-full：短内容仍铺满视口；大 pb 为底部透明叠层留出可滚入的「床」，避免正文被输入区挡住 */}
                <div
                  data-spirit-surface="conversation-scroll-body"
                  className={cn(
                    "min-h-full w-full bg-background",
                    !isEmptySession && "pb-[calc(12rem+env(safe-area-inset-bottom,0px))]",
                  )}
                >
                  {!isEmptySession ? (
                    <div
                      data-spirit-surface="conversation-list-shell"
                      className={cn(
                        "mx-auto w-full overflow-x-hidden px-3 pt-6 sm:pt-7",
                        CONVERSATION_MAX_W,
                      )}
                    >
                      <div data-spirit-surface="conversation-list" className="space-y-3">
                        {messages.map((message, index) => {
                          const previous = messages[index - 1];
                          const compactAfterPrevious = shouldCompactAfterPreviousMessage(previous, message);
                          const tightenAfterPreviousMeta = shouldTightenAfterPreviousMetaMessage(previous, message);
                          return (
                            <MessageCard
                              key={conversationMessageDomId(message, index)}
                              messages={messages}
                              listIndex={index}
                              message={message}
                              compactAfterPrevious={compactAfterPrevious}
                              tightenAfterPreviousMeta={tightenAfterPreviousMeta}
                              canContinue={
                                message.canContinue === true &&
                                !activeSessionReadOnly &&
                                snapshot?.conversation.isBusy !== true
                              }
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
                              rewindCanSubmit={
                                runtime.summary.canSend &&
                                runtime.busyAction !== "rewind" &&
                                runtime.busyAction !== "session" &&
                                rewindDraft?.listIndex === index &&
                                (Boolean(rewindDraft.text.trim()) ||
                                  rewindDraft.localFileAttachments.length > 0)
                              }
                              canPickLocalFile={runtime.hostKind === "electron"}
                              rewindBusy={runtime.busyAction === "rewind"}
                              models={models}
                              catalogHints={snapshot?.config.modelCatalogHints}
                              activeModel={runtime.settings.activeModel}
                              planMode={runtime.settings.planMode}
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
                              onPlanModeChange={(planMode) => {
                                void runtime.saveSettingsPatch({ planMode });
                              }}
                              readManagedImagePreviewDataUrl={runtime.readManagedImagePreviewDataUrl}
                              readLocalImagePreviewDataUrl={runtime.readLocalImagePreviewDataUrl}
                              saveLocalImageAs={runtime.saveLocalImageAs}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </ScrollArea>

              <div
                data-spirit-surface="composer-dock"
                className={cn(
                  "pointer-events-none absolute inset-x-0 z-10 bg-transparent",
                  isEmptySession
                    ? "inset-y-0 flex items-center justify-center px-3 pb-[env(safe-area-inset-bottom,0px)]"
                    : "bottom-0 pt-2 pb-0",
                )}
              >
                <div
                  className={cn(
                    "pointer-events-auto mx-auto w-full px-3",
                    CONVERSATION_MAX_W,
                  )}
                >
                {isEmptySession ? (
                  <p className="mb-6 text-center text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
                    Start something.
                  </p>
                ) : null}
                <div className="space-y-2">
                {isEmptySession ? (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5">
                    <EmptyStateWorkspaceSelector
                      currentWorkspaceRoot={snapshot?.workspaceRoot ?? ""}
                      availableWorkspaces={snapshot?.availableWorkspaces ?? []}
                      disabled={runtime.busyAction === "bootstrap" || runtime.busyAction === "session"}
                      onSelectWorkspace={(workspaceRoot) => {
                        if (!snapshot?.workspaceRoot || sameWorkspacePath(snapshot.workspaceRoot, workspaceRoot)) {
                          return;
                        }
                        void runtime.switchWorkspaceRoot(workspaceRoot);
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
                  </div>
                ) : null}
                {runtime.runtimeError ? (
                  <div className="rounded-md border border-destructive/35 bg-destructive/10 px-2.5 py-2 text-xs leading-relaxed text-destructive">
                    {runtime.runtimeError}
                  </div>
                ) : null}

                {rewindWarnings.length > 0 ? (
                  <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-100">
                    <p>回溯完成，{rewindWarnings.length} 项文件变更需要注意。</p>
                    <p className="mt-1 truncate" title={rewindWarnings[0]?.message}>
                      {rewindWarnings[0]?.path}: {rewindWarnings[0]?.message}
                    </p>
                  </div>
                ) : null}

                {pendingApproval ? (
                  <Card className="border-border/50 bg-background/55 text-sm shadow-sm backdrop-blur-xl dark:border-white/12 supports-[backdrop-filter]:bg-background/40">
                    <CardHeader className="space-y-1.5 px-3 py-2.5">
                      <CardTitle className="min-w-0 truncate text-sm leading-tight">
                        {pendingApproval.toolName}
                      </CardTitle>
                      <CardDescription className="text-xs leading-relaxed">
                        <ScrollArea
                          type="always"
                          className="pr-3 [&>[data-radix-scroll-area-viewport]]:max-h-24 [&>[data-radix-scroll-area-viewport]]:overscroll-contain"
                        >
                          <div className="whitespace-pre-wrap">
                            {pendingApproval.prompt}
                          </div>
                        </ScrollArea>
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-2 px-3 pb-3 pt-0">
                      <div className="grid gap-1.5">
                        <Button
                          size="sm"
                          className="h-8 w-full justify-start px-2.5"
                          onClick={() => void runtime.submitApproval({ kind: "allow" })}
                          disabled={runtime.busyAction === "approve"}
                        >
                          <Check data-icon="inline-start" />
                          允许
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-full justify-start px-2.5"
                          onClick={() =>
                            void runtime.submitApproval({ kind: "allow", persistTrust: true })
                          }
                          disabled={
                            runtime.busyAction === "approve" || !pendingApproval.trustTarget
                          }
                        >
                          <ShieldCheck data-icon="inline-start" />
                          始终信任
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-full justify-start px-2.5"
                          onClick={() => void runtime.submitApproval({ kind: "deny" })}
                          disabled={runtime.busyAction === "approve"}
                        >
                          <X data-icon="inline-start" />
                          拒绝
                        </Button>
                      </div>
                      <div className="flex min-h-9 items-stretch overflow-hidden rounded-md border border-input bg-transparent focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20">
                        <Textarea
                          value={runtime.approvalGuidance}
                          onChange={(event) => runtime.setApprovalGuidance(event.target.value)}
                          placeholder="需要调整时，写给模型的说明"
                          className="min-h-9 flex-1 resize-none rounded-none border-0 bg-transparent px-2.5 py-2 text-sm shadow-none focus-visible:ring-0"
                        />
                        <Button
                          size="icon-sm"
                          variant="outline"
                          className="h-auto w-9 self-stretch rounded-none border-0 border-l border-border/60 bg-transparent text-muted-foreground shadow-none hover:bg-muted/35 hover:text-foreground disabled:bg-transparent"
                          onClick={() =>
                            void runtime.submitApproval({
                              kind: "guidance",
                              userMessage: runtime.approvalGuidance,
                            })
                          }
                          disabled={
                            runtime.busyAction === "approve" ||
                            runtime.approvalGuidance.trim().length === 0
                          }
                        >
                          <MessageSquareText />
                          <span className="sr-only">发送说明</span>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}

                <div className="relative">
                <div className="relative z-10 grid gap-1.5">
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
                          onApplySuggestion={(suggestion) => {
                            applySlashSuggestion(`${suggestion.alias} `);
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                  <ComposerSurface
                    value={runtime.composer}
                    onChange={runtime.setComposer}
                    onSubmit={submitComposerMessage}
                    onAbort={() => void runtime.abortConversation()}
                    placeholder={activeSessionReadOnly ? "调试会话只读，无法发送消息…" : "输入消息…"}
                    localFileAttachments={runtime.composerLocalFileAttachments}
                    models={models}
                    catalogHints={snapshot?.config.modelCatalogHints}
                    activeModel={runtime.settings.activeModel}
                    planMode={runtime.settings.planMode}
                    loopEnabled={snapshot?.conversation.loopEnabled === true}
                    onModelSelect={runtime.setActiveModel}
                    onModelReasoningEffortSelect={runtime.setModelReasoningEffort}
                    onPlanModeChange={(planMode) => {
                      void runtime.saveSettingsPatch({ planMode });
                    }}
                    onLoopEnabledChange={(enabled) => {
                      void runtime.setLoopEnabled(enabled);
                    }}
                    textareaRef={composerTextareaRef}
                    onKeyDown={handleComposerSuggestionKeyDown}
                    onSelectionChange={(selectionStart) => {
                      if (selectionStart !== null) {
                        setComposerCursorCodeUnits(selectionStart);
                      }
                    }}
                    canSend={composerCanSend}
                    canAbort={conversationInterruptible}
                    busy={runtime.busyAction === "send" && !conversationInterruptible}
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
                    <div className="relative z-0 -mx-3 -mt-4 bg-background px-3 pt-[calc(1rem+0.375rem)] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
                      <div className="flex justify-start px-3">
                        <ApprovalLevelMenu
                          approvalLevel={snapshot?.conversation.approvalLevel ?? "default"}
                          disabled={activeSessionReadOnly}
                          onApprovalLevelChange={(level) => {
                            void runtime.setApprovalLevel(level);
                          }}
                        />
                      </div>
                      {snapshot?.conversation.pendingQuestions ? (
                        <p className="px-0.5 text-xs leading-relaxed text-muted-foreground">
                          请先完成上方问卷
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
              readManagedImagePreviewDataUrl={runtime.readManagedImagePreviewDataUrl}
              plan={snapshot?.plan ?? { path: "", exists: false }}
              onStartImplementing={() => {
                void runtime.sendMessage({ text: START_IMPLEMENTING_SLASH_ALIAS });
              }}
              startImplementingDisabled={startImplementingDisabled}
              autoRevealPlanNonce={workspaceFilesPlanRevealNonce}
              tab={workspaceToolsTab}
              onTabChange={setWorkspaceToolsTab}
              open={workspaceToolsOpen}
              widthPx={workspaceToolsWidthPx}
              onWidthPxChange={setWorkspaceToolsWidthPx}
            />
            </div>
          </div>
        )}
        </div>
      </div>

      <Dialog open={Boolean(pendingQuestions)}>
        <DialogContent className="max-w-4xl p-0" showCloseButton={false}>
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>
              {pendingQuestions?.request.title ?? "还需要确认几个问题"}
            </DialogTitle>
            <DialogDescription>
              Use the structured questionnaire below to resume the host runtime.
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
              跳过
            </Button>
            <Button
              onClick={() => void runtime.submitQuestions()}
              disabled={runtime.busyAction === "questions"}
            >
              {runtime.busyAction === "questions" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              提交答案
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
              {branchCheckoutBlockedByChanges ? "无法切换分支" : "切换分支"}
            </DialogTitle>
            <DialogDescription>
              {branchCheckoutBlockedByChanges ? (
                <>
                  工作区有未提交的更改，无法切换到「{snapshot?.git.selectedBranch ?? snapshot?.git.branch}」。
                  放弃更改后，这些本地修改将永久丢失。
                </>
              ) : (
                <>
                  发送前将切换到分支「{snapshot?.git.selectedBranch ?? snapshot?.git.branch}」。
                  {snapshot?.git.hasChanges
                    ? " 检测到未提交更改，切换可能失败。"
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
              取消
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
                放弃更改并切换
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={confirmBranchCheckoutAndSend}
                disabled={commitBusy}
              >
                {commitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                切换并发送
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={commitDialogOpen}
        onOpenChange={(open) => {
          setCommitDialogOpen(open);
          if (!open) {
            setCommitMode("commit");
            setCommitMessageDraft("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>提交更改</DialogTitle>
            <DialogDescription>
              {snapshot?.git.branch
                ? `当前分支：${snapshot.git.branch}`
                : "为当前工作区创建一次 Git 提交。"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label htmlFor="commit-message-input">提交信息</Label>
              <Textarea
                id="commit-message-input"
                value={commitMessageDraft}
                onChange={(event) => setCommitMessageDraft(event.target.value)}
                placeholder="提交信息，为空将自动生成"
                className="min-h-28"
                autoComplete="off"
                disabled={runtime.busyAction === "git"}
              />
            </div>
            <div className="grid gap-2">
              <Label>方式</Label>
              <div
                role="tablist"
                aria-label="提交方式"
                className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
              >
                {commitModeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={commitMode === option.value}
                    className={cn(
                      "rounded-md px-2.5 text-xs font-medium transition-colors",
                      commitMode === option.value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    disabled={runtime.busyAction === "git"}
                    onClick={() => setCommitMode(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {commitModeOptions.find((option) => option.value === commitMode)?.hint}
              </p>
            </div>
            {runtime.runtimeError ? (
              <p className="text-sm leading-relaxed text-destructive">{runtime.runtimeError}</p>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCommitDialogOpen(false)}
              disabled={runtime.busyAction === "git"}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={submitCommitDialog}
              disabled={commitActionDisabled || commitBusy}
            >
              {commitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {commitMode === "commit-and-push" ? "提交并推送" : "提交"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mergeDialogOpen}
        onOpenChange={(open) => {
          setMergeDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>合并至默认分支</DialogTitle>
            <DialogDescription>
              {snapshot?.git.worktreeBranch && snapshot?.git.defaultBranch
                ? `将 ${snapshot.git.worktreeBranch} 合并到 ${snapshot.git.defaultBranch}。`
                : "将当前分支合并到默认分支。"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <p className="text-sm text-muted-foreground">
              请确保 Worktree 中的更改已提交；默认分支上不能有未提交更改。
            </p>
            {runtime.runtimeError && mergeDialogOpen ? (
              <p className="text-sm leading-relaxed text-destructive">{runtime.runtimeError}</p>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMergeDialogOpen(false)}
              disabled={commitBusy}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={submitMergeDialog}
              disabled={mergeActionDisabled || commitBusy}
            >
              {commitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              合并
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
