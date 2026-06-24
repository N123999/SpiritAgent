import { normalizeWorkspaceEntryRel } from '@/lib/workspace-entry-path-sync';
import type { WorkspaceContentSearchMatch } from '@/types';

export type WorkspaceFileSearchGroup = {
  relativePath: string;
  matches: WorkspaceContentSearchMatch[];
};

export function groupWorkspaceSearchMatches(
  matches: readonly WorkspaceContentSearchMatch[],
): WorkspaceFileSearchGroup[] {
  const byPath = new Map<string, WorkspaceContentSearchMatch[]>();
  for (const match of matches) {
    const key = normalizeWorkspaceEntryRel(match.relativePath);
    const bucket = byPath.get(key);
    if (bucket) {
      bucket.push(match);
    } else {
      byPath.set(key, [match]);
    }
  }
  return [...byPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, fileMatches]) => ({
      relativePath,
      matches: fileMatches.sort((a, b) => a.lineNumber - b.lineNumber),
    }));
}

export type HighlightSegment = {
  text: string;
  highlighted: boolean;
};

/** rg submatch start/end 为 UTF-8 字节偏移；展示用 lineText 按 code unit 切片。 */
export function buildHighlightedLineSegments(
  lineText: string,
  submatches: readonly { start: number; end: number }[],
): HighlightSegment[] {
  if (submatches.length === 0) {
    return [{ text: lineText, highlighted: false }];
  }

  const sorted = [...submatches].sort((a, b) => a.start - b.start);
  const segments: HighlightSegment[] = [];
  let cursor = 0;

  for (const submatch of sorted) {
    const start = Math.max(cursor, Math.min(lineText.length, submatch.start));
    const end = Math.max(start, Math.min(lineText.length, submatch.end));
    if (start > cursor) {
      segments.push({ text: lineText.slice(cursor, start), highlighted: false });
    }
    if (end > start) {
      segments.push({ text: lineText.slice(start, end), highlighted: true });
    }
    cursor = end;
  }

  if (cursor < lineText.length) {
    segments.push({ text: lineText.slice(cursor), highlighted: false });
  }

  return segments.length > 0 ? segments : [{ text: lineText, highlighted: false }];
}

export function truncateSearchLinePreview(
  lineText: string,
  submatches: readonly { start: number; end: number }[],
  maxLength = 72,
): HighlightSegment[] {
  const segments = buildHighlightedLineSegments(lineText, submatches);
  const full = segments.map((segment) => segment.text).join('');
  if (full.length <= maxLength) {
    return segments;
  }

  const firstHighlight = segments.find((segment) => segment.highlighted);
  const highlightText = firstHighlight?.text ?? '';
  const highlightIndex = highlightText ? full.indexOf(highlightText) : 0;
  const windowStart = Math.max(0, highlightIndex - 20);
  const windowEnd = Math.min(full.length, windowStart + maxLength);
  const sliced = full.slice(windowStart, windowEnd);
  const prefix = windowStart > 0 ? '…' : '';
  const suffix = windowEnd < full.length ? '…' : '';

  const localSubmatches =
    submatches.length > 0
      ? submatches.map((item) => ({
          start: Math.max(0, item.start - windowStart) + prefix.length,
          end: Math.max(0, item.end - windowStart) + prefix.length,
        }))
      : [];

  return buildHighlightedLineSegments(`${prefix}${sliced}${suffix}`, localSubmatches);
}
