import { useCallback, useEffect, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  ChevronDown,
  ChevronRight,
  Folder,
  ListTodo,
} from "lucide-react";

import {
  WorkspaceFileContextMenu,
  useMoveToTrashLabel,
  type WorkspaceExplorerContextTarget,
} from "@/components/workspace-file-context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useHostApi } from "@/hooks/useHostApi";
import { workspaceExplorerIcon } from "@/lib/workspace-explorer-icon";
import { cn } from "@/lib/utils";
import type { PlanSnapshot, WorkspaceExplorerEntry, WorkspaceExplorerListResult } from "@/types";

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function fileBasename(abs: string): string {
  const n = abs.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) || abs : abs;
}

export { workspaceExplorerIcon } from "@/lib/workspace-explorer-icon";

export function joinExplorerRel(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

type DirCacheEntry =
  | { status: "loading" }
  | { status: "ready"; entries: WorkspaceExplorerEntry[] }
  | { status: "error"; message: string };

export type WorkspaceFilesPanelProps = {
  workspaceRoot: string;
  plan: PlanSnapshot;
  listExplorerChildren: (relativePath: string) => Promise<WorkspaceExplorerListResult>;
  /** 当前选中的条目；`plan` 为托管计划文件，`workspace:*` 为工作区相对路径。 */
  selectedEntryKey?: string | null;
  /** 展开并滚动到该目录（不含末尾 `/`）。 */
  expandDirectoryPath?: string;
  expandDirectoryNonce?: number;
  onOpenFile?: (relativePath: string) => void;
  onOpenPlan?: () => void;
  /** 工作区条目重命名成功后通知父层更新编辑器路径。 */
  onWorkspaceEntryRenamed?: (oldRelativePath: string, newRelativePath: string) => void;
  /** 工作区条目移动成功后通知父层更新编辑器路径。 */
  onWorkspaceEntryMoved?: (oldRelativePath: string, newRelativePath: string) => void;
  /** 工作区条目删除成功后通知父层关闭编辑器。 */
  onWorkspaceEntryDeleted?: (relativePath: string) => void;
  onWorkspaceFileAddToSession?: (relativePath: string) => void;
};

type ExplorerRowProps = {
  target: WorkspaceExplorerContextTarget;
  depth: number;
  selected: boolean;
  isElectron: boolean;
  renaming: boolean;
  renameValue: string;
  renameError: string;
  onReveal: (target: WorkspaceExplorerContextTarget) => void;
  onRenameStart?: (target: WorkspaceExplorerContextTarget) => void;
  onDelete?: (target: WorkspaceExplorerContextTarget) => void;
  onAddToSession?: (target: WorkspaceExplorerContextTarget) => void;
  onRenameValueChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onClick: () => void;
  leading: ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  dropHighlight?: boolean;
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver?: (event: DragEvent<HTMLElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLElement>) => void;
  onDrop?: (event: DragEvent<HTMLElement>) => void;
  children?: ReactNode;
};

function ExplorerRow({
  target,
  depth,
  selected,
  isElectron,
  renaming,
  renameValue,
  renameError,
  onReveal,
  onRenameStart,
  onDelete,
  onAddToSession,
  onRenameValueChange,
  onRenameCommit,
  onRenameCancel,
  onClick,
  leading,
  icon: Icon,
  dropHighlight = false,
  draggable = false,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: ExplorerRowProps) {
  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onRenameCommit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onRenameCancel();
    }
  };

  const rowButton = (
    <button
      type="button"
      draggable={draggable}
      className={cn(
        "flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left",
        "text-foreground/90 hover:bg-foreground/[0.06] dark:hover:bg-foreground/10",
        selected && "bg-foreground/[0.08] dark:bg-foreground/12",
        dropHighlight && "bg-primary/15 ring-1 ring-primary/40",
      )}
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
      aria-current={selected ? "true" : undefined}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {leading}
      <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
      {renaming ? (
        <input
          type="text"
          className="min-w-0 flex-1 rounded border border-border/60 bg-background px-1 py-0 text-xs outline-none focus:border-ring"
          value={renameValue}
          autoFocus
          aria-invalid={renameError ? true : undefined}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onRenameValueChange(event.target.value)}
          onBlur={() => onRenameCommit()}
          onKeyDown={handleRenameKeyDown}
        />
      ) : (
        <span className="min-w-0 truncate">{target.name}</span>
      )}
    </button>
  );

  return (
    <li className="min-w-0">
      <WorkspaceFileContextMenu
        target={target}
        isElectron={isElectron}
        onReveal={onReveal}
        onRename={onRenameStart}
        onDelete={onDelete}
        onAddToSession={onAddToSession}
      >
        {rowButton}
      </WorkspaceFileContextMenu>
      {renaming && renameError ? (
        <p className="py-0.5 pl-1 text-destructive/90" style={{ paddingLeft: `${depth * 12 + 4}px` }}>
          {renameError}
        </p>
      ) : null}
      {children}
    </li>
  );
}

export function WorkspaceFilesPanel({
  workspaceRoot,
  plan,
  listExplorerChildren,
  selectedEntryKey = null,
  expandDirectoryPath = "",
  expandDirectoryNonce = 0,
  onOpenFile,
  onOpenPlan,
  onWorkspaceEntryRenamed,
  onWorkspaceEntryMoved,
  onWorkspaceEntryDeleted,
  onWorkspaceFileAddToSession,
}: WorkspaceFilesPanelProps) {
  const { t } = useTranslation();
  const moveToTrashLabel = useMoveToTrashLabel();
  const { api, kind } = useHostApi();
  const isElectron = kind === "electron";
  const [rootOpen, setRootOpen] = useState(true);
  const [cache, setCache] = useState<Record<string, DirCacheEntry>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");
  const [forceDeleteTarget, setForceDeleteTarget] = useState<WorkspaceExplorerContextTarget | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceExplorerContextTarget | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [forceDeleteReason, setForceDeleteReason] = useState("");
  const [forceDeleteBusy, setForceDeleteBusy] = useState(false);
  const [dragOverDirectory, setDragOverDirectory] = useState<string | null>(null);

  const invalidateDir = useCallback(
    (relativePath: string) => {
      setCache((current) => {
        const next = { ...current };
        delete next[relativePath];
        return next;
      });
      void listExplorerChildren(relativePath).then(({ entries }) => {
        setCache((current) => ({ ...current, [relativePath]: { status: "ready", entries } }));
      }).catch((error) => {
        setCache((current) => ({
          ...current,
          [relativePath]: { status: "error", message: describeError(error) },
        }));
      });
    },
    [listExplorerChildren],
  );

  const loadDir = useCallback(
    async (rel: string) => {
      setCache((c) => ({ ...c, [rel]: { status: "loading" } }));
      try {
        const { entries } = await listExplorerChildren(rel);
        setCache((c) => ({ ...c, [rel]: { status: "ready", entries } }));
      } catch (e) {
        setCache((c) => ({
          ...c,
          [rel]: { status: "error", message: describeError(e) },
        }));
      }
    },
    [listExplorerChildren],
  );

  useEffect(() => {
    if (!workspaceRoot.trim()) {
      setCache({});
      setExpanded({});
      return;
    }
    setCache({});
    setExpanded({});
    setRootOpen(true);
    void loadDir("");
  }, [workspaceRoot, loadDir]);

  useEffect(() => {
    if (!expandDirectoryPath || expandDirectoryNonce <= 0) {
      return;
    }

    const segments = expandDirectoryPath.split("/").filter((segment) => segment.length > 0);
    const directoriesToExpand = [""];
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      directoriesToExpand.push(current);
    }

    setRootOpen(true);
    setExpanded((previous) => {
      const next = { ...previous };
      for (const directory of directoriesToExpand) {
        next[directory] = true;
      }
      return next;
    });

    for (const directory of directoriesToExpand) {
      void loadDir(directory);
    }
  }, [expandDirectoryNonce, expandDirectoryPath, loadDir]);

  const onToggleDir = useCallback(
    (dirRel: string) => {
      const nextOpen = !expanded[dirRel];
      setExpanded((s) => ({ ...s, [dirRel]: nextOpen }));
      if (nextOpen) {
        const cur = cache[dirRel];
        if (cur === undefined || cur.status === "error") {
          void loadDir(dirRel);
        }
      }
    },
    [cache, expanded, loadDir],
  );

  const handleReveal = useCallback(
    async (target: WorkspaceExplorerContextTarget) => {
      if (!api) {
        return;
      }
      try {
        await api.revealWorkspaceEntry(target.relativePath);
      } catch (error) {
        console.debug("[WorkspaceFilesPanel] reveal failed", {
          relativePath: target.relativePath,
          error: describeError(error),
        });
      }
    },
    [api],
  );

  const handleRenameStart = useCallback((target: WorkspaceExplorerContextTarget) => {
    setRenamingPath(target.relativePath);
    setRenameValue(target.name);
    setRenameError("");
  }, []);

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null);
    setRenameValue("");
    setRenameError("");
  }, []);

  const handleRenameCommit = useCallback(async () => {
    if (!renamingPath || !api) {
      handleRenameCancel();
      return;
    }
    const trimmed = renameValue.trim();
    const currentName = fileBasename(renamingPath);
    if (!trimmed || trimmed === currentName) {
      handleRenameCancel();
      return;
    }
    try {
      const result = await api.renameWorkspaceEntry(renamingPath, trimmed);
      const parentRel = renamingPath.includes("/")
        ? renamingPath.slice(0, renamingPath.lastIndexOf("/"))
        : "";
      invalidateDir(parentRel);
      onWorkspaceEntryRenamed?.(renamingPath, result.relativePath);
      handleRenameCancel();
    } catch (error) {
      setRenameError(describeError(error));
    }
  }, [
    api,
    handleRenameCancel,
    invalidateDir,
    onWorkspaceEntryRenamed,
    renameValue,
    renamingPath,
  ]);

  const handleDeleteRequest = useCallback((target: WorkspaceExplorerContextTarget) => {
    setDeleteTarget(target);
  }, []);

  const handleConfirmMoveToTrash = useCallback(async () => {
    const target = deleteTarget;
    if (!target || !api) {
      return;
    }
    setDeleteBusy(true);
    try {
      await api.trashWorkspaceEntry(target.relativePath);
      const parentRel = target.relativePath.includes("/")
        ? target.relativePath.slice(0, target.relativePath.lastIndexOf("/"))
        : "";
      invalidateDir(parentRel);
      onWorkspaceEntryDeleted?.(target.relativePath);
      setDeleteTarget(null);
    } catch (error) {
      setDeleteTarget(null);
      setForceDeleteTarget(target);
      setForceDeleteReason(describeError(error));
    } finally {
      setDeleteBusy(false);
    }
  }, [api, deleteTarget, invalidateDir, onWorkspaceEntryDeleted]);

  const handleForceDelete = useCallback(async () => {
    const target = forceDeleteTarget;
    if (!target || !api) {
      return;
    }
    setForceDeleteBusy(true);
    try {
      await api.forceDeleteWorkspaceEntry(target.relativePath);
      const parentRel = target.relativePath.includes("/")
        ? target.relativePath.slice(0, target.relativePath.lastIndexOf("/"))
        : "";
      invalidateDir(parentRel);
      onWorkspaceEntryDeleted?.(target.relativePath);
      setForceDeleteTarget(null);
      setForceDeleteReason("");
    } catch (error) {
      setForceDeleteReason(describeError(error));
    } finally {
      setForceDeleteBusy(false);
    }
  }, [api, forceDeleteTarget, invalidateDir, onWorkspaceEntryDeleted]);

  const handleAddToSession = useCallback(
    (target: WorkspaceExplorerContextTarget) => {
      if (target.kind !== "file") {
        return;
      }
      onWorkspaceFileAddToSession?.(target.relativePath);
    },
    [onWorkspaceFileAddToSession],
  );

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLButtonElement>, target: WorkspaceExplorerContextTarget) => {
      event.dataTransfer.setData(
        "application/spirit-workspace-entry",
        JSON.stringify({ relativePath: target.relativePath, kind: target.kind }),
      );
      event.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const handleDirectoryDragOver = useCallback(
    (event: DragEvent<HTMLElement>, directoryRel: string) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDragOverDirectory(directoryRel);
    },
    [],
  );

  const handleDirectoryDrop = useCallback(
    async (event: DragEvent<HTMLElement>, targetDirectoryRel: string) => {
      event.preventDefault();
      setDragOverDirectory(null);
      if (!api) {
        return;
      }
      const raw = event.dataTransfer.getData("application/spirit-workspace-entry");
      if (!raw) {
        return;
      }
      let payload: { relativePath?: string; kind?: string };
      try {
        payload = JSON.parse(raw) as { relativePath?: string; kind?: string };
      } catch {
        return;
      }
      if (!payload.relativePath) {
        return;
      }
      const sourceRel = payload.relativePath.replace(/\\/g, "/");
      const targetDir = targetDirectoryRel.replace(/\\/g, "/");
      const sourceParent = sourceRel.includes("/")
        ? sourceRel.slice(0, sourceRel.lastIndexOf("/"))
        : "";
      if (sourceRel === targetDir || sourceParent === targetDir) {
        return;
      }
      try {
        const result = await api.moveWorkspaceEntry(sourceRel, targetDir);
        if (result.relativePath === sourceRel) {
          return;
        }
        invalidateDir(sourceParent);
        invalidateDir(targetDir);
        onWorkspaceEntryMoved?.(sourceRel, result.relativePath);
      } catch (error) {
        console.debug("[WorkspaceFilesPanel] move failed", {
          relativePath: payload.relativePath,
          targetDirectoryRel,
          error: describeError(error),
        });
      }
    },
    [api, invalidateDir, onWorkspaceEntryMoved],
  );

  if (!workspaceRoot.trim()) {
    return <p className="text-muted-foreground">{t("workspace.connectToShowFiles")}</p>;
  }

  const rootLabel = fileBasename(workspaceRoot.trim()) || workspaceRoot.trim();

  const renderPlanItem = () => (
    <ul className="list-none space-y-0.5 p-0">
      <li className="min-w-0">
        <button
          type="button"
          className={cn(
            "flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left",
            "text-foreground/90 hover:bg-foreground/[0.06] dark:hover:bg-foreground/10",
            onOpenPlan && "cursor-pointer",
            selectedEntryKey === "plan" && "bg-foreground/[0.08] dark:bg-foreground/12",
          )}
          style={{ paddingLeft: "4px" }}
          aria-current={selectedEntryKey === "plan" ? "true" : undefined}
          onClick={() => onOpenPlan?.()}
          title={plan.path}
        >
          <span className="inline-block size-3.5 shrink-0" aria-hidden />
          <ListTodo className="size-3.5 shrink-0 opacity-70" aria-hidden />
          <span className="min-w-0 truncate">Plan</span>
        </button>
      </li>
    </ul>
  );

  const renderDirBody = (rel: string, depth: number) => {
    const state = cache[rel];
    if (!state || state.status === "loading") {
      return null;
    }
    if (state.status === "error") {
      return <p className="py-1 pl-1 text-destructive/90">{state.message}</p>;
    }
    return (
      <ul className="list-none space-y-0.5 p-0">
        {state.entries.map((entry) => {
          const childRel = joinExplorerRel(rel, entry.name);
          const isDir = entry.kind === "dir";
          const Icon = workspaceExplorerIcon(entry.name, entry.kind);
          const open = isDir && expanded[childRel] === true;
          const target: WorkspaceExplorerContextTarget = {
            relativePath: childRel,
            kind: entry.kind,
            name: entry.name,
          };

          if (!isDir) {
            const selected = selectedEntryKey === `workspace:${childRel}`;
            return (
              <ExplorerRow
                key={childRel}
                target={target}
                depth={depth}
                selected={selected}
                isElectron={isElectron}
                renaming={renamingPath === childRel}
                renameValue={renameValue}
                renameError={renamingPath === childRel ? renameError : ""}
                onReveal={handleReveal}
                onRenameStart={handleRenameStart}
                onDelete={handleDeleteRequest}
                onAddToSession={onWorkspaceFileAddToSession ? handleAddToSession : undefined}
                onRenameValueChange={setRenameValue}
                onRenameCommit={() => void handleRenameCommit()}
                onRenameCancel={handleRenameCancel}
                onClick={() => onOpenFile?.(childRel)}
                leading={<span className="inline-block w-4 shrink-0" aria-hidden />}
                icon={Icon}
                draggable
                onDragStart={(event) => handleDragStart(event, target)}
              />
            );
          }

          return (
            <ExplorerRow
              key={childRel}
              target={target}
              depth={depth}
              selected={false}
              isElectron={isElectron}
              renaming={renamingPath === childRel}
              renameValue={renameValue}
              renameError={renamingPath === childRel ? renameError : ""}
              onReveal={handleReveal}
              onRenameStart={handleRenameStart}
              onDelete={handleDeleteRequest}
              onRenameValueChange={setRenameValue}
              onRenameCommit={() => void handleRenameCommit()}
              onRenameCancel={handleRenameCancel}
              onClick={() => onToggleDir(childRel)}
              leading={
                open ? (
                  <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden />
                )
              }
              icon={Icon}
              dropHighlight={dragOverDirectory === childRel}
              draggable
              onDragStart={(event) => handleDragStart(event, target)}
              onDragOver={(event) => handleDirectoryDragOver(event, childRel)}
              onDragLeave={() => setDragOverDirectory((current) => (current === childRel ? null : current))}
              onDrop={(event) => void handleDirectoryDrop(event, childRel)}
            >
              {open ? <div className="min-w-0">{renderDirBody(childRel, depth + 1)}</div> : null}
            </ExplorerRow>
          );
        })}
      </ul>
    );
  };

  const rootTarget: WorkspaceExplorerContextTarget = {
    relativePath: "",
    kind: "dir",
    name: rootLabel,
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-xs">
      <WorkspaceFileContextMenu
        target={rootTarget}
        isElectron={isElectron}
        onReveal={handleReveal}
      >
        <button
          type="button"
          className={cn(
            "mb-1 flex w-full min-w-0 shrink-0 items-center gap-1 rounded px-1 py-1 text-left",
            "text-foreground hover:bg-foreground/[0.06] dark:hover:bg-foreground/10",
          )}
          aria-expanded={rootOpen}
          onClick={() => setRootOpen((o) => !o)}
        >
          {rootOpen ? (
            <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden />
          )}
          <Folder className="size-3.5 shrink-0 opacity-70" aria-hidden />
          <span className="min-w-0 truncate">{rootLabel}</span>
        </button>
      </WorkspaceFileContextMenu>
      {rootOpen ? (
        <div
          className="spirit-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden pr-0.5"
          role="tree"
          aria-label={t("workspace.fileList")}
          aria-busy={cache[""]?.status === "loading" ? true : undefined}
          onDragOver={(event) => handleDirectoryDragOver(event, "")}
          onDragLeave={() => setDragOverDirectory((current) => (current === "" ? null : current))}
          onDrop={(event) => void handleDirectoryDrop(event, "")}
        >
          {renderDirBody("", 0)}
          <div className="mt-1">{renderPlanItem()}</div>
        </div>
      ) : (
        <div className="mb-1">{renderPlanItem()}</div>
      )}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t("workspace.delete")}</DialogTitle>
            <DialogDescription>
              {t("workspace.deleteEntryConfirm", { name: deleteTarget?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={deleteBusy}
              onClick={() => setDeleteTarget(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={deleteBusy}
              onClick={() => void handleConfirmMoveToTrash()}
            >
              {moveToTrashLabel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {forceDeleteTarget ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !forceDeleteBusy) {
              setForceDeleteTarget(null);
              setForceDeleteReason("");
            }
          }}
        >
          <DialogContent className="sm:max-w-md" showCloseButton>
            <DialogHeader>
              <DialogTitle>{t("workspace.forceDelete")}</DialogTitle>
              <DialogDescription>
                {t("workspace.forceDeleteConfirm", { reason: forceDeleteReason })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={forceDeleteBusy}
                onClick={() => {
                  setForceDeleteTarget(null);
                  setForceDeleteReason("");
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={forceDeleteBusy}
                onClick={() => void handleForceDelete()}
              >
                {t("workspace.forceDelete")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
