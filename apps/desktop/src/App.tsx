import { useEffect, useState } from "react";

import { ChevronDown, LoaderCircle, PanelLeftClose, PanelLeftOpen, RefreshCw, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import { useTheme } from "@/hooks/useTheme";
import {
  desktopNativeThemeForPreference,
  resolveDark,
  syncDesktopWindowFrame,
  type ThemePreference,
} from "@/lib/theme";
import { cn } from "@/lib/utils";
import { DesktopTitleBar } from "@/components/desktop-title-bar";
import { SessionSidebar, mcpBadgeText } from "@/components/session-sidebar";
import type {
  AskQuestionsQuestionSpec,
  ConversationMessageSnapshot,
  DesktopSnapshot,
  ToolBlockSnapshot,
} from "@/types";

function toolPhaseVariant(
  phase: ToolBlockSnapshot["phase"],
): "secondary" | "outline" | "default" | "destructive" {
  switch (phase) {
    case "pending-approval":
      return "secondary";
    case "running":
      return "outline";
    case "failed":
      return "destructive";
    default:
      return "default";
  }
}

function toolPhaseLabel(phase: ToolBlockSnapshot["phase"]): string {
  switch (phase) {
    case "pending-approval":
      return "待审批";
    case "running":
      return "进行中";
    case "failed":
      return "失败";
    default:
      return "完成";
  }
}

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

function messageRoleLabel(role: ConversationMessageSnapshot["role"]) {
  return role === "user" ? "User" : "Assistant";
}

function messageRoleVariant(
  role: ConversationMessageSnapshot["role"],
): "outline" | "secondary" {
  return role === "user" ? "secondary" : "outline";
}

function MessageCard({ message }: { message: ConversationMessageSnapshot }) {
  return (
    <div
      id={`message-${message.id}`}
      className="scroll-mt-6 space-y-3 rounded-xl border border-border/20 bg-muted/5 p-4"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={messageRoleVariant(message.role)}>
            {messageRoleLabel(message.role)}
          </Badge>
          {message.pending ? <Badge variant="secondary">Streaming</Badge> : null}
          {message.tool ? (
            <Badge variant={toolPhaseVariant(message.tool.phase)}>
              {message.tool.toolName} · {toolPhaseLabel(message.tool.phase)}
            </Badge>
          ) : null}
        </div>
        <div className="space-y-4">
        {message.content.trim() ? (
          <pre className="whitespace-pre-wrap break-words rounded-xl bg-muted/40 p-4 text-sm leading-7">
            {message.content}
          </pre>
        ) : null}
        {message.tool ? (
          <div className="space-y-3 rounded-xl border border-border/50 bg-background/50 p-4">
            <p className="font-medium">{message.tool.headline}</p>
            {message.tool.detailLines.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {message.tool.detailLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
            {message.tool.argsExcerpt ? (
              <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 text-xs leading-6">
                {message.tool.argsExcerpt}
              </pre>
            ) : null}
            {message.tool.outputExcerpt ? (
              <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 text-xs leading-6">
                {message.tool.outputExcerpt}
              </pre>
            ) : null}
          </div>
        ) : null}
        {message.aux?.thinking ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Thinking
            </p>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">
              {message.aux.thinking}
            </pre>
          </div>
        ) : null}
        {message.aux?.compaction ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-4">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Compaction
            </p>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground">
              {message.aux.compaction}
            </pre>
          </div>
        ) : null}
        </div>
      </div>
    </div>
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
  const pendingApproval = snapshot?.conversation.pendingToolApproval;
  const pendingQuestions = runtime.pendingQuestions;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarNarrow, setSidebarNarrow] = useState(false);
  const activeFilePath = snapshot?.activeSession?.filePath ?? null;
  const winElectronChrome = isWin32ElectronShell();

  return (
    <div
      className={cn(
        "flex h-[100dvh] min-h-0 flex-col text-foreground",
        useMicaBackdrop ? "bg-transparent" : "bg-background",
      )}
    >
      {winElectronChrome ? <DesktopTitleBar useMicaBackdrop={useMicaBackdrop} /> : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!winElectronChrome ? (
          <div
            className={cn(
              "h-px w-full shrink-0",
              // 与 SessionSidebar 竖线：关 Mica 时略提高对比，避免深色下「贴成一块」
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
            "h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none",
            sidebarNarrow ? "w-12" : "w-[min(16rem,40vw)]",
          )}
        >
          <SessionSidebar
            narrow={sidebarNarrow}
            sessions={runtime.sessions}
            activeFilePath={activeFilePath}
            onNewSession={() => void runtime.resetSession()}
            onSelectSession={(path) => void runtime.openSession(path)}
            onOpenSettings={() => setSettingsOpen(true)}
            hostStatus={runtime.summary.hostStatus}
            mcpState={mcpBadgeText(snapshot)}
            micaStyle={useMicaBackdrop}
            busy={runtime.busyAction === "session" || runtime.busyAction === "reset"}
          />
        </div>

        {/* 勿用透明：Mica 在「系统浅 / 应用深」时此处会透出亮色底，形成侧栏与主区之间的白条 */}
        <div className="z-20 flex h-full shrink-0 flex-col self-stretch bg-background pt-2.5 pr-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 rounded-l-none rounded-r-md border border-l-0 border-border/50 bg-background/95 text-foreground/90 shadow-sm hover:bg-foreground/[0.06] dark:border-white/12"
            onClick={() => setSidebarNarrow((c) => !c)}
            aria-label={sidebarNarrow ? "展开侧栏" : "收为窄栏"}
            aria-expanded={!sidebarNarrow}
            aria-controls="session-sidebar-panel"
          >
            {sidebarNarrow ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
          </Button>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <ScrollArea
            className="min-h-0 flex-1"
            type="hover"
            scrollHideDelay={450}
          >
            {messages.length === 0 ? (
              <div className="box-border flex min-h-[calc(100dvh-13rem)] w-full items-center justify-center px-4">
                <p className="text-center text-2xl font-normal tracking-tight text-foreground">
                  {"Let's build"}
                </p>
              </div>
            ) : (
              <div className="space-y-4 overflow-x-hidden px-4 py-3">
                {messages.map((message) => (
                  <MessageCard key={message.id} message={message} />
                ))}
              </div>
            )}
          </ScrollArea>

            <div
              className={cn(
                "shrink-0 space-y-4 border-t px-4 py-4",
                useMicaBackdrop
                  ? "border-border/15"
                  : "border-border/30 dark:border-white/10",
              )}
            >
              {runtime.runtimeError ? (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                  {runtime.runtimeError}
                </div>
              ) : null}

              {pendingApproval ? (
                <Card className="border-border/60 bg-background/70">
                  <CardHeader>
                    <CardTitle>{pendingApproval.toolName}</CardTitle>
                    <CardDescription>{pendingApproval.prompt}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3 sm:flex-row">
                    <Input
                      value={runtime.approvalMessage}
                      onChange={(event) => runtime.setApprovalMessage(event.target.value)}
                      placeholder="输入审批回复（如 y / n / t）"
                    />
                    <Button
                      onClick={() => void runtime.submitApproval()}
                      disabled={runtime.busyAction === "approve"}
                    >
                      提交审批
                    </Button>
                  </CardContent>
                </Card>
              ) : null}

              <div className="grid gap-2">
                <div
                  className="relative overflow-hidden rounded-xl border border-border/60 bg-muted/20"
                >
                  <Textarea
                    value={runtime.composer}
                    onChange={(event) => runtime.setComposer(event.target.value)}
                    placeholder="输入消息…"
                    className="min-h-[7.5rem] w-full resize-y border-0 bg-transparent px-3 pb-12 pt-3 text-sm leading-relaxed shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 md:min-h-[8.5rem]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        if (
                          runtime.summary.canSend &&
                          runtime.busyAction !== "send" &&
                          runtime.busyAction !== "session"
                        ) {
                          void runtime.sendMessage();
                        }
                      }
                    }}
                  />
                  <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 px-2.5 py-1.5">
                    {models.length > 0 ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label="选择模型"
                            className="inline-flex h-8 max-w-[10rem] shrink-0 items-center gap-0.5 rounded-md border-0 bg-transparent pr-1 pl-1.5 text-left text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted/20 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                          >
                            <span
                              className="min-w-0 flex-1 truncate"
                              title={runtime.settings.activeModel}
                            >
                              {runtime.settings.activeModel}
                            </span>
                            <ChevronDown
                              className="size-3.5 shrink-0 text-muted-foreground/80"
                              aria-hidden
                            />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" side="top" className="max-w-md">
                          {models.map((model) => (
                            <DropdownMenuItem
                              key={model.name}
                              onSelect={() => {
                                runtime.setActiveModel(model.name);
                              }}
                              className={cn(
                                model.name === runtime.settings.activeModel &&
                                  "bg-accent/40",
                              )}
                            >
                              <span
                                className="block w-full min-w-0 break-all pr-1 text-left"
                                title={model.name}
                              >
                                {model.name}
                              </span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="px-1.5 text-xs text-muted-foreground">无可用模型</span>
                    )}
                    <Button
                      type="button"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-xl shadow-sm"
                      onClick={() => void runtime.sendMessage()}
                      disabled={
                        !runtime.summary.canSend ||
                        runtime.busyAction === "send" ||
                        runtime.busyAction === "session"
                      }
                      title="发送（Ctrl+Enter）"
                    >
                      {runtime.busyAction === "send" ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Send className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
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

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="spirit-scroll max-h-[90vh] max-w-md overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>设置</DialogTitle>
            <DialogDescription>工作区与连接；保存后生效。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-3">
              <div>
                <Label className="text-foreground">主题</Label>
                <p className="mt-1 text-xs text-muted-foreground">立即生效</p>
              </div>
              <RadioGroup
                value={theme}
                onValueChange={(v) => setTheme(v as ThemePreference)}
                className="grid gap-2"
              >
                <label
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50"
                  htmlFor="theme-system"
                >
                  <RadioGroupItem value="system" id="theme-system" />
                  <span>跟随系统</span>
                </label>
                <label
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50"
                  htmlFor="theme-light"
                >
                  <RadioGroupItem value="light" id="theme-light" />
                  <span>浅色</span>
                </label>
                <label
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50"
                  htmlFor="theme-dark"
                >
                  <RadioGroupItem value="dark" id="theme-dark" />
                  <span>深色</span>
                </label>
              </RadioGroup>
            </div>
            {isElectronShell ? (
              <div className="space-y-2">
                <div className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
                  <Checkbox
                    id="dlg-windows-mica"
                    checked={runtime.settings.windowsMica}
                    onCheckedChange={(v) =>
                      runtime.setSettings((current) => ({
                        ...current,
                        windowsMica: v === true,
                      }))
                    }
                    className="mt-0.5"
                  />
                  <div className="min-w-0 space-y-1">
                    <Label
                      htmlFor="dlg-windows-mica"
                      className="cursor-pointer text-foreground"
                    >
                      Windows 云母（Mica）背景
                    </Label>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      关闭后窗口使用实色背景。仅对 Windows 11 桌面版生效，需点击保存。
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>Workspace</Label>
              <div className="rounded-lg border border-border/50 bg-muted/20 p-2.5 text-xs leading-relaxed text-muted-foreground">
                {snapshot?.workspaceRoot ?? "Bootstrapping…"}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dlg-api-base">API Base</Label>
              <Input
                id="dlg-api-base"
                value={runtime.settings.apiBase}
                onChange={(event) =>
                  runtime.setSettings((current) => ({
                    ...current,
                    apiBase: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dlg-locale">UI locale</Label>
              <Input
                id="dlg-locale"
                value={runtime.settings.uiLocale}
                onChange={(event) =>
                  runtime.setSettings((current) => ({
                    ...current,
                    uiLocale: event.target.value,
                  }))
                }
                placeholder="zh-CN / en"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dlg-key">API Key</Label>
              <Input
                id="dlg-key"
                type="password"
                value={runtime.settings.apiKey}
                onChange={(event) =>
                  runtime.setSettings((current) => ({
                    ...current,
                    apiKey: event.target.value,
                  }))
                }
                placeholder={
                  snapshot?.config.activeApiKeyConfigured
                    ? "已配置，可留空保持不变"
                    : "输入 API Key"
                }
              />
            </div>
            {snapshot ? (
              <p className="text-xs text-muted-foreground">
                Rules {snapshot.rules.enabled}/{snapshot.rules.discovered} · Skills{" "}
                {snapshot.skills.enabled}/{snapshot.skills.discovered} · MCP 工具{" "}
                {snapshot.mcpStatus.cachedTools}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                onClick={() => void runtime.saveSettings().then(() => setSettingsOpen(false))}
                disabled={!runtime.apiReady || runtime.busyAction === "save"}
              >
                {runtime.busyAction === "save" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : null}
                保存
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void runtime.bootstrap()}
                disabled={!runtime.apiReady || runtime.busyAction === "bootstrap"}
              >
                <RefreshCw className="size-4" />
                重新装配
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void runtime.resetSession()}
                disabled={!runtime.apiReady || runtime.busyAction === "reset"}
              >
                重置会话
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
