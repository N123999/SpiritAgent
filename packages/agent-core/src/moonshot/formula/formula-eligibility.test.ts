import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isMoonshotFormulaWebSearchTool,
  shouldUseMoonshotFormulaWebSearch,
} from './formula-eligibility.js';
import {
  isRegisteredMoonshotFormulaFunctionName,
  resolveMoonshotFormulaUri,
} from './formula-registry.js';
import {
  buildMoonshotFormulaToolPreviewArgumentsJson,
  moonshotFormulaSpiritUiSuppressesExpand,
} from './formula-spirit-ui.js';

test('shouldUseMoonshotFormulaWebSearch enables moonshot-ai chat completions only', () => {
  assert.equal(
    shouldUseMoonshotFormulaWebSearch({
      apiKey: 'k',
      model: 'kimi-k2.5',
      llmVendor: 'moonshot-ai',
    }),
    true,
  );
  assert.equal(
    shouldUseMoonshotFormulaWebSearch({
      transportKind: 'openai-compatible',
      apiKey: 'k',
      model: 'kimi-k2.5',
      llmVendor: 'moonshot-ai',
    }),
    true,
  );
  assert.equal(
    shouldUseMoonshotFormulaWebSearch({
      apiKey: 'k',
      model: 'kimi-for-coding',
      llmVendor: 'kimi-code',
    }),
    false,
  );
  assert.equal(
    shouldUseMoonshotFormulaWebSearch({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'kimi-k2.5',
      llmVendor: 'moonshot-ai',
    }),
    false,
  );
  assert.equal(
    shouldUseMoonshotFormulaWebSearch({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'moonshotai/kimi-k2.5',
      llmVendor: 'vercel-ai-gateway',
    }),
    false,
  );
});

test('isMoonshotFormulaWebSearchTool matches web_search under eligible config', () => {
  const config = {
    apiKey: 'k',
    model: 'kimi-k2.5',
    llmVendor: 'moonshot-ai' as const,
  };
  assert.equal(isMoonshotFormulaWebSearchTool('web_search', config), true);
  assert.equal(isMoonshotFormulaWebSearchTool('read_file', config), false);
});

test('resolveMoonshotFormulaUri maps web_search to web-search formula', () => {
  assert.equal(
    resolveMoonshotFormulaUri('web_search'),
    'moonshot/web-search:latest',
  );
  assert.equal(isRegisteredMoonshotFormulaFunctionName('web_search'), true);
  assert.equal(isRegisteredMoonshotFormulaFunctionName('read_file'), false);
});

test('buildMoonshotFormulaToolPreviewArgumentsJson sets suppressExpand', () => {
  const argumentsJson = buildMoonshotFormulaToolPreviewArgumentsJson({
    query: 'latest AI news',
    status: 'completed',
  });
  assert.equal(moonshotFormulaSpiritUiSuppressesExpand(argumentsJson), true);
  const parsed = JSON.parse(argumentsJson) as { _spiritUi: { inputExcerpt: string } };
  assert.equal(parsed._spiritUi.inputExcerpt, 'latest AI news');
});
