import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { LspService } from './service.js';
import { resolveTypescriptLanguageServerOnPath } from './resolve-server.js';

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

test(
  'getDiagnosticsForPath reports a type error after document sync',
  { skip: !(await resolveTypescriptLanguageServerOnPath()) },
  async () => {
    const relativePath = 'packages/agent-core/src/lsp/.diag-integration-temp.ts';
    const absolutePath = path.join(workspaceRoot, relativePath);
    await writeFile(absolutePath, 'export const broken: number = "not-a-number";\n', 'utf8');

    const lsp = new LspService(workspaceRoot);
    await lsp.probe();
    assert.equal(lsp.enabled, true);

    try {
      const first = await lsp.getDiagnosticsForPath(relativePath, 12_000);
      assert.ok(
        first.diagnostics.some((item) => (item.severity ?? 1) === 1),
        `expected at least one error diagnostic; formatted=${first.formatted}`,
      );
      assert.match(first.formatted, /error/i);

      // 第二次调用须重新等待，不得命中「文件尚干净」时的空缓存。
      await writeFile(
        absolutePath,
        'export const broken: number = "still-wrong";\n',
        'utf8',
      );
      const second = await lsp.getDiagnosticsForPath(relativePath, 12_000);
      assert.ok(
        second.diagnostics.some((item) => (item.severity ?? 1) === 1),
        `expected error after rewrite; formatted=${second.formatted}`,
      );
    } finally {
      await lsp.dispose();
      await rm(absolutePath, { force: true });
    }
  },
);
