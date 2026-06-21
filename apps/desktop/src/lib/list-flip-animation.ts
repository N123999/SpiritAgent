export const SIDEBAR_REORDER_FLIP_DURATION_MS = 280;

export const SIDEBAR_REORDER_FLIP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

export const SIDEBAR_REORDER_DRAGGED_FLIP_DURATION_MS = 160;

export const SIDEBAR_REORDER_DRAGGED_FLIP_EASING = "linear";

export function prefersReducedSidebarReorderMotion(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function captureListFlipTops(
  nodeById: ReadonlyMap<string, HTMLElement>,
  orderedIds: readonly string[],
): Map<string, number> {
  const tops = new Map<string, number>();
  for (const id of orderedIds) {
    const node = nodeById.get(id);
    if (!node) {
      continue;
    }
    tops.set(id, node.getBoundingClientRect().top);
  }
  return tops;
}

export function clearListFlipInlineStyles(node: HTMLElement): void {
  node.classList.remove("spirit-sidebar-reorder-flip");
  node.style.transition = "";
  node.style.transform = "";
}

export function readLayoutTopWithoutTransform(node: HTMLElement): number {
  const previousTransform = node.style.transform;
  node.style.transform = "";
  const top = node.getBoundingClientRect().top;
  node.style.transform = previousTransform;
  return top;
}

export function preserveWorkspaceGroupDragVisualTop(node: HTMLElement, visualTop: number): number {
  node.classList.add("spirit-sidebar-reorder-flip");
  node.style.transition = "none";
  const layoutTop = readLayoutTopWithoutTransform(node);
  const offsetY = visualTop - layoutTop;
  node.style.transform = `translateY(${offsetY}px)`;
  return offsetY;
}

export function readWorkspaceGroupCollapseMetrics(groupNode: HTMLElement): {
  state: string | null;
  clientHeight: number;
  innerScrollHeight: number | null;
  cssVarHeight: string;
  opacity: string;
} | null {
  const content = groupNode.querySelector('[data-slot="animated-collapse-content"]');
  if (!(content instanceof HTMLElement)) {
    return null;
  }
  const inner = content.firstElementChild;
  return {
    state: content.getAttribute("data-state"),
    clientHeight: Math.round(content.clientHeight),
    innerScrollHeight: inner instanceof HTMLElement ? Math.round(inner.scrollHeight) : null,
    cssVarHeight: content.style.getPropertyValue("--spirit-collapsible-content-height"),
    opacity: getComputedStyle(content).opacity,
  };
}

/** 拖拽结束：锁定已展开内容高度，避免移除 drag 冻结后 collapse 动画从 0 重播 */
export function settleWorkspaceGroupCollapseAfterDrag(groupNode: HTMLElement): void {
  const content = groupNode.querySelector('[data-slot="animated-collapse-content"]');
  if (!(content instanceof HTMLElement) || content.getAttribute("data-state") !== "open") {
    return;
  }
  const inner = content.firstElementChild;
  if (!(inner instanceof HTMLElement)) {
    return;
  }
  const heightPx = inner.scrollHeight;
  content.classList.remove("animate-spirit-collapsible-down", "animate-spirit-collapsible-up");
  content.style.setProperty("--spirit-collapsible-content-height", `${heightPx}px`);
  content.style.height = `${heightPx}px`;
  content.style.opacity = "1";
  content.style.animation = "none";
}

export function readWorkspaceGroupFlipStates(
  nodeById: ReadonlyMap<string, HTMLElement>,
  orderedIds: readonly string[],
): Record<string, { transform: string; top: number }> {
  const result: Record<string, { transform: string; top: number }> = {};
  for (const id of orderedIds) {
    const node = nodeById.get(id);
    if (!node) {
      continue;
    }
    result[id] = {
      transform: node.style.transform || "none",
      top: Math.round(node.getBoundingClientRect().top),
    };
  }
  return result;
}

export function measureWorkspaceGroupLayoutMetrics(
  order: readonly string[],
  nodeById: ReadonlyMap<string, HTMLElement>,
): { layoutTops: Map<string, number>; heights: Map<string, number> } {
  const layoutTops = new Map<string, number>();
  const heights = new Map<string, number>();
  const nodes: Array<{ id: string; node: HTMLElement; savedTransform: string }> = [];

  for (const id of order) {
    const node = nodeById.get(id);
    if (!node) {
      continue;
    }
    nodes.push({ id, node, savedTransform: node.style.transform });
    node.style.transform = "";
  }

  for (const { id, node } of nodes) {
    layoutTops.set(id, node.getBoundingClientRect().top);
    heights.set(id, node.offsetHeight);
  }

  for (const { node, savedTransform } of nodes) {
    node.style.transform = savedTransform;
  }

  return { layoutTops, heights };
}

export function applyWorkspaceGroupDragOffset(node: HTMLElement, offsetY: number): void {
  node.classList.add("spirit-sidebar-reorder-flip");
  node.style.transition = "none";
  node.style.transform = `translateY(${offsetY}px)`;
}

export function playListFlipAnimation(options: {
  nodeById: ReadonlyMap<string, HTMLElement>;
  orderedIds: readonly string[];
  beforeTops: ReadonlyMap<string, number>;
  draggedId?: string | null;
}): void {
  if (prefersReducedSidebarReorderMotion()) {
    return;
  }

  const { nodeById, orderedIds, beforeTops, draggedId = null } = options;

  for (const id of orderedIds) {
    if (id === draggedId) {
      continue;
    }
    const node = nodeById.get(id);
    if (!node) {
      continue;
    }
    const beforeTop = beforeTops.get(id);
    if (beforeTop === undefined) {
      continue;
    }
    const afterTop = node.getBoundingClientRect().top;
    const delta = beforeTop - afterTop;
    if (Math.abs(delta) < 0.5) {
      continue;
    }

    const durationMs = SIDEBAR_REORDER_FLIP_DURATION_MS;
    const easing = SIDEBAR_REORDER_FLIP_EASING;

    node.classList.add("spirit-sidebar-reorder-flip");
    node.style.transition = "none";
    node.style.transform = `translateY(${delta}px)`;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        node.style.transition = `transform ${durationMs}ms ${easing}`;
        node.style.transform = "";

        const cleanup = (event: TransitionEvent) => {
          if (event.target !== node || event.propertyName !== "transform") {
            return;
          }
          node.removeEventListener("transitionend", cleanup);
          clearListFlipInlineStyles(node);
        };
        node.addEventListener("transitionend", cleanup);
      });
    });
  }
}
