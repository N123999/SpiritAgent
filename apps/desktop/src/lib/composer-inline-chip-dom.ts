import type { RichSegment } from "./composer-segment-model";

/** DOM markers for inline attachment chips (element / file / PR diff / terminal). */
export const COMPOSER_INLINE_ATTACHMENT_CHIP_SELECTOR =
  "[data-element-chip='true'],[data-file-chip='true'],[data-pr-diff-chip='true'],[data-terminal-chip='true'],[data-file-snippet-chip='true']";

/** DOM markers for all non-text composer chips (incl. mode / loop / skill). */
export const COMPOSER_INLINE_CHIP_SELECTOR = [
  COMPOSER_INLINE_ATTACHMENT_CHIP_SELECTOR,
  "[data-loop-chip='true']",
  "[data-plan-chip='true']",
  "[data-ask-chip='true']",
  "[data-debug-chip='true']",
  "[data-skill-chip='true']",
].join(",");

export function isComposerInlineChipElement(el: HTMLElement): boolean {
  return (
    el.dataset.elementChip === "true"
    || el.getAttribute("data-element-chip") === "true"
    || el.dataset.fileChip === "true"
    || el.getAttribute("data-file-chip") === "true"
    || el.dataset.prDiffChip === "true"
    || el.getAttribute("data-pr-diff-chip") === "true"
    || el.dataset.terminalChip === "true"
    || el.getAttribute("data-terminal-chip") === "true"
    || el.dataset.fileSnippetChip === "true"
    || el.getAttribute("data-file-snippet-chip") === "true"
    || el.dataset.loopChip === "true"
    || el.getAttribute("data-loop-chip") === "true"
    || el.dataset.planChip === "true"
    || el.getAttribute("data-plan-chip") === "true"
    || el.dataset.askChip === "true"
    || el.getAttribute("data-ask-chip") === "true"
    || el.dataset.debugChip === "true"
    || el.getAttribute("data-debug-chip") === "true"
    || el.dataset.skillChip === "true"
    || el.getAttribute("data-skill-chip") === "true"
  );
}

export function hasInlineAttachmentChipSegments(segs: RichSegment[]): boolean {
  return segs.some(
    (segment) =>
      segment.kind === "element"
      ||       segment.kind === "prDiff"
      || segment.kind === "terminalSnippet"
      || segment.kind === "fileSnippet"
      || segment.kind === "workspaceFile",
  );
}
