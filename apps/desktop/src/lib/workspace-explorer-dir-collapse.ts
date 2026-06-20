import type { WorkspaceExplorerEntry } from "@/types";

export function joinExplorerRel(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

export type WorkspaceExplorerDirCollapseResult = {
  /** Deepest directory rel in the collapsed chain (used for expand/load/dnd). */
  leafRel: string;
  /** Slash-joined label shown in the tree row. */
  displayName: string;
  /** Directory rels from the first segment through leaf, inclusive. */
  chainRels: string[];
};

function shouldMergeSingleChildExplorerDir(
  childEntries: WorkspaceExplorerEntry[] | undefined,
): boolean {
  if (childEntries === undefined) {
    return true;
  }
  if (childEntries.length !== 1) {
    return true;
  }
  return childEntries[0]?.kind !== "file";
}

/**
 * Collapse linear single-child directory chains for the lazy workspace explorer.
 * Stops when listing is unknown (not loaded) or when a loaded dir has a single file child.
 */
export function collapseWorkspaceExplorerDirChain(
  startRel: string,
  startName: string,
  getEntries: (relativePath: string) => WorkspaceExplorerEntry[] | undefined,
): WorkspaceExplorerDirCollapseResult {
  let leafRel = startRel;
  let displayName = startName;
  const chainRels = [startRel];

  while (true) {
    const entries = getEntries(leafRel);
    if (!entries || entries.length !== 1) {
      break;
    }
    const only = entries[0];
    if (!only || only.kind !== "dir") {
      break;
    }

    const childRel = joinExplorerRel(leafRel, only.name);
    const childEntries = getEntries(childRel);

    if (childEntries !== undefined && !shouldMergeSingleChildExplorerDir(childEntries)) {
      break;
    }

    displayName = `${displayName}/${only.name}`;
    leafRel = childRel;
    chainRels.push(childRel);

    if (childEntries === undefined) {
      break;
    }
  }

  return { leafRel, displayName, chainRels };
}

export function isWorkspaceExplorerCollapsedDirOpen(
  chainRels: readonly string[],
  expanded: Readonly<Record<string, boolean>>,
): boolean {
  return chainRels.some((rel) => expanded[rel] === true);
}
