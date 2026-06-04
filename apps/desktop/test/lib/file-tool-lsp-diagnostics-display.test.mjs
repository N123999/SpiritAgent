import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatLspDiagnosticsSummaryLabel,
  lspDiagnosticsCounts,
  shouldShowLspDiagnosticsOnToolCard,
} from '../../src/lib/file-tool-lsp-diagnostics-display.ts';

test('lspDiagnosticsCounts tallies errors and warnings', () => {
  const counts = lspDiagnosticsCounts({
    relativePath: 'src/a.ts',
    items: [
      { severity: 'error', line: 1, column: 1, message: 'e1' },
      { severity: 'error', line: 2, column: 1, message: 'e2' },
      { severity: 'warning', line: 3, column: 1, message: 'w1' },
    ],
  });
  assert.deepEqual(counts, { errorCount: 2, warningCount: 1 });
});

test('formatLspDiagnosticsSummaryLabel joins with comma', () => {
  const label = formatLspDiagnosticsSummaryLabel(2, 1, (key, options) => {
    if (key === 'tool.lspErrorCount') {
      return `${options?.count} errors`;
    }
    if (key === 'tool.lspWarningCount') {
      return `${options?.count} warning`;
    }
    return key;
  });
  assert.equal(label, '2 errors, 1 warning');
});

test('shouldShowLspDiagnosticsOnToolCard requires succeeded phase', () => {
  const tool = {
    phase: 'running',
    lspWriteDiagnostics: {
      relativePath: 'src/a.ts',
      items: [{ severity: 'error', line: 1, column: 1, message: 'e' }],
    },
  };
  assert.equal(shouldShowLspDiagnosticsOnToolCard(tool), false);
});
