export interface CodeCompletionContextSlices {
  prefix: string;
  suffix: string;
  prefixTruncated: boolean;
  suffixTruncated: boolean;
}

const DEFAULT_PREFIX_MAX_LINES = 50;
const DEFAULT_SUFFIX_MAX_LINES = 20;
const DEFAULT_PREFIX_MAX_CHARS = 8_000;
const DEFAULT_SUFFIX_MAX_CHARS = 4_000;

export function buildCodeCompletionContextSlices(input: {
  documentText: string;
  cursorLine: number;
  cursorColumn: number;
  prefixMaxLines?: number;
  suffixMaxLines?: number;
  prefixMaxChars?: number;
  suffixMaxChars?: number;
}): CodeCompletionContextSlices {
  const lines = input.documentText.split('\n');
  const lineIndex = Math.max(0, Math.min(lines.length - 1, input.cursorLine - 1));
  const lineText = lines[lineIndex] ?? '';
  const columnIndex = Math.max(0, Math.min(lineText.length, input.cursorColumn - 1));

  const prefixMaxLines = input.prefixMaxLines ?? DEFAULT_PREFIX_MAX_LINES;
  const suffixMaxLines = input.suffixMaxLines ?? DEFAULT_SUFFIX_MAX_LINES;
  const prefixMaxChars = input.prefixMaxChars ?? DEFAULT_PREFIX_MAX_CHARS;
  const suffixMaxChars = input.suffixMaxChars ?? DEFAULT_SUFFIX_MAX_CHARS;

  const prefixStartLine = Math.max(0, lineIndex - prefixMaxLines + 1);
  const prefixLines = lines.slice(prefixStartLine, lineIndex + 1);
  if (prefixLines.length > 0) {
    const last = prefixLines[prefixLines.length - 1] ?? '';
    prefixLines[prefixLines.length - 1] = last.slice(0, columnIndex);
  }
  let prefix = prefixLines.join('\n');
  let prefixTruncated = prefixStartLine > 0;
  if (prefix.length > prefixMaxChars) {
    prefix = prefix.slice(prefix.length - prefixMaxChars);
    prefixTruncated = true;
  }

  const suffixLines = lines.slice(lineIndex);
  if (suffixLines.length > 0) {
    const first = suffixLines[0] ?? '';
    suffixLines[0] = first.slice(columnIndex);
  }
  const suffixEnd = Math.min(suffixLines.length, suffixMaxLines);
  let suffix = suffixLines.slice(0, suffixEnd).join('\n');
  let suffixTruncated = suffixLines.length > suffixEnd;
  if (suffix.length > suffixMaxChars) {
    suffix = suffix.slice(0, suffixMaxChars);
    suffixTruncated = true;
  }

  return { prefix, suffix, prefixTruncated, suffixTruncated };
}
