import assert from 'node:assert/strict';
import test from 'node:test';

import { LspService } from './service.js';

test('LspService.probe returns false when userConfig.enabled is false', async () => {
  const lsp = new LspService(process.cwd(), undefined, { enabled: false });
  assert.equal(await lsp.probe(), false);
  assert.equal(lsp.enabled, false);
  assert.equal(lsp.getResolvedServer(), undefined);
});

test('LspService.probe does not spawn when disabled', async () => {
  const lsp = new LspService(process.cwd(), undefined, { enabled: false });
  await lsp.probe();
  await lsp.probe();
  assert.equal(lsp.enabled, false);
});

test('LspService.resetProbe clears probe state', async () => {
  const lsp = new LspService(process.cwd(), undefined, { enabled: false });
  await lsp.probe();
  lsp.resetProbe();
  lsp.setUserConfig({ enabled: false });
  assert.equal(await lsp.probe(), false);
});
