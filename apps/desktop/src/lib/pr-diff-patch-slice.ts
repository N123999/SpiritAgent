import {
  parseDiff,
} from "react-diff-view";

import type { PrDiffLineRange } from "./pr-diff-selection.js";

type ParsedDiffChange = {
  type: "normal" | "insert" | "delete";
  content: string;
};

type DiffChangeLike = ParsedDiffChange & { lineNumber?: number; newLineNumber?: number };

function asDiffChangeLike(change: unknown): DiffChangeLike {
  return change as DiffChangeLike;
}

function normalizeDiffPath(filename: string): string {
  return filename.replace(/\\/gu, "/").trim() || "file";
}

function wrapPatchAsUnifiedDiff(filename: string, patch: string): string {
  const normalizedPath = normalizeDiffPath(filename);
  const hunk = patch.trim();
  if (!hunk) {
    return "";
  }
  return [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    `--- a/${normalizedPath}`,
    `+++ b/${normalizedPath}`,
    hunk,
  ].join("\n");
}

function displayLineNumber(change: DiffChangeLike): number {
  if (change.type === "delete") {
    return typeof change.lineNumber === "number" ? change.lineNumber : -1;
  }
  if (change.type === "insert") {
    return typeof change.lineNumber === "number" ? change.lineNumber : -1;
  }
  return typeof change.newLineNumber === "number" ? change.newLineNumber : -1;
}

function formatUnifiedChangeLine(change: ParsedDiffChange): string {
  if (change.type === "insert") {
    return `+${change.content}`;
  }
  if (change.type === "delete") {
    return `-${change.content}`;
  }
  return ` ${change.content}`;
}

/** Slice GitHub file patch hunks to the gutter line range shown in PR Changes diff view. */
export function extractPatchBodyForLineRange(
  filename: string,
  patch: string,
  lineStart: number,
  lineEnd: number,
): string {
  if (lineStart <= 0 || lineEnd <= 0 || lineStart > lineEnd) {
    return "";
  }

  const diffText = wrapPatchAsUnifiedDiff(filename, patch);
  if (!diffText) {
    return "";
  }

  let hunks;
  try {
    hunks = parseDiff(diffText, { nearbySequences: "zip" })[0]?.hunks ?? [];
  } catch {
    return "";
  }

  const bodyLines: string[] = [];
  for (const hunk of hunks) {
    const selectedChanges = hunk.changes.filter((change) => {
      const line = displayLineNumber(asDiffChangeLike(change));
      return line >= lineStart && line <= lineEnd;
    });
    if (selectedChanges.length === 0) {
      continue;
    }
    bodyLines.push(hunk.content);
    for (const change of selectedChanges) {
      bodyLines.push(formatUnifiedChangeLine(asDiffChangeLike(change)));
    }
  }

  return bodyLines.join("\n");
}

/** Infer gutter line range by matching selected plain text against patch change lines. */
export function inferLineRangeFromPatch(
  filename: string,
  patch: string,
  selectedText: string,
): PrDiffLineRange | null {
  const needle = selectedText.trim();
  if (!needle) {
    return null;
  }

  const diffText = wrapPatchAsUnifiedDiff(filename, patch);
  if (!diffText) {
    return null;
  }

  let hunks;
  try {
    hunks = parseDiff(diffText, { nearbySequences: "zip" })[0]?.hunks ?? [];
  } catch {
    return null;
  }

  const matchedLines: number[] = [];
  const selectedLines = needle.split("\n");
  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      const content = asDiffChangeLike(change).content;
      if (selectedLines.some((line) => line === content || line.trim() === content.trim())) {
        matchedLines.push(displayLineNumber(asDiffChangeLike(change)));
      }
    }
  }

  const valid = matchedLines.filter((line) => line > 0);
  if (valid.length === 0) {
    return null;
  }
  return {
    lineStart: Math.min(...valid),
    lineEnd: Math.max(...valid),
  };
}
