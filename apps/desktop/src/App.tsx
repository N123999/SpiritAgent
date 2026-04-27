import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
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
  Dialog,
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
import { SkillSlashMenu } from "@/components/skill-slash-menu";
import { SettingsView } from "@/components/settings-view";
import { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import { useTheme } from "@/hooks/useTheme";
import {
  buildSkillSlashSuggestions,
  CREATE_SKILL_SLASH_ALIAS,
  currentSkillSlashQuery,
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
import { WorkspaceToolsDock } from "@/components/workspace-tools-panel";
import type {
  AskQuestionsQuestionSpec,
  ConversationMessageSnapshot,
  DesktopSnapshot,
  MessageRewindDraftState,
  ToolBlockSnapshot,
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

function ToolCallCollapsible({ tool }: { tool: ToolBlockSnapshot }) {
  const hasExpandableContent =
    tool.detailLines.length > 0 ||
    Boolean(tool.argsExcerpt?.trim()) ||
    Boolean(tool.outputExcerpt?.trim());

  if (!hasExpandableContent) {
    return (
      <div className="border-l-2 border-border/40 py-1 pl-2.5">
        <p className="text-sm font-medium text-foreground/90">{tool.headline}</p>
      </div>
    );
  }

  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-l-2 border-border/40 pl-2">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto min-h-7 w-full justify-start gap-1.5 px-0 py-1 text-left font-normal hover:bg-transparent hover:underline"
        >
          {open ? (
            <ChevronDown className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="min-w-0 flex-1 text-sm font-medium leading-snug">{tool.headline}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pb-1 pl-4 pt-0.5">
        {tool.detailLines.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-3.5 text-xs leading-relaxed text-muted-foreground">
            {tool.detailLines.map((line, i) => (
              <li key={`${i}:${line}`}>{line}</li>
            ))}
          </ul>
        ) : null}
        {tool.argsExcerpt ? (
          <pre className="overflow-x-auto rounded-md border border-border/30 bg-muted/25 p-2 font-mono text-xs leading-relaxed">
            {tool.argsExcerpt}
          </pre>
        ) : null}
        {tool.outputExcerpt ? (
          <pre className="overflow-x-auto rounded-md border border-border/30 bg-muted/25 p-2 font-mono text-xs leading-relaxed">
            {tool.outputExcerpt}
          </pre>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

type ComposerSurfaceProps = {
  value: string;
  placeholder: string;
  models: DesktopSnapshot["config"]["models"];
  activeModel: string;
  planMode: boolean;
  canSend: boolean;
  busy: boolean;
  onChange(value: string): void;
  onSubmit(): void;
  onModelSelect(name: string): void;
  onPlanModeChange(planMode: boolean): void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  onKeyDown?(event: ReactKeyboardEvent<HTMLTextAreaElement>): void;
};

function ComposerSurface({
  value,
  placeholder,
  models,
  activeModel,
  planMode,
  canSend,
  busy,
  onChange,
  onSubmit,
  onModelSelect,
  onPlanModeChange,
  textareaRef,
  onKeyDown,
}: ComposerSurfaceProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-background/55 shadow-sm backdrop-blur-xl transition-shadow focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/25 dark:border-white/12 supports-[backdrop-filter]:bg-background/40">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-[5.25rem] w-full resize-y rounded-none border-0 bg-transparent px-3 pb-12 pt-3 text-sm leading-relaxed shadow-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none md:min-h-[6rem]"
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) {
            return;
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (canSend && !busy) {
              onSubmit();
            }
          }
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-3 pb-2 pt-10">
        <div className="pointer-events-auto flex w-full max-w-full items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="运行方式"
                  className="inline-flex h-7 max-w-[9rem] shrink-0 items-center gap-0.5 rounded-md border-0 bg-transparent pr-0.5 pl-1 text-left text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
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
            {models.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="选择模型"
                    className="inline-flex h-7 max-w-[9rem] shrink-0 items-center gap-0.5 rounded-md border-0 bg-transparent pr-0.5 pl-1 text-left text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span className="min-w-0 flex-1 truncate" title={activeModel}>
                      {activeModel}
                    </span>
                    <ChevronDown className="size-3 shrink-0 text-muted-foreground/80" aria-hidden />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="max-w-md text-xs">
                  {models.map((model) => (
                    <DropdownMenuItem
                      key={model.name}
                      onSelect={() => onModelSelect(model.name)}
                      className={cn(model.name === activeModel && "bg-accent/40")}
                    >
                      <span className="block w-full min-w-0 break-all pr-1 text-left" title={model.name}>
                        {model.name}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="px-1 text-xs text-muted-foreground">无可用模型</span>
            )}
          </div>
          <Button
            type="button"
            className="size-8 shrink-0 rounded-full p-0 shadow-none [&_svg]:size-3.5"
            onClick={onSubmit}
            disabled={!canSend || busy}
            title="发送（Ctrl+Enter）"
          >
            {busy ? (
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

function MessageCard({
  message,
  listIndex,
  compactAfterPrevious,
  rewindText,
  rewindSelected,
  rewindCanSubmit,
  rewindBusy,
  models,
  activeModel,
  planMode,
  onRewindChange,
  onRewindStart,
  onRewindSubmit,
  onModelSelect,
  onPlanModeChange,
}: {
  message: ConversationMessageSnapshot;
  listIndex: number;
  compactAfterPrevious: boolean;
  rewindText: string;
  rewindSelected: boolean;
  rewindCanSubmit: boolean;
  rewindBusy: boolean;
  models: DesktopSnapshot["config"]["models"];
  activeModel: string;
  planMode: boolean;
  onRewindChange(value: string): void;
  onRewindStart(message: ConversationMessageSnapshot): void;
  onRewindSubmit(): void;
  onModelSelect(name: string): void;
  onPlanModeChange(planMode: boolean): void;
}) {
  const isUser = message.role === "user";
  const canStartRewind = isUser && message.canRewind === true && !message.pending;
  const userBubble =
    "rounded-2xl rounded-br-md border border-border/50 bg-muted px-3 py-2.5 shadow-sm";

  return (
    <div
      id={conversationMessageDomId(message, listIndex)}
      className={cn(
        "scroll-mt-4 flex w-full pb-3 last:pb-0",
        compactAfterPrevious && "-mt-4",
        isUser ? "justify-end" : "justify-start",
        rewindSelected && "relative z-40",
      )}
    >
      <div
        className={cn(
          "min-w-0 space-y-2",
          isUser
            ? rewindSelected
              ? "ml-auto w-full max-w-[min(100%,36rem)]"
              : "max-w-[min(72%,22rem)]"
            : "w-full",
        )}
      >
        {rewindSelected ? (
          <ComposerSurface
            value={rewindText}
            onChange={onRewindChange}
            onSubmit={onRewindSubmit}
            placeholder="输入消息…"
            models={models}
            activeModel={activeModel}
            planMode={planMode}
            onModelSelect={onModelSelect}
            onPlanModeChange={onPlanModeChange}
            canSend={rewindCanSubmit}
            busy={rewindBusy}
          />
        ) : null}
        {!isUser && message.aux?.thinking ? (
          <div className="border-l border-dashed border-muted-foreground/35 py-0.5 pl-2.5">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">
              Thinking
            </p>
            <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-muted-foreground">
              {message.aux.thinking}
            </pre>
          </div>
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
        {isUser && message.content.trim() && !rewindSelected ? (
          <pre
            className={cn(
              "whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground",
              userBubble,
              canStartRewind && "cursor-pointer transition-colors hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
            )}
            role={canStartRewind ? "button" : undefined}
            tabIndex={canStartRewind ? 0 : undefined}
            onClick={canStartRewind ? () => onRewindStart(message) : undefined}
            onKeyDown={
              canStartRewind
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onRewindStart(message);
                    }
                  }
                : undefined
            }
          >
            {message.content}
          </pre>
        ) : null}
        {!isUser && message.content.trim() ? (
          <MarkdownMessage content={message.content} className="font-sans" />
        ) : null}
        {!isUser && message.tool ? <ToolCallCollapsible tool={message.tool} /> : null}
      </div>
    </div>
  );
}

function isStandaloneAssistantAuxMessage(
  message: ConversationMessageSnapshot | undefined,
): boolean {
  return Boolean(
    message &&
      message.role === "assistant" &&
      !message.tool &&
      !message.content.trim() &&
      (message.aux?.thinking?.trim() || message.aux?.compaction?.trim()),
  );
}

function shouldCompactAfterPreviousMessage(
  previous: ConversationMessageSnapshot | undefined,
  current: ConversationMessageSnapshot,
): boolean {
  return Boolean(
    isStandaloneAssistantAuxMessage(previous) &&
      current.role === "assistant" &&
      !current.tool &&
      current.content.trim(),
  );
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

/** ghost 在 aria-expanded 时默认带 bg-muted，顶栏图标按钮需全透明底 */
const DESKTOP_CHROME_TOGGLE_ICON_BTN =
  "size-7 shrink-0 bg-transparent text-foreground/90 hover:bg-foreground/[0.06] hover:text-foreground dark:hover:bg-foreground/10 aria-expanded:bg-transparent dark:aria-expanded:bg-transparent aria-expanded:text-foreground aria-expanded:hover:bg-foreground/[0.06] dark:aria-expanded:hover:bg-foreground/10 [&_svg]:size-3.5";

function DesktopLayoutChromeBar({
  useMicaBackdrop,
  sessionSidebarOpen,
  onToggleSessionSidebar,
  showWorkspaceToggle,
  workspaceToolsOpen = false,
  onToggleWorkspaceTools,
}: {
  useMicaBackdrop: boolean;
  sessionSidebarOpen: boolean;
  onToggleSessionSidebar(): void;
  showWorkspaceToggle: boolean;
  workspaceToolsOpen?: boolean;
  onToggleWorkspaceTools?: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="侧栏与工具区"
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 px-1.5",
        showWorkspaceToggle ? "justify-between" : "justify-start",
        useMicaBackdrop ? "bg-background/85 backdrop-blur-md" : "bg-background",
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
  );
}

export default function App() {
  const { theme, setTheme } = useTheme();
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
  const rewindWarnings = snapshot?.conversation.rewindWarnings ?? [];
  const pendingApproval = snapshot?.conversation.pendingToolApproval;
  const pendingQuestions = runtime.pendingQuestions;
  const [rewindDraft, setRewindDraft] = useState<MessageRewindDraftState | null>(null);

  const [activeSurface, setActiveSurface] = useState<"conversation" | "settings">(
    "conversation",
  );
  const [settingsTab, setSettingsTab] = useState<SettingsSidebarTab>("basic");
  const [sessionSidebarOpen, setSessionSidebarOpen] = useState(true);
  const [workspaceToolsOpen, setWorkspaceToolsOpen] = useState(true);
  const [workspaceToolsWidthPx, setWorkspaceToolsWidthPx] = useState(320);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(-1);
  const activeFilePath = snapshot?.activeSession?.filePath ?? null;
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const winElectronChrome = isWin32ElectronShell();
  const settingsMode = activeSurface === "settings";
  const slashQuery = useMemo(() => currentSkillSlashQuery(runtime.composer), [runtime.composer]);
  const slashSuggestions = useMemo(
    () => buildSkillSlashSuggestions(slashQuery, snapshot?.skillsList ?? []),
    [slashQuery, snapshot?.skillsList],
  );

  useEffect(() => {
    setSlashSelectedIndex(-1);
  }, [slashQuery]);

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
    if (!rewindDraft) {
      return;
    }
    const stillAvailable = messages.some(
      (message) => message.id === rewindDraft.messageId && message.canRewind === true,
    );
    if (!stillAvailable) {
      setRewindDraft(null);
    }
  }, [messages, rewindDraft]);

  const startMessageRewind = (message: ConversationMessageSnapshot) => {
    if (!runtime.summary.canSend || runtime.busyAction || message.canRewind !== true) {
      return;
    }
    setRewindDraft({ messageId: message.id, text: message.content });
  };

  const submitMessageRewind = () => {
    if (!rewindDraft) {
      return;
    }
    void runtime
      .rewindAndSubmitMessage({
        messageId: rewindDraft.messageId,
        text: rewindDraft.text,
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

  const handleComposerSlashKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
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
      className={cn(
        "flex h-[100dvh] min-h-0 flex-col text-foreground",
        useMicaBackdrop ? "bg-transparent" : "bg-background",
      )}
    >
      <LaunchSplash active={launchSplashActive} />
      {winElectronChrome ? <DesktopTitleBar useMicaBackdrop={useMicaBackdrop} /> : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "h-full min-h-0 shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none motion-reduce:duration-0",
            sessionSidebarOpen ? "w-[min(16rem,40vw)]" : "w-0",
          )}
        >
          <div
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
              sessions={runtime.sessions}
              activeFilePath={activeFilePath}
              onNewSession={() => void runtime.resetSession()}
              onSelectSession={(path) => void runtime.openSession(path)}
              onOpenSettings={() => {
                setSessionSidebarOpen(true);
                setActiveSurface("settings");
              }}
              onBackToSessions={() => setActiveSurface("conversation")}
              settingsTab={settingsTab}
              onSettingsTabChange={setSettingsTab}
              hostStatus={runtime.summary.hostStatus}
              mcpState={mcpBadgeText(snapshot)}
              micaStyle={useMicaBackdrop}
              busy={
                runtime.busyAction === "session" ||
                runtime.busyAction === "reset" ||
                runtime.busyAction === "models"
              }
            />
          </div>
        </div>

        {settingsMode ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
            <DesktopLayoutChromeBar
              useMicaBackdrop={useMicaBackdrop}
              sessionSidebarOpen={sessionSidebarOpen}
              onToggleSessionSidebar={() => setSessionSidebarOpen((o) => !o)}
              showWorkspaceToggle={false}
            />
            <SettingsView
              tab={settingsTab}
              theme={theme}
              onThemeChange={setTheme}
              settings={runtime.settings}
              snapshot={snapshot}
              runtimeError={runtime.runtimeError}
              apiReady={runtime.apiReady}
              busyAction={runtime.busyAction}
              modelsBusy={runtime.busyAction === "models"}
              mcpsBusy={runtime.busyAction === "mcps"}
              skillsBusy={runtime.busyAction === "skills"}
              isElectronShell={isElectronShell}
              onSavePatch={runtime.saveSettingsPatch}
              onResetWebHostPairing={runtime.resetWebHostPairing}
              onBootstrap={runtime.bootstrap}
              onResetSession={runtime.resetSession}
              onAddModel={runtime.addModel}
              onRemoveModel={runtime.removeModel}
              onAddMcpServer={runtime.addMcpServer}
              onDeleteMcpServer={runtime.deleteMcpServer}
              onInspectMcpServer={runtime.inspectMcpServer}
              onCreateSkill={runtime.createSkill}
              onDeleteSkill={runtime.deleteSkill}
              onGenerateSkillNavigate={() => {
                setActiveSurface("conversation");
                applySlashSuggestion(`${CREATE_SKILL_SLASH_ALIAS} `);
              }}
            />
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden bg-background min-w-0">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background min-w-0">
              <DesktopLayoutChromeBar
                useMicaBackdrop={useMicaBackdrop}
                sessionSidebarOpen={sessionSidebarOpen}
                onToggleSessionSidebar={() => setSessionSidebarOpen((o) => !o)}
                showWorkspaceToggle
                workspaceToolsOpen={workspaceToolsOpen}
                onToggleWorkspaceTools={() => setWorkspaceToolsOpen((c) => !c)}
              />
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background text-sm">
              {rewindDraft ? (
                <button
                  type="button"
                  aria-label="取消回溯编辑"
                  className="fixed inset-0 z-30 cursor-default bg-background/35 backdrop-blur-sm"
                  onClick={() => setRewindDraft(null)}
                />
              ) : null}
              <ScrollArea
                className="min-h-0 flex-1 bg-background"
                type="hover"
                scrollHideDelay={450}
              >
                {/* min-h-full：短内容仍铺满视口；大 pb 为底部透明叠层留出可滚入的「床」，避免正文被输入区挡住 */}
                <div
                  className={cn(
                    "min-h-full w-full bg-background",
                    "pb-[calc(12rem+env(safe-area-inset-bottom,0px))]",
                  )}
                >
                  {messages.length === 0 ? (
                    <div
                      className={cn(
                        "mx-auto box-border flex min-h-[calc(100dvh-11rem)] w-full items-center justify-center px-3",
                        CONVERSATION_MAX_W,
                      )}
                    >
                      <p className="text-center text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
                        Start something.
                      </p>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "mx-auto w-full overflow-x-hidden px-3 pt-6 sm:pt-7",
                        CONVERSATION_MAX_W,
                      )}
                    >
                      <div className="space-y-3">
                        {messages.map((message, index) => (
                          <MessageCard
                            key={conversationMessageDomId(message, index)}
                            listIndex={index}
                            message={message}
                            compactAfterPrevious={shouldCompactAfterPreviousMessage(messages[index - 1], message)}
                            rewindSelected={rewindDraft?.messageId === message.id}
                            rewindText={
                              rewindDraft?.messageId === message.id ? rewindDraft.text : ""
                            }
                            rewindCanSubmit={
                              runtime.summary.canSend &&
                              runtime.busyAction !== "rewind" &&
                              runtime.busyAction !== "session" &&
                              Boolean(rewindDraft?.text.trim())
                            }
                            rewindBusy={runtime.busyAction === "rewind"}
                            models={models}
                            activeModel={runtime.settings.activeModel}
                            planMode={runtime.settings.planMode}
                            onRewindStart={startMessageRewind}
                            onRewindChange={(value) => {
                              setRewindDraft((current) =>
                                current ? { ...current, text: value } : current,
                              );
                            }}
                            onRewindSubmit={submitMessageRewind}
                            onModelSelect={runtime.setActiveModel}
                            onPlanModeChange={(planMode) => {
                              void runtime.saveSettingsPatch({ planMode });
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-transparent pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]">
                <div className={cn("pointer-events-auto mx-auto w-full space-y-2 px-3", CONVERSATION_MAX_W)}>
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
                    <CardHeader className="space-y-1 px-3 py-2">
                      <CardTitle className="text-base leading-tight">{pendingApproval.toolName}</CardTitle>
                      <CardDescription className="text-xs leading-relaxed">
                        {pendingApproval.prompt}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 px-3 pb-3 pt-0 sm:flex-row sm:items-center">
                      <Input
                        value={runtime.approvalMessage}
                        onChange={(event) => runtime.setApprovalMessage(event.target.value)}
                        placeholder="输入审批回复（如 y / n / t）"
                        className="h-8 text-sm"
                      />
                      <Button
                        size="sm"
                        className="h-8 shrink-0 text-sm"
                        onClick={() => void runtime.submitApproval()}
                        disabled={runtime.busyAction === "approve"}
                      >
                        提交审批
                      </Button>
                    </CardContent>
                  </Card>
                ) : null}

                <div className="grid gap-1.5">
                  {slashQuery ? (
                    <SkillSlashMenu
                      suggestions={slashSuggestions}
                      selectedIndex={slashSelectedIndex}
                      onSelectIndex={setSlashSelectedIndex}
                      onApplySuggestion={(suggestion) => {
                        applySlashSuggestion(`${suggestion.alias} `);
                      }}
                    />
                  ) : null}
                  <ComposerSurface
                    value={runtime.composer}
                    onChange={runtime.setComposer}
                    onSubmit={() => void runtime.sendMessage()}
                    placeholder="输入消息…"
                    models={models}
                    activeModel={runtime.settings.activeModel}
                    planMode={runtime.settings.planMode}
                    onModelSelect={runtime.setActiveModel}
                    onPlanModeChange={(planMode) => {
                      void runtime.saveSettingsPatch({ planMode });
                    }}
                    textareaRef={composerTextareaRef}
                    onKeyDown={handleComposerSlashKeyDown}
                    canSend={
                      runtime.summary.canSend &&
                      runtime.busyAction !== "send" &&
                      runtime.busyAction !== "session"
                    }
                    busy={runtime.busyAction === "send"}
                  />
                  {snapshot?.conversation.pendingQuestions ? (
                    <p className="px-0.5 text-xs leading-relaxed text-muted-foreground">
                      请先完成上方问卷
                    </p>
                  ) : null}
                </div>
                </div>
              </div>
            </div>
            </div>
            <WorkspaceToolsDock
              workspaceRoot={snapshot?.workspaceRoot ?? ""}
              listExplorerChildren={runtime.listWorkspaceExplorerChildren}
              open={workspaceToolsOpen}
              widthPx={workspaceToolsWidthPx}
              onWidthPxChange={setWorkspaceToolsWidthPx}
            />
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
    </div>
  );
}
