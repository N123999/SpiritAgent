import { useCallback, useEffect, useRef, useState } from "react";

import { Loader2, Save, X } from "lucide-react";

import { WorkspaceFilesPanel } from "@/components/workspace-files-panel";
import {
  WorkspaceMonacoEditor,
  type WorkspaceMonacoEditorHandle,
} from "@/components/workspace-monaco-editor";
import { cn } from "@/lib/utils";
import type {
  WorkspaceExplorerListResult,
  WorkspaceReadTextFileResult,
  WriteWorkspaceTextFileRequest,
} from "@/types";

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
  listExplorerChildren: (relativePath: string) => Promise<WorkspaceExplorerListResult>;
  readWorkspaceTextFile: (relativePath: string) => Promise<WorkspaceReadTextFileResult>;
  writeWorkspaceTextFile: (request: WriteWorkspaceTextFileRequest) => Promise<void>;
};

export function WorkspaceFilesTab({
  workspaceRoot,
  listExplorerChildren,
  readWorkspaceTextFile,
  writeWorkspaceTextFile,
}: WorkspaceFilesTabProps) {
  const [selectedRel, setSelectedRel] = useState<string | null>(null);
  const [doc, setDoc] = useState<
    { status: "ready"; text: string } | { status: "error"; message: string } | null
  >(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const editorRef = useRef<WorkspaceMonacoEditorHandle>(null);

  useEffect(() => {
    if (!selectedRel) {
      setDoc(null);
      setDirty(false);
      setSaveError("");
      return;
    }
    let cancelled = false;
    setDoc(null);
    setDirty(false);
    setSaveError("");
    void readWorkspaceTextFile(selectedRel)
      .then((r) => {
        if (!cancelled) {
          setDoc({ status: "ready", text: r.text });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setDoc({ status: "error", message: describeError(e) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRel, readWorkspaceTextFile]);

  const onEditorSave = useCallback(
    async (text: string) => {
      if (!selectedRel) {
        return;
      }
      setSaving(true);
      setSaveError("");
      try {
        await writeWorkspaceTextFile({ relativePath: selectedRel, text });
      } catch (e) {
        setSaveError(describeError(e));
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [selectedRel, writeWorkspaceTextFile],
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
    setSelectedRel(null);
    setDoc(null);
    setDirty(false);
    setSaveError("");
  }, [dirty]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-col overflow-hidden",
          selectedRel ? "w-[min(40%,13rem)] shrink-0 border-r border-border/40 pr-2" : "min-w-0 flex-1",
        )}
      >
        <WorkspaceFilesPanel
          workspaceRoot={workspaceRoot}
          listExplorerChildren={listExplorerChildren}
          selectedRelativePath={selectedRel}
          onOpenFile={setSelectedRel}
        />
      </div>
      {selectedRel ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden pl-2">
          <div className="mb-1 flex shrink-0 flex-wrap items-center justify-between gap-2">
            <span
              className="min-w-0 truncate text-xs font-medium text-foreground/95"
              title={selectedRel}
            >
              {pathBasename(selectedRel)}
            </span>
            <div className="flex shrink-0 items-center gap-0.5">
              {doc?.status === "ready" ? (
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
            ) : doc?.status === "ready" ? (
              <WorkspaceMonacoEditor
                key={selectedRel}
                ref={editorRef}
                relativePath={selectedRel}
                initialText={doc.text}
                onSave={onEditorSave}
                onDirtyChange={setDirty}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
