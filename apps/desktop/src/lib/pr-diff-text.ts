export function buildPrDiffSnippetText(filename: string, selectedText: string): string {
  const normalizedPath = filename.replace(/\\/gu, "/").trim() || "file";
  const body = selectedText.trim();
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
