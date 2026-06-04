import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LspService } from '@spirit-agent/agent-core';

import { buildDesktopLspSnapshot } from '../../dist-electron/src/host/lsp-snapshot.js';
import { DesktopToolExecutor } from '../../dist-electron/src/host/tool-executor.js';

function functionToolNames(definitions) {
  return Array.isArray(definitions)
    ? definitions.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') {
          return [];
        }
        const tool = entry.function;
        return tool && typeof tool === 'object' && typeof tool.name === 'string'
          ? [tool.name]
          : [];
      })
    : [];
}

test('buildDesktopLspSnapshot marks providers disabled when user turns off LSP', async () => {
  const snapshot = await buildDesktopLspSnapshot({
    agents: { lsp: { enabled: false } },
  });

  assert.equal(snapshot.userEnabled, false);
  assert.equal(snapshot.active, false);
  assert.ok(snapshot.providers.length > 0);
  assert.ok(snapshot.providers.every((provider) => provider.status === 'disabled'));
});

test('desktop tool executor omits get_diagnostics when lsp user config is disabled', async () => {
  const lsp = new LspService(process.cwd(), undefined, { enabled: false });
  await lsp.probe();

  const toolExecutor = new DesktopToolExecutor(process.cwd(), { lsp });
  const toolNames = functionToolNames(toolExecutor.toolDefinitionsJson());

  assert.ok(!toolNames.includes('get_diagnostics'));
});
