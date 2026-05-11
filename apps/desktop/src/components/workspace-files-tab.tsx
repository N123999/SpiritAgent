import { useCallback, useEffect, useRef, useState } from "react";

import { Loader2, Play, Save, X } from "lucide-react";

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

type LoadedDoc =
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

export type WorkspaceFilesTabProps = {
  workspaceRoot: string;
  plan: PlanSnapshot;
  listExplorerChildren: (relativePath: string) => Promise<WorkspaceExplorerListResult>;
  readWorkspaceTextFile: (relativePath: string) => Promise<WorkspaceReadTextFileResult>;
  writeWorkspaceTextFile: (request: WriteWorkspaceTextFileRequest) => Promise<void>;
  onStartImplementing?: () => void;
  startImplementingDisabled?: boolean;
  autoRevealPlanNonce?: number;
};

export function WorkspaceFilesTab({
  workspaceRoot,
  plan,
  listExplorerChildren,
  readWorkspaceTextFile,
  writeWorkspaceTextFile,
  onStartImplementing,
  startImplementingDisabled = false,
  autoRevealPlanNonce = 0,
}: WorkspaceFilesTabProps) {
  const [selectedEntry, setSelectedEntry] = useState<SelectedEntry>(null);
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const editorRef = useRef<WorkspaceMonacoEditorHandle>(null);

  useEffect(() => {
    if (autoRevealPlanNonce > 0) {
      setSelectedEntry({ kind: "plan" });
    }
  }, [autoRevealPlanNonce]);

  useEffect(() => {
    if (!selectedEntry) {
      setDoc(null);
      setDirty(false);
      setSaveError("");
      return;
    }

    if (selectedEntry.kind === "plan") {
      setDirty(false);
      setSaveError("");
      if (!plan.exists) {
        setDoc({
          status: "empty",
          message: "Plan 还没有创建。后续检测到实际写入时，这里会显示托管 plan.md。",
          readOnly: true,
          title: "Plan",
          subtitle: plan.path,
        });
        return;
      }

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
    setDoc(null);
    setDirty(false);
    setSaveError("");
    void readWorkspaceTextFile(selectedRel)
      .then((r) => {
        if (!cancelled) {
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
  }, [selectedEntry, plan.content, plan.exists, plan.path, readWorkspaceTextFile]);

  const onEditorSave = useCallback(
    async (text: string) => {
      if (!selectedEntry || selectedEntry.kind !== "workspace") {
        return;
      }
      setSaving(true);
      setSaveError("");
      try {
        await writeWorkspaceTextFile({ relativePath: selectedEntry.relativePath, text });
      } catch (e) {
        setSaveError(describeError(e));
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [selectedEntry, writeWorkspaceTextFile],
  );

  const onClickSave = useCallback(() => {
    void editorRef.current?.save();
  }, []);

  const closeEditor = useCallback(() => {
    if (dirty) {
      const ok = window.confirm("有未保存的更改，仍要关闭吗？");
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
          onOpenFile={(relativePath) => setSelectedEntry({ kind: "workspace", relativePath })}
          onOpenPlan={() => setSelectedEntry({ kind: "plan" })}
        />
      </div>
      {selectedEntry ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pl-2">
          <div className="mb-1 flex shrink-0 flex-wrap items-center justify-between gap-2">
            <span
              className="min-w-0 truncate text-xs font-medium text-foreground/95"
              title={doc?.subtitle ?? undefined}
            >
              {doc?.title ?? ""}
            </span>
            <div className="flex shrink-0 items-center gap-0.5">
              {selectedEntry?.kind === "plan" ? (
                <button
                  type="button"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-foreground/[0.06] enabled:hover:text-foreground disabled:opacity-50 dark:enabled:hover:bg-foreground/10"
                  disabled={startImplementingDisabled}
                  aria-label="开始实现"
                  title="开始实现"
                  onClick={onStartImplementing}
                >
                  <Play className="size-3.5" aria-hidden />
                </button>
              ) : null}
              {doc?.status === "ready" && !doc.readOnly ? (
                <button
                  type="button"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-foreground/[0.06] enabled:hover:text-foreground disabled:opacity-50 dark:enabled:hover:bg-foreground/10"
                  aria-label="保存"
                  title="Ctrl+S / ⌘S"
                  disabled={saving || !dirty}
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
                aria-label="关闭"
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
            {doc?.status === "error" ? (
              <p className="p-2 text-xs text-destructive/90">{doc.message}</p>
            ) : doc?.status === "empty" ? (
              <div className="flex h-full items-center justify-center p-4 text-center text-xs leading-relaxed text-muted-foreground">
                {doc.message}
              </div>
            ) : doc?.status === "ready" ? (
              <WorkspaceMonacoEditor
                key={selectedEntryKey}
                ref={editorRef}
                relativePath={doc.readOnly ? "plan.md" : doc.subtitle}
                initialText={doc.text}
                onSave={onEditorSave}
                onDirtyChange={setDirty}
                readOnly={doc.readOnly}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
