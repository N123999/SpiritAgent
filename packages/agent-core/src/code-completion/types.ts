export type CodeCompletionKind = 'insert' | 'replace' | 'delete';

export interface CodeCompletionPosition {
  line: number;
  column: number;
}

export interface CodeCompletionOperation {
  kind: CodeCompletionKind;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  text?: string;
}

export interface CodeCompletionResult {
  operations: CodeCompletionOperation[];
}

/** Editor-neutral inline completion item for host UI adapters (e.g. Monaco). */
export interface InlineCompletionItemSpec {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  insertText: string;
}

/** Context for mapping a completion operation to an inline ghost item at the cursor. */
export interface InlineCompletionMapContext {
  lineText: string;
  cursorLine: number;
  cursorColumn: number;
}

/** Delete-span diff preview for Monaco (red highlight + side preview). */
export interface InlineDeleteDiffPreviewSpec {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  deletedText: string;
  previewText: string;
  anchorLineNumber: number;
}
