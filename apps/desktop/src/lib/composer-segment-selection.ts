import type { RichSegment, SegmentCaret } from "@/lib/composer-segment-model";

type WalkState = {
  segmentIndex: number;
  textOffset: number;
};

function isChip(el: HTMLElement): boolean {
  return (
    el.dataset.elementChip === "true" ||
    el.getAttribute("data-element-chip") === "true" ||
    el.dataset.fileChip === "true" ||
    el.getAttribute("data-file-chip") === "true" ||
    el.dataset.loopChip === "true" ||
    el.getAttribute("data-loop-chip") === "true" ||
    el.dataset.planChip === "true" ||
    el.getAttribute("data-plan-chip") === "true" ||
    el.dataset.askChip === "true" ||
    el.getAttribute("data-ask-chip") === "true"
  );
}

function childIndex(parent: Node, child: Node): number {
  return Array.from(parent.childNodes).indexOf(child as ChildNode);
}

/** Map DOM selection → segment caret (collapsed). */
export function selectionToCaret(root: HTMLElement, segments: RichSegment[]): SegmentCaret | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const state: WalkState = { segmentIndex: 0, textOffset: 0 };

  const resolveAt = (node: Node, offset: number): SegmentCaret | null => {
    if (node === root) {
      const children = Array.from(root.childNodes);
      const child = children[offset] ?? null;
      if (child === null) {
        return caretAtEndFromSegments(segments);
      }
      if (child.nodeType === Node.TEXT_NODE) {
        return { segmentIndex: state.segmentIndex, offset: 0 };
      }
      if (child.nodeType === Node.ELEMENT_NODE && isChip(child as HTMLElement)) {
        return { segmentIndex: state.segmentIndex, offset: 0 };
      }
      return { segmentIndex: state.segmentIndex, offset: state.textOffset };
    }
    if (node.nodeType === Node.TEXT_NODE) {
      return { segmentIndex: state.segmentIndex, offset: state.textOffset + offset };
    }
    return null;
  };

  for (const node of Array.from(root.childNodes)) {
    if (node === range.startContainer) {
      return resolveAt(node, range.startOffset);
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      if (node.contains(range.startContainer) || range.startContainer === node) {
        return { segmentIndex: state.segmentIndex, offset: state.textOffset + range.startOffset };
      }
      state.textOffset += len;
      continue;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (isChip(el)) {
        if (range.startContainer === root) {
          const idx = childIndex(root, node);
          if (range.startOffset === idx) {
            return { segmentIndex: state.segmentIndex, offset: 0 };
          }
          if (range.startOffset === idx + 1) {
            state.segmentIndex += 1;
            state.textOffset = 0;
            return { segmentIndex: state.segmentIndex, offset: 0 };
          }
        }
        state.segmentIndex += 1;
        state.textOffset = 0;
        continue;
      }
      if (el.tagName === "BR") {
        if (range.startContainer === root) {
          const idx = childIndex(root, node);
          if (range.startOffset === idx) {
            return { segmentIndex: state.segmentIndex, offset: state.textOffset };
          }
          if (range.startOffset === idx + 1) {
            state.textOffset += 1;
            return { segmentIndex: state.segmentIndex, offset: state.textOffset };
          }
        }
        state.textOffset += 1;
        continue;
      }
    }
  }

  if (range.startContainer === root && range.startOffset === root.childNodes.length) {
    return caretAtEndFromSegments(segments);
  }

  return caretAtEndFromSegments(segments);
}

function caretAtEndFromSegments(segments: RichSegment[]): SegmentCaret {
  const lastIndex = segments.length - 1;
  const last = segments[lastIndex];
  if (last?.kind === "text") {
    return { segmentIndex: lastIndex, offset: last.value.length };
  }
  return { segmentIndex: lastIndex + 1, offset: 0 };
}

/** Restore collapsed selection after segment-driven re-render. */
export function caretToDomRange(
  root: HTMLElement,
  segments: RichSegment[],
  caret: SegmentCaret,
): void {
  const sel = window.getSelection();
  if (!sel) return;

  const range = document.createRange();
  const index = Math.min(Math.max(caret.segmentIndex, 0), Math.max(segments.length - 1, 0));
  const seg = segments[index];

  let targetSegment = index;
  let targetOffset = caret.offset;

  if (!seg) {
    range.selectNodeContents(root);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }

  if (
    seg.kind === "element" ||
    seg.kind === "workspaceFile" ||
    seg.kind === "loop" ||
    seg.kind === "plan" ||
    seg.kind === "ask"
  ) {
    targetSegment = index;
    targetOffset = 0;
  }

  let walkIndex = 0;
  let placed = false;

  for (const node of Array.from(root.childNodes)) {
    const currentSeg = segments[walkIndex];
    if (!currentSeg) break;

    if (
      currentSeg.kind === "element" ||
      currentSeg.kind === "workspaceFile" ||
      currentSeg.kind === "loop" ||
      currentSeg.kind === "plan" ||
      currentSeg.kind === "ask"
    ) {
      if (walkIndex === targetSegment && targetOffset === 0) {
        range.setStartBefore(node);
        range.collapse(true);
        placed = true;
        break;
      }
      if (walkIndex === targetSegment - 1 && targetOffset === 0) {
        range.setStartAfter(node);
        range.collapse(true);
        placed = true;
        break;
      }
      walkIndex += 1;
      continue;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      if (walkIndex === targetSegment) {
        range.setStart(node, Math.min(targetOffset, len));
        range.collapse(true);
        placed = true;
        break;
      }
      walkIndex += 1;
      continue;
    }

    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") {
      if (walkIndex === targetSegment) {
        const segText = currentSeg.kind === "text" ? currentSeg.value : "";
        const nlPos = segText.indexOf("\n");
        if (targetOffset <= nlPos) {
          const textNode = node.previousSibling;
          if (textNode?.nodeType === Node.TEXT_NODE) {
            range.setStart(textNode, Math.min(targetOffset, textNode.textContent?.length ?? 0));
          } else {
            range.setStartBefore(node);
          }
        } else {
          const textNode = node.nextSibling;
          if (textNode?.nodeType === Node.TEXT_NODE) {
            range.setStart(textNode, Math.min(targetOffset - nlPos - 1, textNode.textContent?.length ?? 0));
          } else {
            range.setStartAfter(node);
          }
        }
        range.collapse(true);
        placed = true;
        break;
      }
    }
  }

  if (!placed) {
    range.selectNodeContents(root);
    range.collapse(false);
  }

  sel.removeAllRanges();
  sel.addRange(range);
}
