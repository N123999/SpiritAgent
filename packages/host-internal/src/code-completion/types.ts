import type { CodeCompletionResult } from '@spirit-agent/core';

import type { FormattedRecentEdits } from './edit-journal.js';

export interface CodeCompletionRelatedSnippet {
  relativePath: string;
  content: string;
}

export interface CodeCompletionRequestContext {
  workspaceRoot: string;
  relativePath: string;
  languageId: string;
  documentText: string;
  cursorLine: number;
  cursorColumn: number;
  relatedSnippets?: CodeCompletionRelatedSnippet[];
  signal?: AbortSignal;
}

export interface CodeCompletionJournalEntry {
  relativePath: string;
  baselineText: string;
  currentText: string;
}

export interface CodeCompletionSource {
  suggest(
    context: CodeCompletionRequestContext,
    recentEdits: FormattedRecentEdits,
  ): Promise<CodeCompletionResult | null>;
}
