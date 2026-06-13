import {
  parseDiff,
} from "react-diff-view";

type ParsedDiffChange = {
  type: "normal" | "insert" | "delete";
  content: string;
};

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

function displayLineNumber(change: ParsedDiffChange & Record<string, unknown>): number {
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
      const line = displayLineNumber(change as ParsedDiffChange & Record<string, unknown>);
      return line >= lineStart && line <= lineEnd;
    });
    if (selectedChanges.length === 0) {
      continue;
    }
    bodyLines.push(hunk.content);
    for (const change of selectedChanges) {
      bodyLines.push(formatUnifiedChangeLine(change as ParsedDiffChange));
    }
  }

  return bodyLines.join("\n");
}
