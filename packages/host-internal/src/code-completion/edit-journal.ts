import type { CodeCompletionJournalEntry } from './types.js';

const DEFAULT_MAX_CHARS = 6_000;

export interface FormattedRecentEdits {
  text: string;
  truncated: boolean;
}

function normalizePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/');
}

function buildFileDiff(relativePath: string, baselineText: string, currentText: string): string {
  if (baselineText === currentText) {
    return '';
  }

  const path = normalizePath(relativePath);
  const beforeLines = baselineText.split('\n');
  const afterLines = currentText.split('\n');
  const lines: string[] = [`--- ${path}`, `+++ ${path}`];

  const maxLines = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < maxLines; index += 1) {
    const before = beforeLines[index];
    const after = afterLines[index];
    if (before === after) {
      continue;
    }
    if (before !== undefined) {
      lines.push(`-${before}`);
    }
    if (after !== undefined) {
      lines.push(`+${after}`);
    }
  }

  return lines.join('\n');
}

export class CodeCompletionEditJournal {
  private readonly entries = new Map<string, CodeCompletionJournalEntry>();

  recordFileState(entry: CodeCompletionJournalEntry): void {
    const key = normalizePath(entry.relativePath);
    if (entry.baselineText === entry.currentText) {
      this.entries.delete(key);
      return;
    }
    this.entries.set(key, {
      relativePath: key,
      baselineText: entry.baselineText,
      currentText: entry.currentText,
    });
  }

  removeFile(relativePath: string): void {
    this.entries.delete(normalizePath(relativePath));
  }

  clear(): void {
    this.entries.clear();
  }

  listEntries(): CodeCompletionJournalEntry[] {
    return [...this.entries.values()];
  }

  formatRecentEdits(maxChars: number = DEFAULT_MAX_CHARS): FormattedRecentEdits {
    const chunks = [...this.entries.values()]
      .map((entry) => buildFileDiff(entry.relativePath, entry.baselineText, entry.currentText))
      .filter((chunk) => chunk.length > 0);

    if (chunks.length === 0) {
      return { text: '(none)', truncated: false };
    }

    let text = chunks.join('\n\n');
    if (text.length <= maxChars) {
      return { text, truncated: false };
    }

    text = `${text.slice(0, maxChars)}\n...(truncated)`;
    return { text, truncated: true };
  }
}
