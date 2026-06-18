import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { useTranslation } from "react-i18next";
import type * as Monaco from "monaco-editor";

import { Eye, PanelLeftClose, PanelLeftOpen, Play, SquarePen } from "lucide-react";

import { MarkdownMessage } from "@/components/markdown-message";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { WorkspaceFilesPanel } from "@/components/workspace-files-panel";
import {
  FileDomSelectionMenu,
  FileMonacoSelectionMenu,
} from "@/components/workspace-file-selection-menu";
import {
  WorkspaceMonacoEditor,
  type WorkspaceMonacoEditorHandle,
} from "@/components/workspace-monaco-editor";
import { cn } from "@/lib/utils";
import { DESKTOP_CHROME_TOGGLE_ICON_BTN, DESKTOP_SHELL_LAYOUT_TRANSITION } from "@/lib/desktop-chrome";
import { desktopMicaFileDetailSurfaceClass } from "@/lib/desktop-mica-surface";
import {
  WORKSPACE_FILES_TREE_MIN_WIDTH_PX,
  computeWorkspaceFilesTreeMaxWidthPx,
  readWorkspaceFilesTreeWidthPx,
  writeWorkspaceFilesTreeWidthPx,
} from "@/lib/layout-prefs";
import { useWorkspaceToolsShellHorizontalDivider } from "@/lib/use-workspace-tools-shell-horizontal-divider";
import { FILES_EXPLORER_TOOLBAR_SHELL_DIVIDER_ATTR } from "@/lib/workspace-tools-panel-edge";
import {
  isUnderWorkspaceEntryPath,
  remapWorkspaceEntryPath,
} from "@/lib/workspace-entry-path-sync";
import type {
  EditorFileTarget,
  WorkspaceEditorViewMode,
} from "@/lib/workspace-editor-navigation";
import type { FileSnippetAttachment } from "@/lib/file-snippet-attachment";
import { installContainedSelectAll } from "@/lib/contained-text-selection";
import type {
  PlanSnapshot,
  WorkspaceExplorerListResult,
  WorkspaceReadTextFileResult,
  WriteHostTextFileRequest,
  WriteWorkspaceTextFileRequest,
} from "@/types";

type SelectedWorkspaceEntry = { kind: "workspace"; relativePath: string };
type SelectedExternalEntry = { kind: "external"; absolutePath: string };
type SelectedPlanEntry = { kind: "plan" };
type SelectedEntry = SelectedWorkspaceEntry | SelectedExternalEntry | SelectedPlanEntry | null;
type MarkdownViewMode = "preview" | "edit";

type LoadedDoc =
  | { status: "loading"; readOnly: boolean; title: string; subtitle: string }
  | { status: "ready"; text: string; readOnly: boolean; title: string; subtitle: string }
  | { status: "error"; message: string; readOnly: boolean; title: string; subtitle: string }
  | { status: "empty"; message: string; readOnly: boolean; title: string; subtitle: string };

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function pathBasename(rel: string): string {
  const n = rel.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) || rel : rel;
}

function isMarkdownPath(rel: string): boolean {
  return /\.(md|mdx|markdown|mdown|mkd|mkdn|mdwn)$/i.test(rel);
}

function scrollAreaViewport(root: ComponentRef<typeof ScrollArea> | null): HTMLElement | null {
  return root?.querySelector("[data-radix-scroll-area-viewport]") ?? null;
}

type WorkspaceFilesExplorerToolbarProps = {
  fileTreeOpen: boolean;
  onToggleFileTree: () => void;
  fileOpen: boolean;
  headerTitle: string;
  headerSubtitle: string;
  isMarkdownDocument: boolean;
  markdownViewMode: MarkdownViewMode;
  onToggleMarkdownViewMode: (value: string) => void;
  docReady: boolean;
  docReadOnly: boolean;
  showStartImplementing: boolean;
  startImplementingDisabled: boolean;
  onStartImplementing?: () => void;
};

function WorkspaceFilesExplorerToolbar({
  fileTreeOpen,
  onToggleFileTree,
  fileOpen,
  headerTitle,
  headerSubtitle,
  isMarkdownDocument,
  markdownViewMode,
  onToggleMarkdownViewMode,
  docReady,
  docReadOnly,
  showStartImplementing,
  startImplementingDisabled,
  onStartImplementing,
}: WorkspaceFilesExplorerToolbarProps) {
  const { t } = useTranslation();
  const toolbarRef = useRef<HTMLDivElement>(null);

  useWorkspaceToolsShellHorizontalDivider(
    toolbarRef,
    {
      enabled: true,
      edge: "bottom",
      dividerAttr: FILES_EXPLORER_TOOLBAR_SHELL_DIVIDER_ATTR,
    },
    [fileTreeOpen, fileOpen, headerTitle, isMarkdownDocument, markdownViewMode],
  );

  return (
    <div
      ref={toolbarRef}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1 pl-1 pr-2",
        fileOpen && "justify-between",
      )}
      role="toolbar"
      aria-label={t("workspace.fileExplorerToolbar")}
    >
      <div className="flex min-w-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={DESKTOP_CHROME_TOGGLE_ICON_BTN}
          onClick={onToggleFileTree}
          aria-label={fileTreeOpen ? t("workspace.hideFileTree") : t("workspace.showFileTree")}
          aria-expanded={fileTreeOpen}
          title={fileTreeOpen ? t("workspace.hideFileTree") : t("workspace.showFileTree")}
        >
          {fileTreeOpen ? (
            <PanelLeftClose className="size-3.5" aria-hidden />
          ) : (
            <PanelLeftOpen className="size-3.5" aria-hidden />
          )}
        </Button>
        {fileOpen ? (
          <span
            className="min-w-0 truncate text-xs font-medium text-foreground/95"
            title={headerSubtitle || undefined}
          >
            {headerTitle}
          </span>
        ) : null}
      </div>
      {fileOpen ? (
        <div className="flex shrink-0 items-center gap-0.5">
          {isMarkdownDocument ? (
            <ToggleGroup
              type="single"
              size="sm"
              value={markdownViewMode}
              onValueChange={onToggleMarkdownViewMode}
              className="rounded-md border border-border/50 bg-background/80 p-px"
            >
              <ToggleGroupItem
                value="preview"
                className="h-6 gap-1 rounded-sm px-1.5 text-[10px]"
                aria-label={t("workspace.markdownPreview")}
                title={t("workspace.markdownPreview")}
                disabled={!docReady}
              >
                <Eye className="size-3" aria-hidden />
                {t("workspace.preview")}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="edit"
                className="h-6 gap-1 rounded-sm px-1.5 text-[10px]"
                aria-label={t("workspace.markdownEdit")}
                title={docReadOnly ? t("workspace.currentDocReadOnly") : t("workspace.markdownEdit")}
                disabled={!docReady || docReadOnly}
              >
                <SquarePen className="size-3" aria-hidden />
                {t("workspace.edit")}
              </ToggleGroupItem>
            </ToggleGroup>
          ) : null}
          {showStartImplementing ? (
            <button
              type="button"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-foreground/[0.06] enabled:hover:text-foreground disabled:opacity-50 dark:enabled:hover:bg-foreground/10"
              disabled={startImplementingDisabled}
              aria-label={t("workspace.startImplementing")}
              title={t("workspace.startImplementing")}
              onClick={onStartImplementing}
            >
              <Play className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export type WorkspaceFilesTabProps = {
  workspaceRoot: string;
  plan: PlanSnapshot;
  listExplorerChildren: (relativePath: string) => Promise<WorkspaceExplorerListResult>;
  readWorkspaceTextFile: (relativePath: string) => Promise<WorkspaceReadTextFileResult>;
  writeWorkspaceTextFile: (request: WriteWorkspaceTextFileRequest) => Promise<void>;
  readHostTextFile: (absolutePath: string) => Promise<WorkspaceReadTextFileResult>;
  writeHostTextFile: (request: WriteHostTextFileRequest) => Promise<void>;
  readManagedImagePreviewDataUrl?: (reference: string) => Promise<string | null>;
  onStartImplementing?: () => void;
  startImplementingDisabled?: boolean;
  autoRevealPlanNonce?: number;
  /** 为 false 时不响应 Plan 自动展开（多 files 选项卡时仅目标 tab 为 true） */
  planRevealEnabled?: boolean;
  autoRevealFileNonce?: number;
  /** 为 false 时不响应外部打开文件请求（多 files 选项卡时仅目标 tab 为 true） */
  fileRevealEnabled?: boolean;
  fileRevealPath?: string;
  fileRevealAbsolutePath?: string;
  fileRevealScope?: EditorFileTarget["scope"];
  fileRevealViewMode?: WorkspaceEditorViewMode;
  fileRevealDirectoryOnly?: boolean;
  /** 当前打开文件名变化时通知父层，用于选项卡标题显示；无选中时传 undefined */
  onTitleChange?: (title: string | undefined) => void;
  onFileSnippetAddToSession?: (attachment: FileSnippetAttachment) => void;
  onWorkspaceFileAddToSession?: (relativePath: string) => void;
  gitRevision?: number;
  useMicaBackdrop?: boolean;
};

export function WorkspaceFilesTab({
  workspaceRoot,
  plan,
  listExplorerChildren,
  readWorkspaceTextFile,
  writeWorkspaceTextFile,
  readHostTextFile,
  writeHostTextFile,
  readManagedImagePreviewDataUrl,
  onStartImplementing,
  startImplementingDisabled = false,
  autoRevealPlanNonce = 0,
  planRevealEnabled = true,
  autoRevealFileNonce = 0,
  fileRevealEnabled = false,
  fileRevealPath = "",
  fileRevealAbsolutePath = "",
  fileRevealScope = "workspace",
  fileRevealViewMode = "edit",
  fileRevealDirectoryOnly = false,
  onTitleChange,
  onFileSnippetAddToSession,
  onWorkspaceFileAddToSession,
  gitRevision,
  useMicaBackdrop = false,
}: WorkspaceFilesTabProps) {
  const { t } = useTranslation();
  type MonacoEditor = Monaco.editor.IStandaloneCodeEditor;
  const [selectedEntry, setSelectedEntry] = useState<SelectedEntry>(null);
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [saveError, setSaveError] = useState("");
  const [draftText, setDraftText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [markdownViewMode, setMarkdownViewMode] = useState<MarkdownViewMode>("edit");
  const [fileTreeOpen, setFileTreeOpen] = useState(true);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const fileTreeDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const latestFileTreeWidthPxRef = useRef(readWorkspaceFilesTreeWidthPx());
  const [fileTreeWidthPx, setFileTreeWidthPx] = useState(() => readWorkspaceFilesTreeWidthPx());
  const [isResizingFileTree, setIsResizingFileTree] = useState(false);
  const [splitContainerWidthPx, setSplitContainerWidthPx] = useState(0);
  const [monacoEditor, setMonacoEditor] = useState<MonacoEditor | null>(null);
  const editorRef = useRef<WorkspaceMonacoEditorHandle>(null);
  const previewScrollRef = useRef<ComponentRef<typeof ScrollArea>>(null);
  const previewRootRef = useRef<HTMLElement | null>(null);
  const monacoContainerRef = useRef<HTMLDivElement>(null);
  const onTitleChangeRef = useRef(onTitleChange);
  useLayoutEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  });
  const prevSelectedEntryRef = useRef(selectedEntry);

  latestFileTreeWidthPxRef.current = fileTreeWidthPx;

  const maxFileTreeWidthPx = useMemo(
    () =>
      splitContainerWidthPx > 0
        ? computeWorkspaceFilesTreeMaxWidthPx(splitContainerWidthPx)
        : computeWorkspaceFilesTreeMaxWidthPx(1200),
    [splitContainerWidthPx],
  );

  const clampFileTreeWidth = useCallback(
    (value: number) =>
      Math.min(maxFileTreeWidthPx, Math.max(WORKSPACE_FILES_TREE_MIN_WIDTH_PX, value)),
    [maxFileTreeWidthPx],
  );

  useEffect(() => {
    const container = splitContainerRef.current;
    if (!container) {
      return;
    }
    const syncContainerWidth = () => {
      setSplitContainerWidthPx(container.clientWidth);
    };
    syncContainerWidth();
    const observer = new ResizeObserver(syncContainerWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fileTreeOpen, selectedEntry]);

  useEffect(() => {
    if (fileTreeWidthPx <= maxFileTreeWidthPx) {
      return;
    }
    setFileTreeWidthPx(clampFileTreeWidth(fileTreeWidthPx));
  }, [clampFileTreeWidth, fileTreeWidthPx, maxFileTreeWidthPx]);

  const onFileTreeResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsResizingFileTree(true);
      fileTreeDragRef.current = { startX: event.clientX, startWidth: fileTreeWidthPx };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [fileTreeWidthPx],
  );

  const onFileTreeResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = fileTreeDragRef.current;
      if (!drag) {
        return;
      }
      const delta = event.clientX - drag.startX;
      const next = clampFileTreeWidth(drag.startWidth + delta);
      latestFileTreeWidthPxRef.current = next;
      setFileTreeWidthPx(next);
    },
    [clampFileTreeWidth],
  );

  const endFileTreeResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setIsResizingFileTree(false);
    if (fileTreeDragRef.current) {
      const containerWidth = splitContainerRef.current?.clientWidth ?? 0;
      writeWorkspaceFilesTreeWidthPx(
        latestFileTreeWidthPxRef.current,
        containerWidth > 0 ? containerWidth : undefined,
      );
    }
    fileTreeDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
  }, []);

  useEffect(() => {
    const prev = prevSelectedEntryRef.current;
    prevSelectedEntryRef.current = selectedEntry;
    if (!selectedEntry) {
      if (prev !== null) {
        onTitleChangeRef.current?.(undefined);
      }
    } else if (selectedEntry.kind === "plan") {
      onTitleChangeRef.current?.("Plan");
    } else if (selectedEntry.kind === "external") {
      onTitleChangeRef.current?.(pathBasename(selectedEntry.absolutePath));
    } else {
      onTitleChangeRef.current?.(pathBasename(selectedEntry.relativePath));
    }
  }, [selectedEntry]);

  const selectedPath =
    selectedEntry?.kind === "plan"
      ? plan.path
      : selectedEntry?.kind === "workspace"
        ? selectedEntry.relativePath
        : selectedEntry?.kind === "external"
          ? selectedEntry.absolutePath
          : "";
  const headerTitle =
    doc?.title ??
    (selectedEntry?.kind === "plan"
      ? "Plan"
      : selectedEntry?.kind === "workspace"
        ? pathBasename(selectedEntry.relativePath)
        : selectedEntry?.kind === "external"
          ? pathBasename(selectedEntry.absolutePath)
          : "");
  const headerSubtitle = doc?.subtitle ?? selectedPath;
  const isMarkdownDocument = Boolean(selectedPath && isMarkdownPath(selectedPath));

  useEffect(() => {
    if (!planRevealEnabled) {
      return;
    }
    if (autoRevealPlanNonce > 0) {
      setSelectedEntry({ kind: "plan" });
    }
  }, [autoRevealPlanNonce, planRevealEnabled]);

  useEffect(() => {
    if (!fileRevealEnabled || autoRevealFileNonce <= 0) {
      return;
    }
    if (fileRevealDirectoryOnly) {
      return;
    }
    setMarkdownViewMode(fileRevealViewMode);
    if (fileRevealScope === "external") {
      if (!fileRevealAbsolutePath) {
        return;
      }
      setSelectedEntry({ kind: "external", absolutePath: fileRevealAbsolutePath });
      return;
    }
    if (!fileRevealPath) {
      return;
    }
    setSelectedEntry({ kind: "workspace", relativePath: fileRevealPath });
  }, [
    autoRevealFileNonce,
    fileRevealAbsolutePath,
    fileRevealDirectoryOnly,
    fileRevealEnabled,
    fileRevealPath,
    fileRevealScope,
    fileRevealViewMode,
  ]);

  useEffect(() => {
    if (!selectedEntry) {
      setDoc(null);
      setSaveError("");
      setDraftText("");
      setSavedText("");
      return;
    }

    if (selectedEntry.kind === "plan") {
      setSaveError("");
      if (!plan.exists) {
        setDraftText("");
        setSavedText("");
        setDoc({
          status: "empty",
          message: t('workspace.planNotCreated'),
          readOnly: true,
          title: "Plan",
          subtitle: plan.path,
        });
        return;
      }

      setDraftText(plan.content ?? "");
      setSavedText(plan.content ?? "");
      setDoc({
        status: "ready",
        text: plan.content ?? "",
        readOnly: true,
        title: "Plan",
        subtitle: plan.path,
      });
      return;
    }

    const filePath =
      selectedEntry.kind === "external"
        ? selectedEntry.absolutePath
        : selectedEntry.relativePath;
    const readFile =
      selectedEntry.kind === "external" ? readHostTextFile : readWorkspaceTextFile;
    let cancelled = false;
    setDoc({
      status: "loading",
      readOnly: false,
      title: pathBasename(filePath),
      subtitle: filePath,
    });
    setSaveError("");
    setDraftText("");
    setSavedText("");
    void readFile(filePath)
      .then((r) => {
        if (!cancelled) {
          setDraftText(r.text);
          setSavedText(r.text);
          setDoc({
            status: "ready",
            text: r.text,
            readOnly: false,
            title: pathBasename(filePath),
            subtitle: filePath,
          });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setDraftText("");
          setSavedText("");
          setDoc({
            status: "error",
            message: describeError(e),
            readOnly: false,
            title: pathBasename(filePath),
            subtitle: filePath,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    plan.content,
    plan.exists,
    plan.path,
    readHostTextFile,
    readWorkspaceTextFile,
    selectedEntry,
    selectedPath,
  ]);

  const persistEditorText = useCallback(
    async (text: string) => {
      if (!selectedEntry || (selectedEntry.kind !== "workspace" && selectedEntry.kind !== "external")) {
        return;
      }
      setSaveError("");
      try {
        if (selectedEntry.kind === "external") {
          await writeHostTextFile({ absolutePath: selectedEntry.absolutePath, text });
        } else {
          await writeWorkspaceTextFile({ relativePath: selectedEntry.relativePath, text });
        }
        setDoc((current) =>
          current?.status === "ready"
            ? {
                ...current,
                text,
              }
            : current,
        );
        setDraftText(text);
        setSavedText(text);
      } catch (e) {
        setSaveError(describeError(e));
        throw e;
      }
    },
    [selectedEntry, writeHostTextFile, writeWorkspaceTextFile],
  );

  const onEditorSave = useCallback(
    async (text: string) => {
      await persistEditorText(text);
    },
    [persistEditorText],
  );

  const isPreviewVisible =
    doc?.status === "ready" && isMarkdownDocument && markdownViewMode === "preview";

  useLayoutEffect(() => {
    if (!isPreviewVisible) {
      previewRootRef.current = null;
      return;
    }
    const viewport = scrollAreaViewport(previewScrollRef.current);
    previewRootRef.current = viewport;
    if (!viewport) {
      return;
    }
    return installContainedSelectAll(viewport);
  }, [isPreviewVisible, draftText, selectedPath]);

  useEffect(() => {
    if (isPreviewVisible) {
      setMonacoEditor(null);
    }
  }, [isPreviewVisible]);

  const selectionEnabled = doc?.status === "ready" && Boolean(onFileSnippetAddToSession && selectedPath);

  const onToggleMarkdownViewMode = useCallback((value: string) => {
    if (value === "preview" || value === "edit") {
      setMarkdownViewMode(value);
    }
  }, []);

  const selectedEntryKey = selectedEntry
    ? selectedEntry.kind === "plan"
      ? "plan"
      : selectedEntry.kind === "workspace"
        ? `workspace:${selectedEntry.relativePath}`
        : null
    : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <WorkspaceFilesExplorerToolbar
        fileTreeOpen={fileTreeOpen}
        onToggleFileTree={() => setFileTreeOpen((open) => !open)}
        fileOpen={Boolean(selectedEntry)}
        headerTitle={headerTitle}
        headerSubtitle={headerSubtitle}
        isMarkdownDocument={isMarkdownDocument}
        markdownViewMode={markdownViewMode}
        onToggleMarkdownViewMode={onToggleMarkdownViewMode}
        docReady={doc?.status === "ready"}
        docReadOnly={doc?.readOnly ?? false}
        showStartImplementing={selectedEntry?.kind === "plan"}
        startImplementingDisabled={startImplementingDisabled}
        onStartImplementing={onStartImplementing}
      />
      {saveError ? (
        <p className="shrink-0 px-2 pt-1 text-xs text-destructive/90">{saveError}</p>
      ) : null}
      <div
        ref={splitContainerRef}
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden",
          isResizingFileTree && "select-none",
        )}
      >
        <div
          className={cn(
            "flex min-h-0 shrink-0 flex-col overflow-hidden",
            !isResizingFileTree && DESKTOP_SHELL_LAYOUT_TRANSITION,
            fileTreeOpen
              ? selectedEntry
                ? "border-r border-border/40"
                : "min-w-0 flex-1"
              : "w-0",
          )}
          style={
            fileTreeOpen && selectedEntry ? { width: fileTreeWidthPx } : undefined
          }
        >
          <div
            className={cn(
              "flex h-full min-h-0 w-full flex-col overflow-hidden pr-2",
              !fileTreeOpen && "pointer-events-none select-none",
            )}
            aria-hidden={!fileTreeOpen}
            inert={!fileTreeOpen ? true : undefined}
          >
            <WorkspaceFilesPanel
          workspaceRoot={workspaceRoot}
          plan={plan}
          listExplorerChildren={listExplorerChildren}
          gitRevision={gitRevision}
          selectedEntryKey={selectedEntryKey}
          expandDirectoryPath={fileRevealDirectoryOnly ? fileRevealPath : ""}
          expandDirectoryNonce={fileRevealDirectoryOnly ? autoRevealFileNonce : 0}
          onOpenFile={(relativePath) => {
            setMarkdownViewMode(isMarkdownPath(relativePath) ? "preview" : "edit");
            setSelectedEntry({ kind: "workspace", relativePath });
          }}
          onOpenPlan={() => {
            setMarkdownViewMode("edit");
            setSelectedEntry({ kind: "plan" });
          }}
          onWorkspaceEntryRenamed={(oldRelativePath, newRelativePath) => {
            setSelectedEntry((current) => {
              if (current?.kind !== "workspace") {
                return current;
              }
              const nextPath = remapWorkspaceEntryPath(
                oldRelativePath,
                newRelativePath,
                current.relativePath,
              );
              return nextPath ? { kind: "workspace", relativePath: nextPath } : current;
            });
          }}
          onWorkspaceEntryMoved={(oldRelativePath, newRelativePath) => {
            setSelectedEntry((current) => {
              if (current?.kind !== "workspace") {
                return current;
              }
              const nextPath = remapWorkspaceEntryPath(
                oldRelativePath,
                newRelativePath,
                current.relativePath,
              );
              return nextPath ? { kind: "workspace", relativePath: nextPath } : current;
            });
          }}
          onWorkspaceEntryDeleted={(relativePath) => {
            setSelectedEntry((current) =>
              current?.kind === "workspace" &&
              isUnderWorkspaceEntryPath(relativePath, current.relativePath)
                ? null
                : current,
            );
          }}
          onWorkspaceFileAddToSession={onWorkspaceFileAddToSession}
            />
          </div>
        </div>
        {fileTreeOpen && selectedEntry ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("workspace.resizeFileTreeWidth")}
            className={cn(
              "group relative z-10 -ml-px w-1 shrink-0 cursor-col-resize touch-none select-none self-stretch",
              "before:absolute before:inset-y-0 before:-right-1 before:w-3 before:content-['']",
            )}
            onPointerDown={onFileTreeResizePointerDown}
            onPointerMove={onFileTreeResizePointerMove}
            onPointerUp={endFileTreeResize}
            onPointerCancel={endFileTreeResize}
          >
            <div
              className="pointer-events-none absolute inset-y-0 left-0 w-px bg-transparent transition-colors group-hover:bg-border/55"
              aria-hidden
            />
          </div>
        ) : null}
        {selectedEntry ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pl-2">
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {doc?.status === "loading" ? (
              <div className="h-full min-h-0 w-full" />
            ) : doc?.status === "error" ? (
              <p className="p-2 text-xs text-destructive/90">{doc.message}</p>
            ) : doc?.status === "empty" ? (
              <div className="flex h-full items-center justify-center p-4 text-center text-xs leading-relaxed text-muted-foreground">
                {doc.message}
              </div>
            ) : doc?.status === "ready" ? (
              isPreviewVisible ? (
                <>
                  <ScrollArea
                    ref={previewScrollRef}
                    className={cn(
                      "h-full min-h-0 w-full",
                      desktopMicaFileDetailSurfaceClass(useMicaBackdrop),
                    )}
                  >
                    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-4 sm:px-6">
                      {draftText.trim() ? (
                        <MarkdownMessage
                          content={draftText}
                          className="text-sm"
                          allowHtml
                          readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
                        />
                      ) : (
                        <div
                          className={cn(
                            "flex min-h-[8rem] items-center justify-center rounded-md border border-dashed border-border/50 px-4 text-center text-xs text-muted-foreground",
                            desktopMicaFileDetailSurfaceClass(useMicaBackdrop),
                          )}
                        >
                          {t('workspace.emptyMarkdownDoc')}
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                  {selectionEnabled ? (
                    <FileDomSelectionMenu
                      rootRef={previewRootRef}
                      filePath={selectedPath}
                      onFileSnippetAddToSession={onFileSnippetAddToSession}
                    />
                  ) : null}
                </>
              ) : (
                <div ref={monacoContainerRef} className="relative h-full min-h-0 w-full">
                  <WorkspaceMonacoEditor
                    key={selectedEntryKey}
                    ref={editorRef}
                    relativePath={
                      doc.readOnly
                        ? (plan.path.split(/[/\\]/).pop() ?? "plan")
                        : doc.subtitle
                    }
                    initialText={draftText}
                    baselineText={savedText}
                    onSave={onEditorSave}
                    onTextChange={isMarkdownDocument ? setDraftText : undefined}
                    readOnly={doc.readOnly}
                    onEditorReady={setMonacoEditor}
                  />
                  {selectionEnabled ? (
                    <FileMonacoSelectionMenu
                      containerRef={monacoContainerRef}
                      editor={monacoEditor}
                      filePath={selectedPath}
                      onFileSnippetAddToSession={onFileSnippetAddToSession}
                    />
                  ) : null}
                </div>
              )
            ) : null}
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}
