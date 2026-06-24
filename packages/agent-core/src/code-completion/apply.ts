import type { CodeCompletionOperation } from './types.js';

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      starts.push(index + 1);
    }
  }
  return starts;
}

function positionToOffset(text: string, line: number, column: number): number {
  const starts = lineStarts(text);
  const lineIndex = line - 1;
  if (lineIndex < 0 || lineIndex >= starts.length) {
    return text.length;
  }
  const lineStart = starts[lineIndex] ?? 0;
  const nextLineStart = starts[lineIndex + 1];
  const lineEnd = nextLineStart === undefined ? text.length : nextLineStart - 1;
  const maxColumn = lineEnd - lineStart + 1;
  const clampedColumn = Math.min(Math.max(column, 1), maxColumn);
  return lineStart + clampedColumn - 1;
}

function operationSortKey(operation: CodeCompletionOperation): number {
  return operation.startLine * 1_000_000 + operation.startColumn;
}

function applySingleOperation(text: string, operation: CodeCompletionOperation): string {
  const start = positionToOffset(text, operation.startLine, operation.startColumn);
  const end = positionToOffset(text, operation.endLine, operation.endColumn);
  const insertText =
    operation.kind === 'delete' ? '' : (operation.text ?? '');
  return text.slice(0, start) + insertText + text.slice(end);
}

export function applyCodeCompletionOperations(
  documentText: string,
  operations: readonly CodeCompletionOperation[],
): string {
  if (operations.length === 0) {
    return documentText;
  }

  const ordered = [...operations].sort((a, b) => operationSortKey(b) - operationSortKey(a));
  let text = documentText;
  for (const operation of ordered) {
    text = applySingleOperation(text, operation);
  }
  return text;
}

export function extractCodeCompletionSpan(
  documentText: string,
  operation: CodeCompletionOperation,
): string {
  const start = positionToOffset(documentText, operation.startLine, operation.startColumn);
  const end = positionToOffset(documentText, operation.endLine, operation.endColumn);
  return documentText.slice(start, end);
}
