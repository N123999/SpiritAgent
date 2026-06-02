import type { ToolBlockSnapshot } from '../types.js';

export type EditFileLineDelta = {
  added: number;
  removed: number;
};

const TOOLS_WITH_LINE_DELTA = new Set(['edit_file', 'create_file', 'create_plan']);

function splitLines(text: string): string[] {
  if (!text) {
    return [];
  }
  return text.split(/\r?\n/u);
}

/** Line-level insert/delete counts via LCS length (git-style stat, not char diff). */
export function lineChangeCounts(oldText: string, newText: string): EditFileLineDelta {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const lcs = longestCommonSubsequenceLength(oldLines, newLines);
  return {
    removed: oldLines.length - lcs,
    added: newLines.length - lcs,
  };
}

function longestCommonSubsequenceLength(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  const rows = b.length + 1;
  let prev = new Uint32Array(rows);
  let curr = new Uint32Array(rows);

  for (let i = 1; i <= a.length; i += 1) {
    const aLine = a[i - 1]!;
    for (let j = 1; j <= b.length; j += 1) {
      if (aLine === b[j - 1]) {
        curr[j] = (prev[j - 1] ?? 0) + 1;
      } else {
        curr[j] = Math.max(prev[j] ?? 0, curr[j - 1] ?? 0);
      }
    }
    const swap = prev;
    prev = curr;
    curr = swap;
    curr.fill(0);
  }

  return prev[b.length] ?? 0;
}

function appendDecodedEscape(result: string, esc: string): string {
  switch (esc) {
    case 'n':
      return `${result}\n`;
    case 'r':
      return `${result}\r`;
    case 't':
      return `${result}\t`;
    case '"':
      return `${result}"`;
    case '\\':
      return `${result}\\`;
    case '/':
      return `${result}/`;
    case 'b':
      return `${result}\b`;
    case 'f':
      return `${result}\f`;
    default:
      return `${result}${esc}`;
  }
}

/** Read a JSON string field from complete or in-flight tool argument JSON. */
export function tryExtractPartialJsonStringValue(
  argumentsJson: string,
  key: string,
): string | undefined {
  const marker = `"${key}"`;
  const keyIdx = argumentsJson.indexOf(marker);
  if (keyIdx < 0) {
    return undefined;
  }

  let i = keyIdx + marker.length;
  while (i < argumentsJson.length && /\s/u.test(argumentsJson[i]!)) {
    i += 1;
  }
  if (argumentsJson[i] !== ':') {
    return undefined;
  }
  i += 1;
  while (i < argumentsJson.length && /\s/u.test(argumentsJson[i]!)) {
    i += 1;
  }
  if (argumentsJson[i] !== '"') {
    return undefined;
  }
  i += 1;

  let result = '';
  while (i < argumentsJson.length) {
    const ch = argumentsJson[i]!;
    if (ch === '"') {
      return result;
    }
    if (ch === '\\') {
      i += 1;
      if (i >= argumentsJson.length) {
        break;
      }
      const esc = argumentsJson[i]!;
      if (esc === 'u') {
        const hex = argumentsJson.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/u.test(hex)) {
          result += String.fromCodePoint(Number.parseInt(hex, 16));
          i += 5;
          continue;
        }
        result = appendDecodedEscape(result, esc);
        i += 1;
        continue;
      }
      result = appendDecodedEscape(result, esc);
      i += 1;
      continue;
    }
    result += ch;
    i += 1;
  }

  return result.length > 0 ? result : undefined;
}

function createContentLineDelta(content: string): EditFileLineDelta | undefined {
  const added = splitLines(content).length;
  if (added === 0) {
    return undefined;
  }
  return { added, removed: 0 };
}

export function toolLineDeltaFromRequest(
  toolName: string,
  request: unknown,
): EditFileLineDelta | undefined {
  if (!TOOLS_WITH_LINE_DELTA.has(toolName) || !request || typeof request !== 'object') {
    return undefined;
  }

  const record = request as Record<string, unknown>;

  if (toolName === 'create_file' || toolName === 'create_plan') {
    const content = typeof record.content === 'string' ? record.content : '';
    return createContentLineDelta(content);
  }

  const oldText = typeof record.old_text === 'string' ? record.old_text : '';
  const newText = typeof record.new_text === 'string' ? record.new_text : '';
  if (!oldText && !newText) {
    return undefined;
  }

  const delta = lineChangeCounts(oldText, newText);
  if (delta.added === 0 && delta.removed === 0) {
    return undefined;
  }
  return delta;
}

/** @deprecated Use {@link toolLineDeltaFromRequest} with `edit_file`. */
export function editFileLineDeltaFromRequest(request: unknown): EditFileLineDelta | undefined {
  return toolLineDeltaFromRequest('edit_file', request);
}

export function toolLineDeltaFromArgumentsJson(
  toolName: string,
  argumentsJson: string,
): EditFileLineDelta | undefined {
  const trimmed = argumentsJson.trim();
  if (!trimmed || !TOOLS_WITH_LINE_DELTA.has(toolName)) {
    return undefined;
  }

  try {
    return toolLineDeltaFromRequest(toolName, JSON.parse(trimmed) as unknown);
  } catch {
    if (toolName === 'create_file' || toolName === 'create_plan') {
      const content = tryExtractPartialJsonStringValue(trimmed, 'content');
      return content !== undefined ? createContentLineDelta(content) : undefined;
    }

    const oldText = tryExtractPartialJsonStringValue(trimmed, 'old_text');
    const newText = tryExtractPartialJsonStringValue(trimmed, 'new_text');
    if (oldText === undefined && newText === undefined) {
      return undefined;
    }
    const delta = lineChangeCounts(oldText ?? '', newText ?? '');
    if (delta.added === 0 && delta.removed === 0) {
      return undefined;
    }
    return delta;
  }
}

/** @deprecated Use {@link toolLineDeltaFromArgumentsJson} with `edit_file`. */
export function editFileLineDeltaFromArgumentsJson(
  argumentsJson: string,
): EditFileLineDelta | undefined {
  return toolLineDeltaFromArgumentsJson('edit_file', argumentsJson);
}

export function resolveToolLineDelta(tool: ToolBlockSnapshot): EditFileLineDelta | undefined {
  if (!TOOLS_WITH_LINE_DELTA.has(tool.toolName)) {
    return undefined;
  }
  if (tool.editLineDelta) {
    return tool.editLineDelta;
  }
  if (tool.argsExcerpt?.trim()) {
    return toolLineDeltaFromArgumentsJson(tool.toolName, tool.argsExcerpt);
  }
  return undefined;
}

/** @deprecated Use {@link resolveToolLineDelta}. */
export function resolveEditFileLineDelta(tool: ToolBlockSnapshot): EditFileLineDelta | undefined {
  return resolveToolLineDelta(tool);
}

export function attachEditFileLineDelta(
  tool: ToolBlockSnapshot,
  source: { request?: unknown; argumentsJson?: string },
): ToolBlockSnapshot {
  if (!TOOLS_WITH_LINE_DELTA.has(tool.toolName)) {
    return tool;
  }

  const delta =
    source.argumentsJson !== undefined
      ? toolLineDeltaFromArgumentsJson(tool.toolName, source.argumentsJson)
      : toolLineDeltaFromRequest(tool.toolName, source.request);

  if (!delta) {
    const { editLineDelta: _removed, ...rest } = tool;
    return rest;
  }

  return { ...tool, editLineDelta: delta };
}
