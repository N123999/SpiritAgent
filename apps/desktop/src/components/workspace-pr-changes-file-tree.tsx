import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";

import { WorkspaceFileIcon } from "@/components/workspace-file-icon";

import { cn } from "@/lib/utils";
import type { PrChangedFilesTreeNode } from "@/lib/pr-changed-files-tree";

const TREE_ROW_HOVER_CLASS =
  "text-foreground/90 hover:bg-foreground/[0.06] dark:hover:bg-foreground/10";

export type WorkspacePrChangesFileTreeProps = {
  nodes: PrChangedFilesTreeNode[];
  onSelectFile: (filename: string) => void;
  className?: string;
};

function PrChangesTreeNodeRow({
  node,
  depth,
  onSelectFile,
}: {
  node: PrChangedFilesTreeNode;
  depth: number;
  onSelectFile: (filename: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);

  if (node.kind === "file") {
    return (
      <li role="treeitem" className="min-w-0">
        <button
          type="button"
          className={cn(
            "flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50",
            TREE_ROW_HOVER_CLASS,
          )}
          style={{ paddingLeft: depth * 12 + 4 }}
          onClick={() => onSelectFile(node.path)}
        >
          <span className="inline-block w-4 shrink-0" aria-hidden />
          <WorkspaceFileIcon path={node.path} className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{node.name}</span>
        </button>
      </li>
    );
  }

  return (
    <li role="treeitem" aria-expanded={open} className="min-w-0">
      <button
        type="button"
        className={cn(
          "flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-xs outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50",
          TREE_ROW_HOVER_CLASS,
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden />
        )}
        <Folder className="size-3.5 shrink-0 opacity-70" aria-hidden />
        <span className="min-w-0 truncate">{node.name}</span>
      </button>
      {open ? (
        <ul role="group" className="list-none space-y-0.5 p-0">
          {node.children.map((child) => (
            <PrChangesTreeNodeRow
              key={child.kind === "dir" ? `dir:${child.path}` : `file:${child.path}`}
              node={child}
              depth={depth + 1}
              onSelectFile={onSelectFile}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function WorkspacePrChangesFileTree({
  nodes,
  onSelectFile,
  className,
}: WorkspacePrChangesFileTreeProps) {
  const { t } = useTranslation();

  return (
    <ul
      role="tree"
      aria-label={t("workspace.prChangesFileTreeAria")}
      className={cn("list-none space-y-0.5 p-0 py-1 text-xs", className)}
    >
      {nodes.map((node) => (
        <PrChangesTreeNodeRow
          key={node.kind === "dir" ? `dir:${node.path}` : `file:${node.path}`}
          node={node}
          depth={0}
          onSelectFile={onSelectFile}
        />
      ))}
    </ul>
  );
}
