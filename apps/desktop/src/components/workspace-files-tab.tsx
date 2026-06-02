import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Eye, Loader2, Play, Save, SquarePen, X } from "lucide-react";

import { MarkdownMessage } from "@/components/markdown-message";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { WorkspaceFilesPanel } from "@/components/workspace-files-panel";
import {
  WorkspaceMonacoEditor,
  type WorkspaceMonacoEditorHandle,
} from "@/components/workspace-monaco-editor";
import { cn } from "@/lib/utils";
import type {
  PlanSnapshot,
  WorkspaceExplorerListResult,
  WorkspaceReadTextFileResult,
  WriteWorkspaceTextFileRequest,
} from "@/types";

type SelectedWorkspaceEntry = { kind: "workspace"; relativePath: string };
type SelectedPlanEntry = { kind: "plan" };
type SelectedEntry = SelectedWorkspaceEntry | SelectedPlanEntry | null;
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

export type WorkspaceFilesTabProps = {
  workspaceRoot: string;
  plan: PlanSnapshot;
  listExplorerChildren: (relativePath: string) => Promise<WorkspaceExplorerListResult>;
  readWorkspaceTextFile: (relativePath: string) => Promise<WorkspaceReadTextFileResult>;
  writeWorkspaceTextFile: (request: WriteWorkspaceTextFileRequest) => Promise<void>;
  readManagedImagePreviewDataUrl?: (reference: string) => Promise<string | null>;
  onStartImplementing?: () => void;
  startImplementingDisabled?: boolean;
  autoRevealPlanNonce?: number;
  /** 为 false 时不响应 Plan 自动展开（多 files 选项卡时仅目标 tab 为 true） */
  planRevealEnabled?: boolean;
  /** 当前打开文件名变化时通知父层，用于选项卡标题显示；无选中时传 undefined */
  onTitleChange?: (title: string | undefined) => void;
};

export function WorkspaceFilesTab({
  workspaceRoot,
  plan,
  listExplorerChildren,
  readWorkspaceTextFile,
  writeWorkspaceTextFile,
  readManagedImagePreviewDataUrl,
  onStartImplementing,
  startImplementingDisabled = false,
  autoRevealPlanNonce = 0,
  planRevealEnabled = true,
  onTitleChange,
}: WorkspaceFilesTabProps) {
  const { t } = useTranslation();
  const [selectedEntry, setSelectedEntry] = useState<SelectedEntry>(null);
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [draftText, setDraftText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [markdownViewMode, setMarkdownViewMode] = useState<MarkdownViewMode>("edit");
  const editorRef = useRef<WorkspaceMonacoEditorHandle>(null);
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
    } else {
      onTitleChangeRef.current?.(pathBasename(selectedEntry.relativePath));
    }
  }, [selectedEntry]);

  const selectedPath =
    selectedEntry?.kind === "plan"
      ? plan.path
      : selectedEntry?.kind === "workspace"
        ? selectedEntry.relativePath
        : "";
  const headerTitle =
    doc?.title ??
    (selectedEntry?.kind === "plan"
      ? "Plan"
      : selectedEntry?.kind === "workspace"
        ? pathBasename(selectedEntry.relativePath)
        : "");
  const headerSubtitle = doc?.subtitle ?? selectedPath;
  const isMarkdownDocument = Boolean(selectedPath && isMarkdownPath(selectedPath));
  const isWorkspaceFileSelected = selectedEntry?.kind === "workspace";

  useEffect(() => {
    if (!planRevealEnabled) {
      return;
    }
    if (autoRevealPlanNonce > 0) {
      setSelectedEntry({ kind: "plan" });
    }
  }, [autoRevealPlanNonce, planRevealEnabled]);

  useEffect(() => {
    if (!selectedEntry) {
      setDoc(null);
      setDirty(false);
      setSaveError("");
      setDraftText("");
      setSavedText("");
      return;
    }

    setMarkdownViewMode(isMarkdownPath(selectedPath) ? "preview" : "edit");

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

    const selectedRel = selectedEntry.relativePath;
    let cancelled = false;
    setDoc({
      status: "loading",
      readOnly: false,
      title: pathBasename(selectedRel),
      subtitle: selectedRel,
    });
    setDirty(false);
    setSaveError("");
    setDraftText("");
    setSavedText("");
    void readWorkspaceTextFile(selectedRel)
      .then((r) => {
        if (!cancelled) {
          setDraftText(r.text);
          setSavedText(r.text);
          setDoc({
            status: "ready",
            text: r.text,
            readOnly: false,
            title: pathBasename(selectedRel),
            subtitle: selectedRel,
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
            title: pathBasename(selectedRel),
            subtitle: selectedRel,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [plan.content, plan.exists, plan.path, readWorkspaceTextFile, selectedEntry, selectedPath]);

  const persistWorkspaceText = useCallback(
    async (text: string) => {
      if (!selectedEntry || selectedEntry.kind !== "workspace") {
        return;
      }
      setSaving(true);
      setSaveError("");
      try {
        await writeWorkspaceTextFile({ relativePath: selectedEntry.relativePath, text });
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
    [selectedEntry, writeWorkspaceTextFile],
  );

  const onEditorSave = useCallback(
    async (text: string) => {
      await persistWorkspaceText(text);
    },
    [persistWorkspaceText],
  );

  const isPreviewVisible =
    doc?.status === "ready" && isMarkdownDocument && markdownViewMode === "preview";

  const onClickSave = useCallback(() => {
    if (isPreviewVisible) {
      void persistWorkspaceText(draftText);
      return;
    }
    void editorRef.current?.save();
  }, [draftText, isPreviewVisible, persistWorkspaceText]);

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
      : `workspace:${selectedEntry.relativePath}`
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
          onOpenFile={(relativePath) => {
            setMarkdownViewMode(isMarkdownPath(relativePath) ? "preview" : "edit");
            setSelectedEntry({ kind: "workspace", relativePath });
          }}
          onOpenPlan={() => {
            setMarkdownViewMode("edit");
            setSelectedEntry({ kind: "plan" });
          }}
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
              {isWorkspaceFileSelected ? (
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
                <ScrollArea className="h-full min-h-0 w-full bg-background/30">
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
              ) : (
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
                />
              )
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
