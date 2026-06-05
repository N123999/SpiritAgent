import assert from 'node:assert/strict';
import test from 'node:test';

import { isLspSupportedExtension, LSP_SUPPORTED_EXTENSIONS } from './constants.js';
import { buildLspHostToolDefinitions } from './tool-definitions.js';

test('LSP_SUPPORTED_EXTENSIONS covers in-scope languages and excludes HTML', () => {
  assert.ok(LSP_SUPPORTED_EXTENSIONS.has('.ts'));
  assert.ok(LSP_SUPPORTED_EXTENSIONS.has('.py'));
  assert.ok(LSP_SUPPORTED_EXTENSIONS.has('.go'));
  assert.ok(LSP_SUPPORTED_EXTENSIONS.has('.rs'));
  assert.ok(LSP_SUPPORTED_EXTENSIONS.has('.cpp'));
  assert.ok(LSP_SUPPORTED_EXTENSIONS.has('.java'));
  assert.ok(LSP_SUPPORTED_EXTENSIONS.has('.cs'));
  assert.equal(isLspSupportedExtension('.html'), false);
  assert.equal(isLspSupportedExtension('.css'), false);
});

test('buildLspHostToolDefinitions describes multi-language routing', () => {
  const tools = buildLspHostToolDefinitions();
  assert.equal(tools.length, 1);
  const tool = tools[0] as { function?: { description?: string; parameters?: { properties?: { path?: { description?: string } } } } };
  assert.match(tool.function?.description ?? '', /pyright|gopls|rust-analyzer/i);
  assert.match(tool.function?.parameters?.properties?.path?.description ?? '', /\.py|Python/i);
});
