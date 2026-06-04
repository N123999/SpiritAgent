import assert from 'node:assert/strict';
import test from 'node:test';

import { createToolExecutionTextOutput } from '../ports.js';
import { DEFAULT_LSP_TIMING } from './config.js';
import { appendLspDiagnosticsAfterWriteIfNeeded } from './write-append.js';
import type { LspService } from './service.js';

test('appendLspDiagnosticsAfterWriteIfNeeded leaves non-write tools unchanged', async () => {
  const output = createToolExecutionTextOutput('ok');
  const result = await appendLspDiagnosticsAfterWriteIfNeeded(undefined, { name: 'read_file', path: 'a.ts' }, output);
  assert.equal(result.summaryText, 'ok');
});

test('appendLspDiagnosticsAfterWriteIfNeeded attaches hostUi for write tools', async () => {
  const lsp = {
    enabled: true,
    workspaceRoot: 'D:\\SpiritAgent',
    getDiagnosticsForPath: async () => ({
      relativePath: 'packages/agent-core/src/a.ts',
      diagnostics: [
        {
          severity: 1,
          message: 'Type mismatch',
          range: { start: { line: 0, character: 4 }, end: { line: 0, character: 8 } },
          source: 'ts',
          code: 2322,
        },
        {
          severity: 2,
          message: 'Unused',
          range: { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } },
        },
      ],
      formatted: 'ignored',
    }),
  } satisfies Pick<LspService, 'enabled' | 'workspaceRoot' | 'getDiagnosticsForPath'>;

  const output = createToolExecutionTextOutput('[write]\naction: edit_file');
  const result = await appendLspDiagnosticsAfterWriteIfNeeded(
    lsp as unknown as LspService,
    { name: 'edit_file', path: 'packages/agent-core/src/a.ts' },
    output,
  );

  assert.match(result.summaryText, /\[lsp\]/);
  assert.equal(result.hostUi?.lspWriteDiagnostics?.relativePath, 'packages/agent-core/src/a.ts');
  assert.equal(result.hostUi?.lspWriteDiagnostics?.items.length, 2);
  assert.equal(result.hostUi?.lspWriteDiagnostics?.items[0]?.severity, 'error');
  assert.equal(result.hostUi?.lspWriteDiagnostics?.items[0]?.line, 1);
});

test('appendLspDiagnosticsAfterWriteIfNeeded waits with writeAppendDiagnosticsWaitMs', async () => {
  let waitMs: number | undefined;
  const lsp = {
    enabled: true,
    workspaceRoot: 'D:\\SpiritAgent',
    getDiagnosticsForPath: async (_path: string, timeoutMs?: number) => {
      waitMs = timeoutMs;
      return {
        relativePath: 'packages/agent-core/src/a.ts',
        diagnostics: [],
        formatted: '',
      };
    },
  } satisfies Pick<LspService, 'enabled' | 'workspaceRoot' | 'getDiagnosticsForPath'>;

  await appendLspDiagnosticsAfterWriteIfNeeded(
    lsp as unknown as LspService,
    { name: 'edit_file', path: 'packages/agent-core/src/a.ts' },
    createToolExecutionTextOutput('ok'),
  );

  assert.equal(waitMs, DEFAULT_LSP_TIMING.writeAppendDiagnosticsWaitMs);
});
