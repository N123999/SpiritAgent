import { makeChipNode } from "@/lib/browser-element-chip-styles";
import { makeFileChipNode } from "@/lib/workspace-file-chip-styles";
import type { RichSegment } from "@/lib/composer-segment-model";
import {
  emptySegments,
  isComposerPlainEmpty,
  segmentsToPlainText,
  syncSegmentsFromExternalValue,
} from "@/lib/composer-segment-model";
import { makeLoopChipNode } from "@/lib/loop-chip-styles";
import { makePlanChipNode } from "@/lib/plan-chip-styles";
import { makeAskChipNode } from "@/lib/ask-chip-styles";
import { makeDebugChipNode } from "@/lib/debug-chip-styles";
import { makeSkillChipNode } from "@/lib/skill-chip-styles";

export {
  caretAtEnd,
  emptySegments,
  hasSkillSegment,
  insertSegmentAtCaret,
  isComposerPlainEmpty,
  mergeAdjacentTextSegments,
  normalizeComposerPlain,
  segmentsEqual,
  segmentsToAttachments,
  segmentsToMessageText,
  segmentsToPlainText,
  syncSegmentsFromExternalValue,
  type RichSegment,
  type SegmentCaret,
} from "@/lib/composer-segment-model";

export {
  ensureLoopPinned,
  hasLoopSegment,
  insertLoopSegment,
  isCaretAtLoopRemovalPoint,
  normalizeCaretForPinnedLoopChip,
  removeLoopSegment,
} from "@/lib/composer-loop-segments";

export {
  isCaretAtInlineChipRemovalPoint,
  normalizeCaretForInlineAttachmentChips,
  removeInlineChipAtRemovalPoint,
} from "@/lib/composer-inline-chip-caret";

export { normalizeCaretForComposer } from "@/lib/composer-caret-normalize";

export { makeChipNode } from "@/lib/browser-element-chip-styles";
export { makeFileChipNode } from "@/lib/workspace-file-chip-styles";
export {
  caretAfterAgentModeChip,
  ensureAgentModePinned,
  hasAgentModeSegment,
  insertAgentModeSegment,
  isAgentModeChipKind,
  isCaretAtAgentModeRemovalPoint,
  normalizeCaretForPinnedAgentModeChip,
  removeAgentModeSegment,
} from "@/lib/composer-agent-mode-segments";

export { makePlanChipNode } from "@/lib/plan-chip-styles";
export { makeAskChipNode } from "@/lib/ask-chip-styles";
export { makeDebugChipNode } from "@/lib/debug-chip-styles";
export { makeSkillChipNode } from "@/lib/skill-chip-styles";

function mergeTextIntoLast(segs: RichSegment[], chunk: string): void {
  const last = segs[segs.length - 1];
  if (last?.kind === "text") {
    last.value += chunk;
  } else {
    segs.push({ kind: "text", value: chunk });
  }
}

/** Read-only: contenteditable DOM → segments (preserves whitespace text nodes). */
export function domToSegments(root: HTMLElement): RichSegment[] {
  const segs: RichSegment[] = [];
  appendSegmentsFromChildren(root, segs);
  const last = segs[segs.length - 1];
  if (last?.kind === "text" && last.value.endsWith("\n")) {
    last.value = last.value.slice(0, -1);
    if (!last.value) segs.pop();
  }
  // 只有在完全没有非文本片段（chip）时，才把空白正文折叠成干净的空 segments；
  // 否则会把仅含 Ask/Plan/Loop/附件 Chip 的输入框误判为空、丢掉 Chip。
  const hasNonTextSegment = segs.some((s) => s.kind !== "text");
  if (!hasNonTextSegment && isComposerPlainEmpty(segmentsToPlainText(segs))) {
    return emptySegments();
  }
  return segs.length > 0 ? segs : emptySegments();
}

function appendSegmentsFromChildren(container: Node, segs: RichSegment[]): void {
  container.childNodes.forEach((node) => appendSegmentFromNode(node, segs));
}

function appendSegmentFromNode(node: Node, segs: RichSegment[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    segs.push({ kind: "text", value: node.textContent ?? "" });
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }
  const el = node as HTMLElement;
  if (el.dataset.loopChip === "true" || el.getAttribute("data-loop-chip") === "true") {
    segs.push({ kind: "loop" });
    return;
  }
  if (el.dataset.planChip === "true" || el.getAttribute("data-plan-chip") === "true") {
    segs.push({ kind: "plan" });
    return;
  }
  if (el.dataset.askChip === "true" || el.getAttribute("data-ask-chip") === "true") {
    segs.push({ kind: "ask" });
    return;
  }
  if (el.dataset.debugChip === "true" || el.getAttribute("data-debug-chip") === "true") {
    segs.push({ kind: "debug" });
    return;
  }
  if (el.dataset.elementChip === "true" || el.getAttribute("data-element-chip") === "true") {
    const id = el.dataset.elementId;
    const tag = el.dataset.elementTag;
    const html = el.dataset.elementHtml;
    const url = el.dataset.elementUrl;
    if (id && tag && html !== undefined && url !== undefined) {
      segs.push({
        kind: "element",
        attachment: { id, tagName: tag, outerHtml: html, screenshotDataUrl: "", pageUrl: url },
      });
    }
    return;
  }
  if (el.dataset.fileChip === "true" || el.getAttribute("data-file-chip") === "true") {
    const filePath = el.dataset.filePath ?? el.getAttribute("data-file-path");
    if (filePath) {
      segs.push({ kind: "workspaceFile", path: filePath });
    }
    return;
  }
  if (el.dataset.skillChip === "true" || el.getAttribute("data-skill-chip") === "true") {
    const alias = el.dataset.skillAlias ?? el.getAttribute("data-skill-alias");
    if (alias) {
      segs.push({ kind: "skill", alias });
    }
    return;
  }
  if (el.tagName === "BR") {
    mergeTextIntoLast(segs, "\n");
    return;
  }
  if (el.tagName === "DIV" || el.tagName === "P") {
    appendSegmentsFromChildren(el, segs);
  }
}

export function segmentsToDom(
  segs: RichSegment[],
  doc: Document,
  opts?: { loopLabel?: string; planLabel?: string; askLabel?: string; debugLabel?: string },
): DocumentFragment {
  const frag = doc.createDocumentFragment();
  for (const seg of segs) {
    if (seg.kind === "text") {
      const lines = seg.value.split("\n");
      lines.forEach((line, i) => {
        frag.appendChild(doc.createTextNode(line));
        if (i < lines.length - 1) {
          frag.appendChild(doc.createElement("br"));
        }
      });
    } else if (seg.kind === "loop") {
      frag.appendChild(makeLoopChipNode(doc, opts?.loopLabel ?? "Loop"));
    } else if (seg.kind === "plan") {
      frag.appendChild(makePlanChipNode(doc, opts?.planLabel ?? "Plan"));
    } else if (seg.kind === "ask") {
      frag.appendChild(makeAskChipNode(doc, opts?.askLabel ?? "Ask"));
    } else if (seg.kind === "debug") {
      frag.appendChild(makeDebugChipNode(doc, opts?.debugLabel ?? "Debug"));
    } else if (seg.kind === "workspaceFile") {
      frag.appendChild(makeFileChipNode(seg.path, doc));
    } else if (seg.kind === "skill") {
      frag.appendChild(makeSkillChipNode(seg.alias, doc));
    } else {
      frag.appendChild(makeChipNode(seg.attachment, doc));
    }
  }
  return frag;
}

export function renderSegmentsToElement(
  root: HTMLElement,
  segs: RichSegment[],
  opts?: { loopLabel?: string; planLabel?: string; askLabel?: string; debugLabel?: string },
): void {
  root.replaceChildren(segmentsToDom(segs, root.ownerDocument, opts));
}

export function applyExternalTextValue(segs: RichSegment[], value: string): RichSegment[] {
  return syncSegmentsFromExternalValue(segs, value);
}
