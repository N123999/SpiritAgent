import type { RichSegment, SegmentCaret } from "./composer-segment-model";
import { emptySegments, mergeAdjacentTextSegments } from "./composer-segment-model";

function isInlineAttachmentChip(
  seg: RichSegment | undefined,
): seg is Extract<
  RichSegment,
  { kind: "element" | "prDiff" | "terminalSnippet" | "fileSnippet" | "workspaceFile" | "skill" }
> {
  return (
    seg?.kind === "element"
    || seg?.kind === "prDiff"
    || seg?.kind === "terminalSnippet"
    || seg?.kind === "fileSnippet"
    || seg?.kind === "workspaceFile"
    || seg?.kind === "skill"
  );
}

function caretAfterInlineChip(segs: RichSegment[], chipIndex: number): SegmentCaret {
  const merged = mergeAdjacentTextSegments(segs);
  const textIndex = merged.findIndex((s, i) => i > chipIndex && s.kind === "text");
  if (textIndex >= 0) {
    const textSeg = merged[textIndex];
    const offset =
      textSeg?.kind === "text" && textSeg.value.startsWith(" ") ? 1 : 0;
    return { segmentIndex: textIndex, offset };
  }
  return { segmentIndex: chipIndex + 1, offset: 0 };
}

/** DOM/selection often reports segment N on the chip; snap to typed position after it. */
export function normalizeCaretForInlineAttachmentChips(
  segs: RichSegment[],
  caret: SegmentCaret | null,
): SegmentCaret {
  if (!caret) {
    return { segmentIndex: 0, offset: 0 };
  }
  const merged = mergeAdjacentTextSegments(segs);
  const at = merged[caret.segmentIndex];
  if (isInlineAttachmentChip(at) && caret.offset === 0) {
    return caretAfterInlineChip(merged, caret.segmentIndex);
  }
  return caret;
}

/** True when caret is immediately after an inline file/element chip (Backspace removes it). */
export function isCaretAtInlineChipRemovalPoint(
  segs: RichSegment[],
  caret: SegmentCaret,
): boolean {
  const merged = mergeAdjacentTextSegments(segs);
  const at = merged[caret.segmentIndex];
  if (at?.kind !== "text" || caret.offset !== 0) {
    return false;
  }
  const prev = merged[caret.segmentIndex - 1];
  return isInlineAttachmentChip(prev);
}

export function removeInlineChipAtRemovalPoint(
  segs: RichSegment[],
  caret: SegmentCaret,
): { segments: RichSegment[]; caret: SegmentCaret } | null {
  if (!isCaretAtInlineChipRemovalPoint(segs, caret)) {
    return null;
  }
  const merged = mergeAdjacentTextSegments(segs);
  const chipIndex = caret.segmentIndex - 1;
  const stripped = stripInlineChipTailSpacer(merged, chipIndex, caret);
  const caretSegmentIndex = Math.min(chipIndex, Math.max(stripped.length - 1, 0));
  const at = stripped[caretSegmentIndex];
  const nextCaret: SegmentCaret =
    at?.kind === "text"
      ? { segmentIndex: caretSegmentIndex, offset: Math.min(caret.offset, at.value.length) }
      : { segmentIndex: caretSegmentIndex, offset: 0 };
  return { segments: stripped, caret: nextCaret };
}

/** Remove chip-inserted tail spacer immediately after an inline attachment chip. */
function stripInlineChipTailSpacer(
  segs: RichSegment[],
  chipIndex: number,
  caret: SegmentCaret,
): RichSegment[] {
  const withoutChip = [...segs.slice(0, chipIndex), ...segs.slice(chipIndex + 1)];
  const tailIdx = chipIndex;
  const tail = withoutChip[tailIdx];
  if (tail?.kind !== "text") {
    const merged = mergeAdjacentTextSegments(withoutChip);
    return merged.length > 0 ? merged : emptySegments();
  }
  if (caret.offset === 0 && (tail.value === "" || isWhitespaceOnlyText(tail.value))) {
    const merged = mergeAdjacentTextSegments([
      ...withoutChip.slice(0, tailIdx),
      ...withoutChip.slice(tailIdx + 1),
    ]);
    return merged.length > 0 ? merged : emptySegments();
  }
  if (
    caret.offset === 0 &&
    tail.value.startsWith(" ") &&
    shouldStripLeadingSpacerAfterChip(segs, chipIndex)
  ) {
    const merged = mergeAdjacentTextSegments([
      ...withoutChip.slice(0, tailIdx),
      { kind: "text", value: tail.value.slice(1) },
      ...withoutChip.slice(tailIdx + 1),
    ]);
    return merged.length > 0 ? merged : emptySegments();
  }
  const merged = mergeAdjacentTextSegments(withoutChip);
  return merged.length > 0 ? merged : emptySegments();
}

function shouldStripLeadingSpacerAfterChip(segs: RichSegment[], chipIndex: number): boolean {
  const before = segs.slice(0, chipIndex);
  if (before.length === 0) {
    return true;
  }
  return before.every((s) => {
    if (s.kind === "loop" || s.kind === "plan" || s.kind === "ask" || s.kind === "debug") {
      return true;
    }
    if (s.kind === "text") {
      return s.value === "";
    }
    return false;
  });
}

function isWhitespaceOnlyText(value: string): boolean {
  return value.length > 0 && value.trim() === "";
}
