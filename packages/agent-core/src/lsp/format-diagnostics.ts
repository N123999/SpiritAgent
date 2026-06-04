import {
  DEFAULT_DIAGNOSTICS_MAX_ITEMS,
  DEFAULT_DIAGNOSTICS_MESSAGE_MAX_CHARS,
} from './constants.js';
import type { LspDiagnostic, LspDiagnosticSeverity, LspWriteDiagnosticsUi } from './types.js';

export interface FormatDiagnosticsOptions {
  maxItems?: number;
  messageMaxChars?: number;
  includeHints?: boolean;
}

const SEVERITY_LABEL: Record<LspDiagnosticSeverity, string> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'hint',
};

const SEVERITY_RANK: Record<LspDiagnosticSeverity, number> = {
  1: 0,
  2: 1,
  3: 2,
  4: 3,
};

export function formatDiagnosticsForLlm(
  relativePath: string,
  diagnostics: LspDiagnostic[],
  options: FormatDiagnosticsOptions = {},
): string {
  const maxItems = options.maxItems ?? DEFAULT_DIAGNOSTICS_MAX_ITEMS;
  const messageMaxChars = options.messageMaxChars ?? DEFAULT_DIAGNOSTICS_MESSAGE_MAX_CHARS;
  const filtered = sortDiagnostics(diagnostics).filter((item) => {
    if (options.includeHints === true) {
      return true;
    }
    const severity = item.severity ?? 1;
    return severity === 1 || severity === 2;
  });

  if (filtered.length === 0) {
    return `No errors or warnings reported for ${relativePath}.`;
  }

  const lines = filtered.slice(0, maxItems).map((item) => formatDiagnosticLine(relativePath, item, messageMaxChars));
  const omitted = filtered.length > maxItems ? filtered.length - maxItems : 0;
  const header = `Diagnostics for ${relativePath} (${Math.min(filtered.length, maxItems)} shown${omitted > 0 ? `, ${omitted} more omitted` : ''}):`;
  return [header, ...lines].join('\n');
}

export function formatDiagnosticsSummaryBlock(
  relativePath: string,
  diagnostics: LspDiagnostic[],
  options: FormatDiagnosticsOptions = {},
): string | undefined {
  const body = formatDiagnosticsForLlm(relativePath, diagnostics, options).trim();
  if (!body || body.startsWith('No errors or warnings')) {
    return undefined;
  }
  return `\n\n[lsp]\n${body}`;
}

export function buildLspWriteDiagnosticsUi(
  relativePath: string,
  diagnostics: LspDiagnostic[],
): LspWriteDiagnosticsUi | undefined {
  const items = sortDiagnostics(diagnostics)
    .filter((item) => {
      const severity = item.severity ?? 1;
      return severity === 1 || severity === 2;
    })
    .map((item) => {
      const severity = (item.severity ?? 1) === 2 ? 'warning' : 'error';
      return {
        severity: severity as 'error' | 'warning',
        line: item.range.start.line + 1,
        column: item.range.start.character + 1,
        message: item.message.replace(/\s+/g, ' ').trim(),
        ...(item.code !== undefined ? { code: item.code } : {}),
        ...(item.source ? { source: item.source } : {}),
      };
    });
  if (items.length === 0) {
    return undefined;
  }
  return { relativePath, items };
}

function sortDiagnostics(diagnostics: LspDiagnostic[]): LspDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const leftRank = SEVERITY_RANK[(left.severity ?? 1) as LspDiagnosticSeverity];
    const rightRank = SEVERITY_RANK[(right.severity ?? 1) as LspDiagnosticSeverity];
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    if (left.range.start.line !== right.range.start.line) {
      return left.range.start.line - right.range.start.line;
    }
    return left.range.start.character - right.range.start.character;
  });
}

function formatDiagnosticLine(
  relativePath: string,
  diagnostic: LspDiagnostic,
  messageMaxChars: number,
): string {
  const severity = SEVERITY_LABEL[(diagnostic.severity ?? 1) as LspDiagnosticSeverity];
  const line = diagnostic.range.start.line + 1;
  const column = diagnostic.range.start.character + 1;
  const source = diagnostic.source ? ` (${diagnostic.source})` : '';
  const code =
    diagnostic.code === undefined
      ? ''
      : ` [${typeof diagnostic.code === 'string' ? diagnostic.code : String(diagnostic.code)}]`;
  const message = truncate(diagnostic.message, messageMaxChars);
  return `${severity} ${relativePath}:${line}:${column}${source}${code}: ${message}`;
}

function truncate(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 1)}…`;
}
