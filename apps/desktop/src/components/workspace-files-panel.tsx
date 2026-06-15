import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { useHostApi } from "@/hooks/useHostApi";
import { runAfterRadixOverlayClose } from "@/lib/overlay-motion";
import { workspaceExplorerIcon } from "@/lib/workspace-explorer-icon";
import { evictRecordKeysUnderPrefix } from "@/lib/workspace-entry-path-sync";
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

/** 重命名聚焦时预选文件名主体，不含最后一个扩展名（如 App.tsx → App）。 */
function focusRenameInput(input: HTMLInputElement, filename: string): void {
  input.focus({ preventScroll: true });
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) {
    input.select();
    return;
  }
  input.setSelectionRange(0, lastDot);
}

export { workspaceExplorerIcon } from "@/lib/workspace-explorer-icon";

export function joinExplorerRel(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

type DirCacheEntry =
  | { status: "loading" }
  | { status: "ready"; entries: WorkspaceExplorerEntry[] }
  | { status: "error"; message: string };

type PendingMoveTarget = {
  sourceRelativePath: string;
  sourceName: string;
  targetDirectoryRel: string;
  targetDirectoryLabel: string;
};

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
  const renameInputRef = useRef<HTMLInputElement>(null);
  const pendingRenameFocusRef = useRef(false);
  const skipBlurCommitRef = useRef(false);

  useLayoutEffect(() => {
    if (!renaming) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const input = renameInputRef.current;
      if (!input) {
        return;
      }
      focusRenameInput(input, target.name);
    });
    return () => cancelAnimationFrame(frame);
  }, [renaming, target.relativePath]);

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      skipBlurCommitRef.current = true;
      onRenameCommit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onRenameCancel();
    }
  };

  const rowClassName = cn(
    "flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left",
    "text-foreground/90 hover:bg-foreground/[0.06] dark:hover:bg-foreground/10",
    selected && "bg-foreground/[0.08] dark:bg-foreground/12",
    dropHighlight && "bg-primary/15 ring-1 ring-primary/40",
  );
  const rowStyle = { paddingLeft: `${depth * 12 + 4}px` };

  const renameInput = (
    <input
      ref={renameInputRef}
      type="text"
      className="min-w-0 flex-1 rounded border border-border/60 bg-background px-1 py-0 text-xs outline-none focus:border-ring"
      value={renameValue}
      aria-invalid={renameError ? true : undefined}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => onRenameValueChange(event.target.value)}
      onBlur={() => {
        if (skipBlurCommitRef.current) {
          skipBlurCommitRef.current = false;
          return;
        }
        onRenameCommit();
      }}
      onKeyDown={handleRenameKeyDown}
    />
  );

  const rowTrigger = renaming ? (
    <div className={rowClassName} style={rowStyle} role="treeitem">
      {leading}
      <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
      {renameInput}
    </div>
  ) : (
    <button
      type="button"
      draggable={draggable}
      className={rowClassName}
      style={rowStyle}
      aria-current={selected ? "true" : undefined}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {leading}
      <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
      <span className="min-w-0 truncate">{target.name}</span>
    </button>
  );

  const handleContextMenuCloseAutoFocus = (event: Event) => {
    if (!pendingRenameFocusRef.current && !renaming) {
      return;
    }
    event.preventDefault();
    pendingRenameFocusRef.current = false;
  };

  const handleRenameStartFromMenu = (entry: WorkspaceExplorerContextTarget) => {
    pendingRenameFocusRef.current = true;
    onRenameStart?.(entry);
  };

  return (
    <li className="min-w-0">
      <WorkspaceFileContextMenu
        target={target}
        isElectron={isElectron}
        onReveal={onReveal}
        onRename={onRenameStart ? handleRenameStartFromMenu : undefined}
        onDelete={onDelete}
        onAddToSession={onAddToSession}
        onCloseAutoFocus={handleContextMenuCloseAutoFocus}
      >
        {rowTrigger}
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [forceDeleteReason, setForceDeleteReason] = useState("");
  const [forceDeleteBusy, setForceDeleteBusy] = useState(false);
  const [forceDeleteDialogOpen, setForceDeleteDialogOpen] = useState(false);
  const [dragOverDirectory, setDragOverDirectory] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<PendingMoveTarget | null>(null);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState("");
  const [revealError, setRevealError] = useState("");
  const renameCommitInFlightRef = useRef(false);

  const dismissDeleteDialog = useCallback(() => {
    setDeleteDialogOpen(false);
    runAfterRadixOverlayClose(() => {
      setDeleteTarget(null);
    });
  }, []);

  const dismissMoveDialog = useCallback(() => {
    setMoveDialogOpen(false);
    runAfterRadixOverlayClose(() => {
      setMoveTarget(null);
      setMoveError("");
    });
  }, []);

  const dismissForceDeleteDialog = useCallback(() => {
    setForceDeleteDialogOpen(false);
    runAfterRadixOverlayClose(() => {
      setForceDeleteTarget(null);
      setForceDeleteReason("");
    });
  }, []);

  const workspaceRootLabel = fileBasename(workspaceRoot.trim()) || workspaceRoot.trim();

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

  const evictExplorerPathPrefix = useCallback((prefixRel: string) => {
    setCache((current) => evictRecordKeysUnderPrefix(current, prefixRel));
    setExpanded((current) => evictRecordKeysUnderPrefix(current, prefixRel));
  }, []);

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
      setRevealError("");
      try {
        await api.revealWorkspaceEntry(target.relativePath);
      } catch (error) {
        setRevealError(describeError(error));
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
    if (renameCommitInFlightRef.current) {
      return;
    }
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
    renameCommitInFlightRef.current = true;
    try {
      const result = await api.renameWorkspaceEntry(renamingPath, trimmed);
      const parentRel = renamingPath.includes("/")
        ? renamingPath.slice(0, renamingPath.lastIndexOf("/"))
        : "";
      invalidateDir(parentRel);
      evictExplorerPathPrefix(renamingPath);
      onWorkspaceEntryRenamed?.(renamingPath, result.relativePath);
      handleRenameCancel();
    } catch (error) {
      setRenameError(describeError(error));
    } finally {
      renameCommitInFlightRef.current = false;
    }
  }, [
    api,
    handleRenameCancel,
    evictExplorerPathPrefix,
    invalidateDir,
    onWorkspaceEntryRenamed,
    renameValue,
    renamingPath,
  ]);

  const handleDeleteRequest = useCallback((target: WorkspaceExplorerContextTarget) => {
    setDeleteTarget(target);
    setDeleteDialogOpen(true);
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
      evictExplorerPathPrefix(target.relativePath);
      onWorkspaceEntryDeleted?.(target.relativePath);
      dismissDeleteDialog();
    } catch (error) {
      setDeleteDialogOpen(false);
      runAfterRadixOverlayClose(() => {
        setDeleteTarget(null);
      });
      setForceDeleteTarget(target);
      setForceDeleteReason(describeError(error));
      setForceDeleteDialogOpen(true);
    } finally {
      setDeleteBusy(false);
    }
  }, [api, deleteTarget, dismissDeleteDialog, evictExplorerPathPrefix, invalidateDir, onWorkspaceEntryDeleted]);

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
      evictExplorerPathPrefix(target.relativePath);
      onWorkspaceEntryDeleted?.(target.relativePath);
      dismissForceDeleteDialog();
    } catch (error) {
      setForceDeleteReason(describeError(error));
    } finally {
      setForceDeleteBusy(false);
    }
  }, [api, dismissForceDeleteDialog, evictExplorerPathPrefix, forceDeleteTarget, invalidateDir, onWorkspaceEntryDeleted]);

  const handleAddToSession = useCallback(
    (target: WorkspaceExplorerContextTarget) => {
      if (target.kind !== "file") {
        return;
      }
      onWorkspaceFileAddToSession?.(target.relativePath);
    },
    [onWorkspaceFileAddToSession],
  );

  const handleConfirmMove = useCallback(async () => {
    const pending = moveTarget;
    if (!pending || !api) {
      return;
    }
    setMoveBusy(true);
    setMoveError("");
    try {
      const result = await api.moveWorkspaceEntry(
        pending.sourceRelativePath,
        pending.targetDirectoryRel,
      );
      if (result.relativePath === pending.sourceRelativePath) {
        dismissMoveDialog();
        return;
      }
      const sourceParent = pending.sourceRelativePath.includes("/")
        ? pending.sourceRelativePath.slice(0, pending.sourceRelativePath.lastIndexOf("/"))
        : "";
      invalidateDir(sourceParent);
      invalidateDir(pending.targetDirectoryRel);
      evictExplorerPathPrefix(pending.sourceRelativePath);
      onWorkspaceEntryMoved?.(pending.sourceRelativePath, result.relativePath);
      dismissMoveDialog();
    } catch (error) {
      setMoveError(describeError(error));
      return;
    } finally {
      setMoveBusy(false);
    }
  }, [api, dismissMoveDialog, evictExplorerPathPrefix, invalidateDir, moveTarget, onWorkspaceEntryMoved]);

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
    (event: DragEvent<HTMLElement>, targetDirectoryRel: string) => {
      event.preventDefault();
      setDragOverDirectory(null);
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
      setMoveTarget({
        sourceRelativePath: sourceRel,
        sourceName: fileBasename(sourceRel),
        targetDirectoryRel: targetDir,
        targetDirectoryLabel: targetDir === "" ? workspaceRootLabel : targetDir,
      });
      setMoveError("");
      setMoveDialogOpen(true);
    },
    [workspaceRootLabel],
  );

  if (!workspaceRoot.trim()) {
    return <p className="text-muted-foreground">{t("workspace.connectToShowFiles")}</p>;
  }

  const rootLabel = workspaceRootLabel;

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
      {revealError ? (
        <p className="mb-1 shrink-0 text-destructive/90" role="alert">
          {revealError}
        </p>
      ) : null}
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
        <ScrollArea className="min-h-0 min-w-0 flex-1" type="auto">
          <div
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
        </ScrollArea>
      ) : (
        <div className="mb-1">{renderPlanItem()}</div>
      )}

      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setDeleteDialogOpen(true);
          } else if (!deleteBusy) {
            dismissDeleteDialog();
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
              onClick={() => {
                if (!deleteBusy) {
                  dismissDeleteDialog();
                }
              }}
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

      <Dialog
        open={moveDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setMoveDialogOpen(true);
          } else if (!moveBusy) {
            dismissMoveDialog();
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t("workspace.move")}</DialogTitle>
            <DialogDescription>
              {t("workspace.moveEntryConfirm", {
                name: moveTarget?.sourceName ?? "",
                folder: moveTarget?.targetDirectoryLabel ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          {moveError ? (
            <p className="text-sm text-destructive/90" role="alert">
              {moveError}
            </p>
          ) : null}
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={moveBusy}
              onClick={() => {
                if (!moveBusy) {
                  dismissMoveDialog();
                }
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={moveBusy}
              onClick={() => void handleConfirmMove()}
            >
              {t("workspace.move")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={forceDeleteDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setForceDeleteDialogOpen(true);
          } else if (!forceDeleteBusy) {
            dismissForceDeleteDialog();
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
                if (!forceDeleteBusy) {
                  dismissForceDeleteDialog();
                }
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
    </div>
  );
}
