import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDiagnosticsForLlm, formatDiagnosticsSummaryBlock, buildLspWriteDiagnosticsUi } from './format-diagnostics.js';
import type { LspDiagnostic } from './types.js';

const sample: LspDiagnostic[] = [
  {
    severity: 2,
    message: 'Unused variable',
    range: { start: { line: 4, character: 2 }, end: { line: 4, character: 5 } },
    source: 'eslint',
  },
  {
    severity: 1,
    message: 'Type mismatch',
    range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
    source: 'ts',
    code: 2322,
  },
  {
    severity: 4,
    message: 'Could shorten import',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  },
];

test('formatDiagnosticsForLlm sorts errors before warnings and omits hints by default', () => {
  const text = formatDiagnosticsForLlm('src/a.ts', sample);
  assert.match(text, /error src\/a\.ts:2:1/);
  assert.match(text, /warning src\/a\.ts:5:3/);
  assert.doesNotMatch(text, /hint/);
});

test('formatDiagnosticsSummaryBlock returns undefined when only clean', () => {
  assert.equal(
    formatDiagnosticsSummaryBlock('src/a.ts', []),
    undefined,
  );
});

test('formatDiagnosticsSummaryBlock wraps non-empty output', () => {
  const block = formatDiagnosticsSummaryBlock('src/a.ts', sample);
  assert.ok(block?.startsWith('\n\n[lsp]\n'));
});

test('buildLspWriteDiagnosticsUi maps severity and 1-based positions', () => {
  const ui = buildLspWriteDiagnosticsUi('src/a.ts', sample);
  assert.ok(ui);
  assert.equal(ui?.relativePath, 'src/a.ts');
  assert.equal(ui?.items.length, 2);
  assert.equal(ui?.items[0]?.severity, 'error');
  assert.equal(ui?.items[0]?.line, 2);
  assert.equal(ui?.items[0]?.column, 1);
  assert.equal(ui?.items[1]?.severity, 'warning');
  assert.equal(ui?.items[1]?.line, 5);
});
