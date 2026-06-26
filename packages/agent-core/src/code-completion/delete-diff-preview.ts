import { applyCodeCompletionOperations, extractCodeCompletionSpan } from './apply.js';
import { isCursorInOperationRange } from './to-monaco.js';
import type { CodeCompletionOperation, InlineDeleteDiffPreviewSpec } from './types.js';

export type {
  InlineDeleteDiffPreviewSpec,
} from './types.js';

export type DeleteDiffPreviewMapContext = {
  documentText: string;
  cursorLine: number;
  cursorColumn: number;
};

/** Cursor inside operation span (single- or multi-line). */
export function isCursorInDeleteRange(
  operation: Pick<CodeCompletionOperation, 'startLine' | 'startColumn' | 'endLine' | 'endColumn'>,
  cursorLine: number,
  cursorColumn: number,
): boolean {
  if (operation.startLine === operation.endLine) {
    return isCursorInOperationRange(
      operation as CodeCompletionOperation,
      cursorLine,
      cursorColumn,
    );
  }
  if (cursorLine < operation.startLine || cursorLine > operation.endLine) {
    return false;
  }
  if (cursorLine === operation.startLine) {
    return cursorColumn >= operation.startColumn;
  }
  if (cursorLine === operation.endLine) {
    return cursorColumn <= operation.endColumn;
  }
  return true;
}

export function extractTextInRange(
  documentText: string,
  operation: CodeCompletionOperation,
): string {
  return extractCodeCompletionSpan(documentText, operation);
}

export function buildDeletePreviewText(
  documentText: string,
  operation: CodeCompletionOperation,
): string {
  const nextText = applyCodeCompletionOperations(documentText, [operation]);
  const lines = nextText.split('\n');
  const startIndex = Math.max(0, operation.startLine - 1);
  const endIndex = Math.min(lines.length - 1, operation.endLine - 1);
  if (startIndex > endIndex || endIndex < 0) {
    return '';
  }
  return lines.slice(startIndex, endIndex + 1).join('\n');
}

export function codeCompletionOperationToDeleteDiffPreviewAtCursor(
  operation: CodeCompletionOperation,
  ctx: DeleteDiffPreviewMapContext,
): InlineDeleteDiffPreviewSpec | undefined {
  if (operation.kind !== 'delete') {
    return undefined;
  }

  if (!isCursorInDeleteRange(operation, ctx.cursorLine, ctx.cursorColumn)) {
    return undefined;
  }

  const deletedText = extractTextInRange(ctx.documentText, operation);
  if (deletedText.length === 0) {
    return undefined;
  }

  const previewText = buildDeletePreviewText(ctx.documentText, operation);

  return {
    startLineNumber: operation.startLine,
    startColumn: operation.startColumn,
    endLineNumber: operation.endLine,
    endColumn: operation.endColumn,
    deletedText,
    previewText,
    anchorLineNumber: operation.startLine,
  };
}
