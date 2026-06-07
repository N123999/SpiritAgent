export interface ComputerUseTreeNode {
  ref: string;
  role: string;
  name: string;
  automation_id: string;
  patterns: string[];
  is_enabled: boolean;
  is_offscreen: boolean;
  children?: ComputerUseTreeNode[];
}

import { isCdpComputerUseRef, parseCdpComputerUseRef } from './cdp-ax-tree.js';

export { isCdpComputerUseRef, parseCdpComputerUseRef };

const REF_PATTERN = /^w[0-9a-f]+n\d+$/i;

export function isComputerUseRef(value: string): boolean {
  return REF_PATTERN.test(value) || isCdpComputerUseRef(value);
}

export function parseComputerUseRef(value: string): { windowHwndHex: string; ordinal: number } | null {
  const match = /^w([0-9a-f]+)n(\d+)$/i.exec(value);
  if (!match) {
    return null;
  }
  return {
    windowHwndHex: match[1]!.toLowerCase(),
    ordinal: Number.parseInt(match[2]!, 10),
  };
}

/** Flatten tree to ref-indexed rows for token-efficient tool results. */
export function flattenComputerUseTree(
  root: ComputerUseTreeNode,
): Array<{ ref: string; role: string; name: string; patterns: string[]; depth: number }> {
  const rows: Array<{ ref: string; role: string; name: string; patterns: string[]; depth: number }> = [];

  const walk = (node: ComputerUseTreeNode, depth: number) => {
    rows.push({
      ref: node.ref,
      role: node.role,
      name: node.name,
      patterns: node.patterns,
      depth,
    });
    for (const child of node.children ?? []) {
      walk(child, depth + 1);
    }
  };

  walk(root, 0);
  return rows;
}

/** Drop empty-name leaf groups to reduce noise in LLM-facing snapshots. */
export function pruneComputerUseTree(node: ComputerUseTreeNode): ComputerUseTreeNode | null {
  const children = (node.children ?? [])
    .map((child) => pruneComputerUseTree(child))
    .filter((child): child is ComputerUseTreeNode => child !== null);

  const hasLabel = node.name.trim().length > 0 || node.automation_id.trim().length > 0;
  const hasPatterns = node.patterns.length > 0;
  if (!hasLabel && !hasPatterns && children.length === 0) {
    return null;
  }

  return {
    ...node,
    children: children.length > 0 ? children : undefined,
  };
}
