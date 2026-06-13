import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, FileCode2, Folder } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PrChangedFilesTreeNode } from "@/lib/pr-changed-files-tree";

export type WorkspacePrChangesFileTreeProps = {
  nodes: PrChangedFilesTreeNode[];
  selectedFilename: string | null;
  onSelectFile: (filename: string) => void;
  className?: string;
};

function PrChangesTreeNodeRow({
  node,
  depth,
  selectedFilename,
  onSelectFile,
}: {
  node: PrChangedFilesTreeNode;
  depth: number;
  selectedFilename: string | null;
  onSelectFile: (filename: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);

  if (node.kind === "file") {
    const selected = selectedFilename === node.path;
    return (
      <li role="treeitem" aria-selected={selected}>
        <button
          type="button"
          className={cn(
            "flex w-full min-w-0 items-center gap-1 rounded-sm py-1 pr-2 text-left font-mono text-[11px] outline-none cursor-pointer hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50",
            selected && "bg-muted text-foreground",
            !selected && "text-muted-foreground",
          )}
          style={{ paddingLeft: depth * 12 + 8 }}
          onClick={() => onSelectFile(node.path)}
        >
          <FileCode2 className="size-3 shrink-0 opacity-60" aria-hidden />
          <span className="min-w-0 truncate">{node.name}</span>
        </button>
      </li>
    );
  }

  return (
    <li role="treeitem" aria-expanded={open}>
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-1 rounded-sm py-1 pr-2 text-left text-[11px] text-muted-foreground outline-none cursor-pointer hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50"
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
        ) : (
          <ChevronRight className="size-3 shrink-0 opacity-60" aria-hidden />
        )}
        <Folder className="size-3 shrink-0 opacity-60" aria-hidden />
        <span className="min-w-0 truncate">{node.name}</span>
      </button>
      {open ? (
        <ul role="group" className="list-none">
          {node.children.map((child) => (
            <PrChangesTreeNodeRow
              key={child.kind === "dir" ? `dir:${child.path}` : `file:${child.path}`}
              node={child}
              depth={depth + 1}
              selectedFilename={selectedFilename}
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
  selectedFilename,
  onSelectFile,
  className,
}: WorkspacePrChangesFileTreeProps) {
  const { t } = useTranslation();

  return (
    <ul
      role="tree"
      aria-label={t("workspace.prChangesFileTreeAria")}
      className={cn("list-none py-1", className)}
    >
      {nodes.map((node) => (
        <PrChangesTreeNodeRow
          key={node.kind === "dir" ? `dir:${node.path}` : `file:${node.path}`}
          node={node}
          depth={0}
          selectedFilename={selectedFilename}
          onSelectFile={onSelectFile}
        />
      ))}
    </ul>
  );
}
