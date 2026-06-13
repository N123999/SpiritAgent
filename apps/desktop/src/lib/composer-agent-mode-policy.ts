import type { DesktopAgentMode } from "@/lib/agent-mode";
import type { RichSegment } from "@/lib/composer-segment-model";
import { emptySegments, hasSkillSegment, isComposerPlainEmpty, mergeAdjacentTextSegments, segmentsToPlainText } from "@/lib/composer-segment-model";
import { hasInlineAttachmentChipSegments } from "@/lib/composer-inline-chip-dom";
import { hasLoopSegment } from "@/lib/composer-loop-segments";
import {
  hasAgentModeSegment,
  insertAgentModeSegment,
  isAgentModeChipKind,
  removeAgentModeSegment,
  type AgentModeChipKind,
} from "@/lib/composer-agent-mode-segments";

export type AgentModeChipPolicy = {
  hostMode: DesktopAgentMode;
  dismissed: boolean;
};

export function shouldPinAgentModeChip(policy: AgentModeChipPolicy): boolean {
  return isAgentModeChipKind(policy.hostMode) && !policy.dismissed;
}

/** Sole entry for adding/removing Plan/Ask chips in segment state. */
export function applyAgentModeChipPolicy(
  segs: RichSegment[],
  policy: AgentModeChipPolicy,
): RichSegment[] {
  if (!shouldPinAgentModeChip(policy)) {
    return removeAgentModeSegment(segs);
  }
  const mode = policy.hostMode as AgentModeChipKind;
  if (hasAgentModeSegment(segs) && segs.some((s) => s.kind === mode)) {
    return mergeAdjacentTextSegments(segs);
  }
  return insertAgentModeSegment(segs, mode).segments;
}

export function composerShowsPlaceholder(
  segs: RichSegment[],
  opts: { composing: boolean; attachmentCount: number },
): boolean {
  if (opts.composing || opts.attachmentCount > 0) {
    return false;
  }
  if (
    hasLoopSegment(segs)
    || hasAgentModeSegment(segs)
    || hasSkillSegment(segs)
    || hasInlineAttachmentChipSegments(segs)
  ) {
    return false;
  }
  return isComposerPlainEmpty(segmentsToPlainText(segs));
}

export function buildSegmentsAfterSend(agentMode: DesktopAgentMode): RichSegment[] {
  return applyAgentModeChipPolicy(emptySegments(), {
    hostMode: agentMode,
    dismissed: false,
  });
}

const STRUCTURAL_KINDS = new Set(["loop", "plan", "ask", "debug"]);

/** DOM 只驱动正文/附件；loop/plan/ask 以 shell（segments state）为准。 */
export function synchronizeTextFromDom(shell: RichSegment[], domParsed: RichSegment[]): RichSegment[] {
  const shellStructural = shell.filter((s) => STRUCTURAL_KINDS.has(s.kind));
  const domBody = domParsed.filter((s) => !STRUCTURAL_KINDS.has(s.kind));
  return mergeAdjacentTextSegments([...shellStructural, ...domBody]);
}

export function domParsedMissingRequiredAgentChip(
  shell: RichSegment[],
  domParsed: RichSegment[],
  policy: AgentModeChipPolicy,
): boolean {
  return (
    shouldPinAgentModeChip(policy) &&
    hasAgentModeSegment(shell) &&
    !hasAgentModeSegment(domParsed)
  );
}
