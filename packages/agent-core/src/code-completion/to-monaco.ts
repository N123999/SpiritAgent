import type { CodeCompletionOperation, CodeCompletionPosition, InlineCompletionItemSpec } from './types.js';

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
  _cursor?: CodeCompletionPosition,
): InlineCompletionItemSpec[] {
  const items: InlineCompletionItemSpec[] = [];
  for (const operation of operations) {
    const item = codeCompletionOperationToInlineItem(operation);
    if (item) {
      items.push(item);
    }
  }
  return items;
}
