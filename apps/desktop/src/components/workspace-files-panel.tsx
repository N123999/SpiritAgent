import { useCallback, useEffect, useState } from "react";

import {
  Brackets,
  ChevronDown,
  ChevronRight,
  Database,
  File,
  FileCode,
  FileJson,
  FileText,
  Folder,
  Image as ImageIcon,
  Settings2,
  Terminal,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { WorkspaceExplorerEntry, WorkspaceExplorerListResult } from "@/types";

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

export function joinExplorerRel(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

/** 按扩展名/常见文件名选图标（类似编辑器文件树，非 VS Code 主题引擎）。 */
export function workspaceExplorerIcon(name: string, kind: WorkspaceExplorerEntry["kind"]): LucideIcon {
  if (kind === "dir") {
    return Folder;
  }
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) {
    return FileCode;
  }
  if (lower === "package.json" || lower === "package-lock.json" || lower === "pnpm-lock.yaml" || lower === "yarn.lock") {
    return FileJson;
  }
  if (lower === "cargo.toml" || lower === "cargo.lock" || lower.endsWith(".toml")) {
    return Settings2;
  }
  if (lower === "makefile" || lower === "cmake" || lower.endsWith(".mk")) {
    return Terminal;
  }
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"].includes(ext)) {
    return ImageIcon;
  }
  if (["md", "mdx"].includes(ext)) {
    return FileText;
  }
  if (["json", "jsonc"].includes(ext)) {
    return FileJson;
  }
  if (["sql"].includes(ext)) {
    return Database;
  }
  if (
    [
      "ts",
      "tsx",
      "mts",
      "cts",
      "js",
      "jsx",
      "mjs",
      "cjs",
      "rs",
      "go",
      "py",
      "java",
      "kt",
      "c",
      "h",
      "cpp",
      "hpp",
      "cs",
      "swift",
      "vue",
      "svelte",
      "rb",
      "php",
      "zig",
    ].includes(ext)
  ) {
    return FileCode;
  }
  if (["html", "htm", "css", "scss", "sass", "less"].includes(ext)) {
    return Brackets;
  }
  return File;
}

type DirCacheEntry =
  | { status: "loading" }
  | { status: "ready"; entries: WorkspaceExplorerEntry[] }
  | { status: "error"; message: string };

export type WorkspaceFilesPanelProps = {
  workspaceRoot: string;
  listExplorerChildren: (relativePath: string) => Promise<WorkspaceExplorerListResult>;
};

export function WorkspaceFilesPanel({ workspaceRoot, listExplorerChildren }: WorkspaceFilesPanelProps) {
  const [rootOpen, setRootOpen] = useState(true);
  const [cache, setCache] = useState<Record<string, DirCacheEntry>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  if (!workspaceRoot.trim()) {
    return <p className="text-muted-foreground">连接工作区后显示文件树</p>;
  }

  const rootLabel = fileBasename(workspaceRoot.trim()) || workspaceRoot.trim();

  const renderDirBody = (rel: string, depth: number) => {
    const state = cache[rel];
    // 加载中不插入文案块，避免高度变化造成「卡一下」
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

          if (!isDir) {
            return (
              <li
                key={childRel}
                className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5"
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
              >
                <span className="inline-block w-4 shrink-0" aria-hidden />
                <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
                <span className="min-w-0 truncate text-foreground/90">{entry.name}</span>
              </li>
            );
          }

          return (
            <li key={childRel} className="min-w-0">
              <button
                type="button"
                className={cn(
                  "flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left",
                  "text-foreground/90 hover:bg-foreground/[0.06] dark:hover:bg-foreground/10",
                )}
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
                aria-expanded={open}
                onClick={() => onToggleDir(childRel)}
              >
                {open ? (
                  <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden />
                )}
                <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
                <span className="min-w-0 truncate font-medium">{entry.name}</span>
              </button>
              {open ? <div className="min-w-0">{renderDirBody(childRel, depth + 1)}</div> : null}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-xs">
      <button
        type="button"
        className={cn(
          "mb-1 flex w-full min-w-0 shrink-0 items-center gap-1 rounded px-1 py-1 text-left font-medium",
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
      {rootOpen ? (
        <div
          className="spirit-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden pr-0.5"
          role="tree"
          aria-label="文件列表"
          aria-busy={cache[""]?.status === "loading" ? true : undefined}
        >
          {renderDirBody("", 0)}
        </div>
      ) : null}
    </div>
  );
}
