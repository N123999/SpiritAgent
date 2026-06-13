import { extractPatchBodyForLineRange } from "@/lib/pr-diff-patch-slice";

function normalizeDiffPath(filename: string): string {
  return filename.replace(/\\/gu, "/").trim() || "file";
}

type BuildPrDiffSnippetOptions = {
  /** Body is already unified diff hunk lines (with +/- prefixes). */
  fromPatchBody?: boolean;
};

export function buildPrDiffSnippetText(
  filename: string,
  selectedText: string,
  options?: BuildPrDiffSnippetOptions,
): string {
  const normalizedPath = normalizeDiffPath(filename);
  const body = options?.fromPatchBody
    ? selectedText
    : /^\s*$/u.test(selectedText)
      ? ""
      : selectedText;
  if (!body) {
    return "";
  }
  return [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    `--- a/${normalizedPath}`,
    `+++ b/${normalizedPath}`,
    body,
  ].join("\n");
}

export function buildPrDiffSnippetFromPatch(
  filename: string,
  patch: string,
  lineStart: number,
  lineEnd: number,
): string {
  const body = extractPatchBodyForLineRange(filename, patch, lineStart, lineEnd);
  if (!body) {
    return "";
  }
  return buildPrDiffSnippetText(filename, body, { fromPatchBody: true });
}
