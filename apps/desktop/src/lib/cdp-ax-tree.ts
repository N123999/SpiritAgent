import type { ComputerUseTreeNode } from './computer-use-tree.js';

export interface CdpAxNode {
  nodeId?: string;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  description?: { value?: string };
  value?: { value?: string };
  backendDOMNodeId?: number;
  parentId?: string;
  childIds?: string[];
  properties?: Array<{ name?: string; value?: { value?: unknown } }>;
}

export interface BuildCdpAxTreeOptions {
  port: number;
  maxDepth?: number;
  maxNodes?: number;
}

export interface BuildCdpAxTreeResult {
  tree: ComputerUseTreeNode | null;
  nodesReturned: number;
  coverage: 'full' | 'partial';
}

const CDP_REF_PATTERN = /^c(\d+)n(\d+)$/i;

export function isCdpComputerUseRef(value: string): boolean {
  return CDP_REF_PATTERN.test(value);
}

export function parseCdpComputerUseRef(value: string): { port: number; backendDomNodeId: number } | null {
  const match = CDP_REF_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  return {
    port: Number.parseInt(match[1]!, 10),
    backendDomNodeId: Number.parseInt(match[2]!, 10),
  };
}

export function makeCdpRef(port: number, backendDomNodeId: number): string {
  return `c${port}n${backendDomNodeId}`;
}

function rolePatterns(role: string): string[] {
  const normalized = role.toLowerCase();
  const patterns: string[] = [];
  if (
    normalized === 'button'
    || normalized === 'link'
    || normalized === 'menuitem'
    || normalized === 'tab'
    || normalized === 'listitem'
  ) {
    patterns.push('invoke');
  }
  if (
    normalized === 'textbox'
    || normalized === 'searchbox'
    || normalized === 'combobox'
    || normalized === 'textarea'
  ) {
    patterns.push('set_value');
  }
  if (normalized === 'checkbox' || normalized === 'switch') {
    patterns.push('toggle');
  }
  if (normalized === 'listitem' || normalized === 'option' || normalized === 'treeitem') {
    patterns.push('select');
  }
  if (normalized === 'treeitem' || normalized === 'menuitem') {
    patterns.push('expand_collapse');
  }
  return patterns;
}

function readPropertyBoolean(node: CdpAxNode, name: string): boolean {
  const entry = node.properties?.find((item) => item.name === name);
  const value = entry?.value?.value;
  return value === true;
}

export function buildCdpAxTree(
  nodes: CdpAxNode[],
  options: BuildCdpAxTreeOptions,
): BuildCdpAxTreeResult {
  const maxDepth = options.maxDepth ?? 8;
  const maxNodes = options.maxNodes ?? 400;
  const byId = new Map<string, CdpAxNode>();
  for (const node of nodes) {
    if (node.nodeId) {
      byId.set(node.nodeId, node);
    }
  }

  const root = nodes.find((node) => !node.parentId || !byId.has(node.parentId));
  if (!root?.nodeId) {
    return { tree: null, nodesReturned: 0, coverage: 'full' };
  }

  let count = 0;
  let truncated = false;

  const walk = (node: CdpAxNode, depth: number): ComputerUseTreeNode | null => {
    if (count >= maxNodes) {
      truncated = true;
      return null;
    }
    if (node.ignored) {
      return null;
    }

    count += 1;
    const role = node.role?.value ?? 'unknown';
    const name = node.name?.value ?? node.description?.value ?? node.value?.value ?? '';
    const backendDomNodeId = node.backendDOMNodeId ?? 0;
    const childNodes =
      depth >= maxDepth
        ? []
        : (node.childIds ?? [])
            .map((childId) => byId.get(childId))
            .filter((child): child is CdpAxNode => child !== undefined)
            .map((child) => walk(child, depth + 1))
            .filter((child): child is ComputerUseTreeNode => child !== null);

    return {
      ref: makeCdpRef(options.port, backendDomNodeId),
      role,
      name,
      automation_id: '',
      patterns: rolePatterns(role),
      is_enabled: !readPropertyBoolean(node, 'disabled'),
      is_offscreen: readPropertyBoolean(node, 'offscreen'),
      children: childNodes.length > 0 ? childNodes : undefined,
    };
  };

  const tree = walk(root, 0);
  return {
    tree,
    nodesReturned: count,
    coverage: truncated ? 'partial' : 'full',
  };
}
