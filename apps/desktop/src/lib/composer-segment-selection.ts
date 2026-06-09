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
    el.getAttribute("data-ask-chip") === "true" ||
    el.dataset.debugChip === "true" ||
    el.getAttribute("data-debug-chip") === "true" ||
    el.dataset.skillChip === "true" ||
    el.getAttribute("data-skill-chip") === "true"
  );
}

function childIndex(parent: Node, child: Node): number {
  return Array.from(parent.childNodes).indexOf(child as ChildNode);
}

/** Plain length of text/br inside a DIV/P wrapper (browser Shift+Enter). */
function plainLengthInContainer(container: Node): number {
  let plain = 0;
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      plain += node.textContent?.length ?? 0;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === "BR") {
        plain += 1;
      } else if (el.tagName === "DIV" || el.tagName === "P") {
        plain += plainLengthInContainer(el);
      }
    }
  }
  return plain;
}

function advancePastNode(node: Node, segments: RichSegment[], state: WalkState): void {
  const seg = segments[state.segmentIndex];
  if (!seg) {
    return;
  }

  if (seg.kind === "text") {
    if (node.nodeType === Node.TEXT_NODE) {
      state.textOffset += node.textContent?.length ?? 0;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === "BR") {
        state.textOffset += 1;
      } else if (isChip(el)) {
        state.segmentIndex += 1;
        state.textOffset = 0;
        return;
      } else if (el.tagName === "DIV" || el.tagName === "P") {
        for (const child of Array.from(el.childNodes)) {
          advancePastNode(child, segments, state);
        }
        return;
      }
    }
    if (state.textOffset >= seg.value.length) {
      state.segmentIndex += 1;
      state.textOffset = 0;
    }
    return;
  }

  if (node.nodeType === Node.ELEMENT_NODE && isChip(node as HTMLElement)) {
    state.segmentIndex += 1;
    state.textOffset = 0;
  }
}

function advancePrefixBeforeCaret(node: Node, segments: RichSegment[], state: WalkState): void {
  const seg = segments[state.segmentIndex];
  if (!seg) {
    return;
  }

  if (seg.kind === "text") {
    if (node.nodeType === Node.TEXT_NODE) {
      state.textOffset += node.textContent?.length ?? 0;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === "BR") {
        state.textOffset += 1;
        return;
      }
      if (el.tagName === "DIV" || el.tagName === "P") {
        state.textOffset += plainLengthInContainer(el);
        return;
      }
      if (isChip(el)) {
        state.segmentIndex += 1;
        state.textOffset = 0;
      }
    }
    return;
  }

  if (node.nodeType === Node.ELEMENT_NODE && isChip(node as HTMLElement)) {
    state.segmentIndex += 1;
    state.textOffset = 0;
  }
}

function clampCaretToSegments(segments: RichSegment[], caret: SegmentCaret): SegmentCaret {
  const seg = segments[caret.segmentIndex];
  if (seg?.kind === "text") {
    return {
      segmentIndex: caret.segmentIndex,
      offset: Math.max(0, Math.min(caret.offset, seg.value.length)),
    };
  }
  if (seg) {
    return { segmentIndex: caret.segmentIndex, offset: 0 };
  }
  return caretAtEndFromSegments(segments);
}

function findCaretInContainer(
  container: Node,
  segments: RichSegment[],
  targetContainer: Node,
  targetOffset: number,
  state: WalkState,
): SegmentCaret | null {
  if (container === targetContainer) {
    const children = Array.from(container.childNodes);
    for (let i = 0; i < targetOffset; i++) {
      const sibling = children[i];
      if (sibling) {
        advancePrefixBeforeCaret(sibling, segments, state);
      }
    }
    const child = children[targetOffset] ?? null;
    if (child === null) {
      return clampCaretToSegments(segments, {
        segmentIndex: state.segmentIndex,
        offset: state.textOffset,
      });
    }
    if (child.nodeType === Node.TEXT_NODE) {
      return clampCaretToSegments(segments, {
        segmentIndex: state.segmentIndex,
        offset: state.textOffset,
      });
    }
    if (child.nodeType === Node.ELEMENT_NODE && isChip(child as HTMLElement)) {
      return { segmentIndex: state.segmentIndex, offset: 0 };
    }
    if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName === "BR") {
      return { segmentIndex: state.segmentIndex, offset: state.textOffset };
    }
    return { segmentIndex: state.segmentIndex, offset: state.textOffset };
  }

  for (const node of Array.from(container.childNodes)) {
    if (node === targetContainer) {
      if (node.nodeType === Node.TEXT_NODE) {
        return clampCaretToSegments(segments, {
          segmentIndex: state.segmentIndex,
          offset: state.textOffset + targetOffset,
        });
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.tagName === "BR") {
          if (targetOffset === 0) {
            return { segmentIndex: state.segmentIndex, offset: state.textOffset };
          }
          return { segmentIndex: state.segmentIndex, offset: state.textOffset + 1 };
        }
        if (el.tagName === "DIV" || el.tagName === "P") {
          return findCaretInContainer(node, segments, targetContainer, targetOffset, state);
        }
      }
      return { segmentIndex: state.segmentIndex, offset: state.textOffset };
    }

    if (node.contains(targetContainer)) {
      if (node.nodeType === Node.TEXT_NODE) {
        return clampCaretToSegments(segments, {
          segmentIndex: state.segmentIndex,
          offset: state.textOffset + targetOffset,
        });
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (isChip(el)) {
          if (targetContainer === container) {
            const idx = childIndex(container, node);
            if (targetOffset === idx) {
              return { segmentIndex: state.segmentIndex, offset: 0 };
            }
            if (targetOffset === idx + 1) {
              state.segmentIndex += 1;
              state.textOffset = 0;
              return { segmentIndex: state.segmentIndex, offset: 0 };
            }
          }
        }
        if (el.tagName === "DIV" || el.tagName === "P") {
          const found = findCaretInContainer(node, segments, targetContainer, targetOffset, state);
          if (found) {
            return found;
          }
        }
      }
    }

    advancePastNode(node, segments, state);
  }

  return null;
}

/** Map DOM selection → segment caret (collapsed). */
export function selectionToCaret(root: HTMLElement, segments: RichSegment[]): SegmentCaret | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const state: WalkState = { segmentIndex: 0, textOffset: 0 };
  const found = findCaretInContainer(
    root,
    segments,
    range.startContainer,
    range.startOffset,
    state,
  );
  if (found) {
    return found;
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

function skipSegmentDom(root: HTMLElement, start: number, seg: RichSegment | undefined): number {
  if (!seg) {
    return start;
  }
  if (seg.kind === "text") {
    let plain = 0;
    const children = root.childNodes;
    for (let i = start; i < children.length; i++) {
      const node = children[i];
      if (node.nodeType === Node.ELEMENT_NODE && isChip(node as HTMLElement)) {
        return i;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        plain += node.textContent?.length ?? 0;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.tagName === "BR") {
          plain += 1;
        } else if (el.tagName === "DIV" || el.tagName === "P") {
          plain += plainLengthInContainer(el);
        } else {
          return i;
        }
      }
      if (plain >= seg.value.length) {
        return i + 1;
      }
    }
    return children.length;
  }
  return start + 1;
}

/** Place caret at plain offset within one text segment's DOM (text + br + nested div). */
function setCaretInTextDom(
  container: Node,
  targetOffset: number,
  range: Range,
  maxPlain: number,
): boolean {
  let plain = 0;
  const target = Math.max(0, Math.min(targetOffset, maxPlain));

  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      if (target <= plain + len) {
        range.setStart(node, target - plain);
        range.collapse(true);
        return true;
      }
      plain += len;
      continue;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === "BR") {
        if (target <= plain + 1) {
          if (target === plain) {
            range.setStartBefore(node);
          } else {
            range.setStartAfter(node);
          }
          range.collapse(true);
          return true;
        }
        plain += 1;
        continue;
      }
      if (el.tagName === "DIV" || el.tagName === "P") {
        const innerLen = plainLengthInContainer(el);
        if (target <= plain + innerLen) {
          return setCaretInTextDom(el, target - plain, range, innerLen);
        }
        plain += innerLen;
        continue;
      }
    }
  }
  return false;
}

function setCaretInTextSegment(
  root: HTMLElement,
  startChildIdx: number,
  segText: string,
  targetOffset: number,
  range: Range,
): boolean {
  let plain = 0;
  const target = Math.max(0, Math.min(targetOffset, segText.length));
  const children = root.childNodes;

  for (let i = startChildIdx; i < children.length; i++) {
    const node = children[i];
    if (node.nodeType === Node.ELEMENT_NODE && isChip(node as HTMLElement)) {
      break;
    }
    if (plain >= segText.length) {
      break;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      const segmentRemaining = segText.length - plain;
      const effectiveLen = Math.min(len, segmentRemaining);
      if (target <= plain + effectiveLen) {
        range.setStart(node, target - plain);
        range.collapse(true);
        return true;
      }
      plain += len;
      continue;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === "BR") {
        if (target <= plain + 1) {
          if (target === plain) {
            range.setStartBefore(node);
          } else {
            range.setStartAfter(node);
          }
          range.collapse(true);
          return true;
        }
        plain += 1;
        continue;
      }
      if (el.tagName === "DIV" || el.tagName === "P") {
        const innerLen = Math.min(plainLengthInContainer(el), segText.length - plain);
        if (target <= plain + innerLen) {
          return setCaretInTextDom(el, target - plain, range, innerLen);
        }
        plain += plainLengthInContainer(el);
        continue;
      }
    }
  }

  return false;
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

  if (!seg) {
    range.selectNodeContents(root);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }

  let childIdx = 0;
  let segIdx = 0;
  let placed = false;

  while (segIdx < segments.length && childIdx < root.childNodes.length) {
    const currentSeg = segments[segIdx];
    const node = root.childNodes[childIdx];
    if (!currentSeg || !node) {
      break;
    }

    if (currentSeg.kind === "text") {
      if (segIdx === index) {
        placed = setCaretInTextSegment(root, childIdx, currentSeg.value, caret.offset, range);
        break;
      }
      childIdx = skipSegmentDom(root, childIdx, currentSeg);
      segIdx += 1;
      continue;
    }

    if (segIdx === index && caret.offset === 0) {
      // Caret on a chip segment means "after chip" for typing (Ask/Plan fix generalized).
      range.setStartAfter(node);
      range.collapse(true);
      placed = true;
      break;
    }
    if (segIdx === index - 1 && caret.offset === 0) {
      range.setStartAfter(node);
      range.collapse(true);
      placed = true;
      break;
    }
    childIdx += 1;
    segIdx += 1;
  }

  if (!placed) {
    range.selectNodeContents(root);
    range.collapse(false);
  }

  sel.removeAllRanges();
  sel.addRange(range);
}
