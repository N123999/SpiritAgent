import type { DesktopAgentMode } from "@/lib/agent-mode";
import type { RichSegment, SegmentCaret } from "./composer-segment-model";
import { emptySegments, mergeAdjacentTextSegments } from "./composer-segment-model";
import { hasLoopSegment, removeLoopSegment } from "./composer-loop-segments";

export type AgentModeChipKind = "plan" | "ask";

export function isAgentModeChipKind(mode: DesktopAgentMode): mode is AgentModeChipKind {
  return mode === "plan" || mode === "ask";
}

export function hasAgentModeSegment(segs: RichSegment[]): boolean {
  return segs.some((s) => s.kind === "plan" || s.kind === "ask");
}

export function currentAgentModeSegment(segs: RichSegment[]): AgentModeChipKind | undefined {
  const found = segs.find((s) => s.kind === "plan" || s.kind === "ask");
  if (found?.kind === "plan" || found?.kind === "ask") {
    return found.kind;
  }
  return undefined;
}

export function removeAgentModeSegment(segs: RichSegment[]): RichSegment[] {
  return mergeAdjacentTextSegments(segs.filter((s) => s.kind !== "plan" && s.kind !== "ask"));
}

function tailAfterModeChip(rest: RichSegment[]): RichSegment[] {
  if (rest.length === 0) {
    return [{ kind: "text", value: " " }];
  }
  const first = rest[0];
  if (first?.kind === "text" && first.value === "") {
    return [{ kind: "text", value: " " }, ...rest.slice(1)];
  }
  return rest;
}

function agentModeChipIndex(segs: RichSegment[]): number {
  return segs.findIndex((s) => s.kind === "plan" || s.kind === "ask");
}

/** Caret in the trailing text segment after a pinned Plan/Ask chip (never on the chip segment). */
export function caretAfterAgentModeChip(segs: RichSegment[]): SegmentCaret {
  const merged = mergeAdjacentTextSegments(segs);
  const modeIndex = agentModeChipIndex(merged);
  if (modeIndex < 0) {
    return { segmentIndex: 0, offset: 0 };
  }
  const textIndex = merged.findIndex((s, i) => i > modeIndex && s.kind === "text");
  if (textIndex >= 0) {
    const textSeg = merged[textIndex];
    const offset =
      textSeg?.kind === "text" && textSeg.value.startsWith(" ") ? 1 : 0;
    return { segmentIndex: textIndex, offset };
  }
  return { segmentIndex: modeIndex + 1, offset: 0 };
}

export function insertAgentModeSegment(
  segs: RichSegment[],
  mode: AgentModeChipKind,
): { segments: RichSegment[]; caret: SegmentCaret } {
  const loopPart = hasLoopSegment(segs) ? [{ kind: "loop" as const }] : [];
  const rest = removeAgentModeSegment(removeLoopSegment(segs));
  const normalized = mergeAdjacentTextSegments([
    ...loopPart,
    { kind: mode },
    ...tailAfterModeChip(rest),
  ]);
  return {
    segments: normalized,
    caret: caretAfterAgentModeChip(normalized),
  };
}

/** DOM/selection often reports segment 0 before the chip; snap to the typed position after it. */
export function normalizeCaretForPinnedAgentModeChip(
  segs: RichSegment[],
  caret: SegmentCaret | null,
): SegmentCaret {
  if (!hasAgentModeSegment(segs)) {
    return caret ?? { segmentIndex: 0, offset: 0 };
  }
  if (!caret) {
    return caretAfterAgentModeChip(segs);
  }
  const merged = mergeAdjacentTextSegments(segs);
  const modeIndex = agentModeChipIndex(merged);
  if (modeIndex < 0) {
    return caret;
  }
  if (caret.segmentIndex <= modeIndex) {
    return caretAfterAgentModeChip(merged);
  }
  return caret;
}

export function ensureAgentModePinned(
  segs: RichSegment[],
  agentMode: DesktopAgentMode,
): RichSegment[] {
  if (!isAgentModeChipKind(agentMode)) {
    return removeAgentModeSegment(segs);
  }

  const current = currentAgentModeSegment(segs);
  if (current === agentMode && hasAgentModeSegment(segs)) {
    const modeIndex = agentModeChipIndex(segs);
    const loopIndex = segs.findIndex((s) => s.kind === "loop");
    if (loopIndex >= 0 && modeIndex >= 0 && modeIndex < loopIndex) {
      return insertAgentModeSegment(segs, agentMode).segments;
    }
    if (loopIndex < 0 || modeIndex === loopIndex + 1) {
      return mergeAdjacentTextSegments(segs);
    }
    return insertAgentModeSegment(segs, agentMode).segments;
  }

  return insertAgentModeSegment(segs, agentMode).segments;
}

/** True when caret is immediately after the pinned agent-mode chip (Backspace removes it). */
export function isCaretAtAgentModeRemovalPoint(
  segs: RichSegment[],
  caret: SegmentCaret,
): boolean {
  const merged = mergeAdjacentTextSegments(segs);
  const modeIndex = agentModeChipIndex(merged);
  if (modeIndex < 0) {
    return false;
  }
  const at = merged[caret.segmentIndex];
  if (at?.kind === "text") {
    return caret.segmentIndex === modeIndex + 1 && caret.offset === 0;
  }
  return caret.segmentIndex === modeIndex + 1 && caret.offset === 0;
}

export function emptySegmentsWithOptionalAgentMode(agentMode: DesktopAgentMode): RichSegment[] {
  return isAgentModeChipKind(agentMode)
    ? insertAgentModeSegment(emptySegments(), agentMode).segments
    : emptySegments();
}
