import type { RichSegment, SegmentCaret } from "./composer-segment-model";
import { emptySegments, mergeAdjacentTextSegments } from "./composer-segment-model";

const AGENT_MODE_KINDS = new Set(["plan", "ask", "debug"]);

function isAgentModeKind(kind: RichSegment["kind"]): boolean {
  return AGENT_MODE_KINDS.has(kind);
}

export function loopChipIndex(segs: RichSegment[]): number {
  return segs.findIndex((s) => s.kind === "loop");
}

export function hasLoopSegment(segs: RichSegment[]): boolean {
  return loopChipIndex(segs) >= 0;
}

export function removeLoopSegment(segs: RichSegment[]): RichSegment[] {
  return mergeAdjacentTextSegments(segs.filter((s) => s.kind !== "loop"));
}

/** Insert loop after existing structural chips (plan/ask/debug), before body text. */
function loopInsertIndex(segs: RichSegment[]): number {
  let insertAt = 0;
  for (let i = 0; i < segs.length; i++) {
    const kind = segs[i]?.kind;
    if (kind === "plan" || kind === "ask" || kind === "debug") {
      insertAt = i + 1;
    } else {
      break;
    }
  }
  return insertAt;
}

/** Keep at most one loop chip in the structural prefix; preserve order vs plan/ask/debug. */
export function ensureLoopPinned(segs: RichSegment[]): RichSegment[] {
  const merged = mergeAdjacentTextSegments(segs);
  if (!hasLoopSegment(merged)) {
    return merged;
  }

  const firstLoopIndex = loopChipIndex(merged);
  const agentIndex = merged.findIndex((s) => isAgentModeKind(s.kind));
  const body = merged.filter((s) => s.kind !== "loop" && !isAgentModeKind(s.kind));
  const loopSeg = { kind: "loop" as const };
  const agentSeg = agentIndex >= 0 ? merged[agentIndex] : null;

  const structural: RichSegment[] = [];
  if (agentSeg && firstLoopIndex >= 0) {
    if (agentIndex < firstLoopIndex) {
      structural.push(agentSeg, loopSeg);
    } else {
      structural.push(loopSeg, agentSeg);
    }
  } else if (firstLoopIndex >= 0) {
    structural.push(loopSeg);
  } else if (agentSeg) {
    structural.push(agentSeg);
  }

  return mergeAdjacentTextSegments([...structural, ...body]);
}

/** Match element chip: add a trailing space when nothing follows the chip. */
function tailAfterLoopChip(rest: RichSegment[]): RichSegment[] {
  if (rest.length === 0) {
    return [{ kind: "text", value: " " }];
  }
  const first = rest[0];
  if (first?.kind === "text" && first.value === "") {
    return [{ kind: "text", value: " " }, ...rest.slice(1)];
  }
  return rest;
}

export function insertLoopSegment(segs: RichSegment[]): {
  segments: RichSegment[];
  caret: SegmentCaret;
} {
  const rest = removeLoopSegment(segs);
  const merged = mergeAdjacentTextSegments(rest);
  const insertAt = loopInsertIndex(merged);
  const normalized = mergeAdjacentTextSegments([
    ...merged.slice(0, insertAt),
    { kind: "loop" },
    ...tailAfterLoopChip(merged.slice(insertAt)),
  ]);
  return {
    segments: normalized,
    caret: caretAfterLoopChip(normalized),
  };
}

export function caretAfterLoopChip(segs: RichSegment[]): SegmentCaret {
  const merged = mergeAdjacentTextSegments(segs);
  const loopIndex = loopChipIndex(merged);
  if (loopIndex < 0) {
    return { segmentIndex: 0, offset: 0 };
  }
  const textIndex = merged.findIndex((s, i) => i > loopIndex && s.kind === "text");
  if (textIndex >= 0) {
    const textSeg = merged[textIndex];
    const offset =
      textSeg?.kind === "text" && textSeg.value.startsWith(" ") ? 1 : 0;
    return { segmentIndex: textIndex, offset };
  }
  return { segmentIndex: loopIndex + 1, offset: 0 };
}

/** DOM/selection often reports segment 0 on the chip; snap to the typed position after it. */
export function normalizeCaretForPinnedLoopChip(
  segs: RichSegment[],
  caret: SegmentCaret | null,
): SegmentCaret {
  if (!hasLoopSegment(segs)) {
    return caret ?? { segmentIndex: 0, offset: 0 };
  }
  if (!caret) {
    return caretAfterLoopChip(segs);
  }
  const merged = mergeAdjacentTextSegments(segs);
  const loopIndex = loopChipIndex(merged);
  if (loopIndex < 0) {
    return caret;
  }
  if (caret.segmentIndex <= loopIndex) {
    return caretAfterLoopChip(merged);
  }
  return caret;
}

/** True when caret is immediately after the pinned loop chip (Backspace removes loop). */
export function isCaretAtLoopRemovalPoint(
  segs: RichSegment[],
  caret: SegmentCaret,
): boolean {
  const merged = mergeAdjacentTextSegments(segs);
  const loopIndex = loopChipIndex(merged);
  if (loopIndex < 0) {
    return false;
  }
  return caret.segmentIndex === loopIndex + 1 && caret.offset === 0;
}

export function emptySegmentsWithOptionalLoop(loopEnabled: boolean): RichSegment[] {
  return loopEnabled ? insertLoopSegment(emptySegments()).segments : emptySegments();
}
