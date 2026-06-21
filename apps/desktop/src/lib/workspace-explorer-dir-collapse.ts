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
    return false;
  }
  if (childEntries.length === 0) {
    return true;
  }
  if (childEntries.length !== 1) {
    return true;
  }
  return childEntries[0]?.kind !== "file";
}

/**
 * Collapse linear single-child directory chains for the lazy workspace explorer.
 * Merges through loaded empty dirs; stops on unknown listings or a single-file child.
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

    if (childEntries === undefined) {
      break;
    }

    displayName = `${displayName}/${only.name}`;
    leafRel = childRel;
    chainRels.push(childRel);
  }

  return { leafRel, displayName, chainRels };
}

/**
 * Next relative paths to load so dir-chain collapse can advance.
 * Returns at most one segment per call—the first unloaded dir on a single-child chain.
 */
export function collectWorkspaceExplorerDirCollapsePrefetchRels(
  startRel: string,
  getEntries: (relativePath: string) => WorkspaceExplorerEntry[] | undefined,
): string[] {
  let leafRel = startRel;

  while (true) {
    const entries = getEntries(leafRel);
    if (!entries || entries.length !== 1) {
      return [];
    }
    const only = entries[0];
    if (!only || only.kind !== "dir") {
      return [];
    }

    const childRel = joinExplorerRel(leafRel, only.name);
    const childEntries = getEntries(childRel);

    if (childEntries !== undefined && !shouldMergeSingleChildExplorerDir(childEntries)) {
      return [];
    }

    if (childEntries === undefined) {
      return [childRel];
    }

    leafRel = childRel;
  }
}

export function isWorkspaceExplorerCollapsedDirOpen(
  chainRels: readonly string[],
  expanded: Readonly<Record<string, boolean>>,
): boolean {
  return chainRels.some((rel) => expanded[rel] === true);
}
