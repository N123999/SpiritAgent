import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentRef } from "react";
import { useTranslation } from "react-i18next";
import type * as Monaco from "monaco-editor";

import { Eye, Loader2, Play, Save, SquarePen, X } from "lucide-react";

import { MarkdownMessage } from "@/components/markdown-message";
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
}: WorkspaceFilesTabProps) {
  const { t } = useTranslation();
  type MonacoEditor = Monaco.editor.IStandaloneCodeEditor;
  const [selectedEntry, setSelectedEntry] = useState<SelectedEntry>(null);
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [draftText, setDraftText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [markdownViewMode, setMarkdownViewMode] = useState<MarkdownViewMode>("edit");
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
  const isEditableFileSelected =
    selectedEntry?.kind === "workspace" || selectedEntry?.kind === "external";

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
      setDirty(false);
      setSaveError("");
      setDraftText("");
      setSavedText("");
      return;
    }

    if (selectedEntry.kind === "plan") {
      setDirty(false);
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
    setDirty(false);
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
      setSaving(true);
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
        setDirty(false);
      } catch (e) {
        setSaveError(describeError(e));
        throw e;
      } finally {
        setSaving(false);
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

  const onClickSave = useCallback(() => {
    if (isPreviewVisible) {
      void persistEditorText(draftText);
      return;
    }
    void editorRef.current?.save();
  }, [draftText, isPreviewVisible, persistEditorText]);

  const onToggleMarkdownViewMode = useCallback((value: string) => {
    if (value === "preview" || value === "edit") {
      setMarkdownViewMode(value);
    }
  }, []);

  const closeEditor = useCallback(() => {
    if (dirty) {
      const ok = window.confirm(t('workspace.unsavedChangesCloseConfirm'));
      if (!ok) {
        return;
      }
    }
    setSelectedEntry(null);
    setDoc(null);
    setDirty(false);
    setSaveError("");
  }, [dirty]);

  const selectedEntryKey = selectedEntry
    ? selectedEntry.kind === "plan"
      ? "plan"
      : selectedEntry.kind === "workspace"
        ? `workspace:${selectedEntry.relativePath}`
        : null
    : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-col overflow-hidden",
          selectedEntry ? "w-[min(40%,13rem)] shrink-0 border-r border-border/40 pr-2" : "min-w-0 flex-1",
        )}
      >
        <WorkspaceFilesPanel
          workspaceRoot={workspaceRoot}
          plan={plan}
          listExplorerChildren={listExplorerChildren}
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
      {selectedEntry ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pl-2">
          <div className="mb-1 flex shrink-0 flex-wrap items-center justify-between gap-2">
            <span
              className="min-w-0 truncate text-xs font-medium text-foreground/95"
              title={headerSubtitle || undefined}
            >
              {headerTitle}
            </span>
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
                    aria-label={t('workspace.markdownPreview')}
                    title={t('workspace.markdownPreview')}
                    disabled={doc?.status !== "ready"}
                  >
                    <Eye className="size-3" aria-hidden />
                    {t('workspace.preview')}
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="edit"
                    className="h-6 gap-1 rounded-sm px-1.5 text-[10px]"
                    aria-label={t('workspace.markdownEdit')}
                    title={doc?.readOnly ? t('workspace.currentDocReadOnly') : t('workspace.markdownEdit')}
                    disabled={doc?.status !== "ready" || doc.readOnly}
                  >
                    <SquarePen className="size-3" aria-hidden />
                    {t('workspace.edit')}
                  </ToggleGroupItem>
                </ToggleGroup>
              ) : null}
              {selectedEntry?.kind === "plan" ? (
                <button
                  type="button"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-foreground/[0.06] enabled:hover:text-foreground disabled:opacity-50 dark:enabled:hover:bg-foreground/10"
                  disabled={startImplementingDisabled}
                  aria-label={t('workspace.startImplementing')}
                  title={t('workspace.startImplementing')}
                  onClick={onStartImplementing}
                >
                  <Play className="size-3.5" aria-hidden />
                </button>
              ) : null}
              {isEditableFileSelected ? (
                <button
                  type="button"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-foreground/[0.06] enabled:hover:text-foreground disabled:opacity-50 dark:enabled:hover:bg-foreground/10"
                  aria-label={t('common.save')}
                  title="Ctrl+S / ⌘S"
                  disabled={saving || !dirty || doc?.status !== "ready"}
                  onClick={onClickSave}
                >
                  {saving ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Save className="size-3.5" aria-hidden />
                  )}
                </button>
              ) : null}
              <button
                type="button"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground dark:hover:bg-foreground/10"
                aria-label={t('common.close')}
                onClick={closeEditor}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          </div>
          {saveError ? (
            <p className="mb-1 shrink-0 text-xs text-destructive/90">{saveError}</p>
          ) : null}
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border border-border/50">
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
                  <ScrollArea ref={previewScrollRef} className="h-full min-h-0 w-full bg-background/30">
                    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-4 sm:px-6">
                      {draftText.trim() ? (
                        <MarkdownMessage
                          content={draftText}
                          className="text-sm"
                          readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
                        />
                      ) : (
                        <div className="flex min-h-[8rem] items-center justify-center rounded-md border border-dashed border-border/50 bg-background/35 px-4 text-center text-xs text-muted-foreground">
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
                    onDirtyChange={setDirty}
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
  );
}
