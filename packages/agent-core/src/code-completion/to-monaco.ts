import type {
  CodeCompletionOperation,
  CodeCompletionPosition,
  InlineCompletionItemSpec,
  InlineCompletionMapContext,
} from './types.js';

export type {
  CodeCompletionOperation,
  CodeCompletionPosition,
  InlineCompletionItemSpec,
  InlineCompletionMapContext,
} from './types.js';

const MAX_INLINE_INSERT_CHARS = 500;

/** Normalize and cap inline ghost insert text (may span multiple lines). */
export function sanitizeInlineInsertText(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  return normalized.length > MAX_INLINE_INSERT_CHARS
    ? normalized.slice(0, MAX_INLINE_INSERT_CHARS)
    : normalized;
}

export function inlineInsertContainsNewline(text: string): boolean {
  return sanitizeInlineInsertText(text).includes('\n');
}

/** 1-based column immediately after the last character on the line. */
export function lineEndColumn(lineText: string): number {
  return lineText.length + 1;
}

/** Keep only the suffix not yet typed at the cursor (for insert ghost; may include \\n). */
export function completionSuffixAtCursor(
  lineText: string,
  cursorColumn: number,
  insertText: string,
): string {
  const sanitized = sanitizeInlineInsertText(insertText);
  if (sanitized.length === 0) {
    return '';
  }
  const linePrefix = lineText.slice(0, Math.max(0, cursorColumn - 1));
  if (sanitized.startsWith(linePrefix)) {
    return sanitized.slice(linePrefix.length);
  }
  const maxOverlap = Math.min(linePrefix.length, sanitized.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (linePrefix.endsWith(sanitized.slice(0, overlap))) {
      return sanitized.slice(overlap);
    }
  }
  return sanitized;
}

/** Point insert before non-empty suffix would duplicate text already on the line. */
export function wouldInsertDuplicateAtCursor(
  lineText: string,
  cursorColumn: number,
  insertText: string,
): boolean {
  const sanitized = sanitizeInlineInsertText(insertText);
  if (sanitized.length === 0) {
    return true;
  }
  const after = lineText.slice(Math.max(0, cursorColumn - 1));
  if (after.length === 0) {
    return false;
  }
  const firstLine = sanitized.split('\n', 1)[0] ?? '';
  if (firstLine.length === 0) {
    return false;
  }
  return after === firstLine || after.startsWith(firstLine) || firstLine.endsWith(after);
}

function extractSpanFromLine(lineText: string, startColumn: number, endColumn: number): string {
  return lineText.slice(Math.max(0, startColumn - 1), Math.max(0, endColumn - 1));
}

function buildInsertInlineRange(
  cursorLine: number,
  cursorColumn: number,
  lineText: string,
  insertText: string,
): Pick<InlineCompletionItemSpec, 'startLineNumber' | 'startColumn' | 'endLineNumber' | 'endColumn'> {
  // Monaco: multiline insertText requires the replace range to end at end-of-line.
  if (inlineInsertContainsNewline(insertText)) {
    return {
      startLineNumber: cursorLine,
      startColumn: cursorColumn,
      endLineNumber: cursorLine,
      endColumn: lineEndColumn(lineText),
    };
  }
  return {
    startLineNumber: cursorLine,
    startColumn: cursorColumn,
    endLineNumber: cursorLine,
    endColumn: cursorColumn,
  };
}

/** Cursor inside operation span or at the span's end column (Monaco inline visibility). */
export function isCursorInOperationRange(
  operation: CodeCompletionOperation,
  cursorLine: number,
  cursorColumn: number,
): boolean {
  if (operation.startLine !== operation.endLine || operation.startLine !== cursorLine) {
    return false;
  }
  return cursorColumn >= operation.startColumn && cursorColumn <= operation.endColumn;
}

export function isCodeCompletionInlineGhostRenderable(
  operation: CodeCompletionOperation,
  ctx: InlineCompletionMapContext,
): boolean {
  if (operation.kind === 'insert') {
    const suffix = completionSuffixAtCursor(ctx.lineText, ctx.cursorColumn, operation.text ?? '');
    if (suffix.length === 0) {
      return false;
    }
    return !wouldInsertDuplicateAtCursor(ctx.lineText, ctx.cursorColumn, operation.text ?? '');
  }

  if (operation.kind !== 'replace') {
    return false;
  }

  if (operation.startLine !== operation.endLine) {
    return false;
  }

  if (!isCursorInOperationRange(operation, ctx.cursorLine, ctx.cursorColumn)) {
    return false;
  }

  const lineText =
    operation.startLine === ctx.cursorLine
      ? ctx.lineText
      : '';
  const existing = extractSpanFromLine(lineText, operation.startColumn, operation.endColumn);
  const insertText = sanitizeInlineInsertText(operation.text ?? '');
  if (insertText.length === 0 || inlineInsertContainsNewline(insertText)) {
    return false;
  }
  return insertText.startsWith(existing);
}

export function codeCompletionOperationToInlineItemAtCursor(
  operation: CodeCompletionOperation,
  ctx: InlineCompletionMapContext,
): InlineCompletionItemSpec | undefined {
  if (operation.kind === 'insert') {
    const insertText = completionSuffixAtCursor(ctx.lineText, ctx.cursorColumn, operation.text ?? '');
    if (
      insertText.length === 0 ||
      wouldInsertDuplicateAtCursor(ctx.lineText, ctx.cursorColumn, operation.text ?? '')
    ) {
      return undefined;
    }
    return {
      ...buildInsertInlineRange(ctx.cursorLine, ctx.cursorColumn, ctx.lineText, insertText),
      insertText,
    };
  }

  if (operation.kind === 'replace') {
    if (!isCodeCompletionInlineGhostRenderable(operation, ctx)) {
      return undefined;
    }
    return {
      startLineNumber: operation.startLine,
      startColumn: operation.startColumn,
      endLineNumber: operation.endLine,
      endColumn: operation.endColumn,
      insertText: sanitizeInlineInsertText(operation.text ?? ''),
    };
  }

  return undefined;
}

export function codeCompletionOperationToInlineItem(
  operation: CodeCompletionOperation,
): InlineCompletionItemSpec | undefined {
  if (operation.kind === 'insert') {
    return {
      startLineNumber: operation.startLine,
      startColumn: operation.startColumn,
      endLineNumber: operation.endLine,
      endColumn: operation.endColumn,
      insertText: operation.text ?? '',
    };
  }

  if (operation.kind === 'replace') {
    return {
      startLineNumber: operation.startLine,
      startColumn: operation.startColumn,
      endLineNumber: operation.endLine,
      endColumn: operation.endColumn,
      insertText: operation.text ?? '',
    };
  }

  if (operation.kind === 'delete') {
    return {
      startLineNumber: operation.startLine,
      startColumn: operation.startColumn,
      endLineNumber: operation.endLine,
      endColumn: operation.endColumn,
      insertText: '',
    };
  }

  return undefined;
}

export function codeCompletionToMonacoItems(
  operations: readonly CodeCompletionOperation[],
  cursor?: CodeCompletionPosition,
  lineText?: string,
): InlineCompletionItemSpec[] {
  const items: InlineCompletionItemSpec[] = [];
  for (const operation of operations) {
    const item =
      cursor !== undefined && lineText !== undefined
        ? codeCompletionOperationToInlineItemAtCursor(operation, {
            lineText,
            cursorLine: cursor.line,
            cursorColumn: cursor.column,
          })
        : codeCompletionOperationToInlineItem(operation);
    if (item) {
      items.push(item);
    }
  }
  return items;
}
