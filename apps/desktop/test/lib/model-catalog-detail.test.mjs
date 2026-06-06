import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildModelCatalogDisplayTitleMap,
  findModelCatalogEntry,
  modelCatalogDisplayTitle,
  modelDisplayTitleFromMap,
  modelHasCatalogDetail,
} from '../../src/lib/model-catalog-detail.ts';

test('buildModelCatalogDisplayTitleMap uses catalog displayName for gateway models', () => {
  const hints = [
    {
      provider: 'vercel-ai-gateway',
      transportKind: 'openai-compatible',
      apiBase: 'https://gateway.example/v1',
      modelIds: ['openai/gpt-5'],
      modelCatalog: [{ id: 'openai/gpt-5', displayName: 'GPT-5' }],
      fetchedAtUnixMs: 1,
    },
  ];
  const models = [
    {
      name: 'openai/gpt-5',
      apiBase: 'https://gateway.example/v1',
      provider: 'vercel-ai-gateway',
      transportKind: 'openai-compatible',
      reasoningEffort: 'default',
      keyConfigured: true,
    },
  ];

  const titles = buildModelCatalogDisplayTitleMap(models, hints);
  assert.equal(titles.get('openai/gpt-5'), 'GPT-5');
  assert.equal(modelDisplayTitleFromMap('openai/gpt-5', titles), 'GPT-5');
  assert.equal(modelDisplayTitleFromMap('missing', titles), 'missing');
});

test('modelHasCatalogDetail is true when only displayName is present', () => {
  assert.equal(modelHasCatalogDetail({ id: 'x', displayName: 'Friendly' }), true);
});

test('buildModelCatalogDisplayTitleMap formats non-gateway model ids', () => {
  const models = [
    {
      name: 'gpt-4o-mini',
      apiBase: 'https://api.openai.com/v1',
      provider: 'openai',
      transportKind: 'openai-compatible',
      reasoningEffort: 'default',
      keyConfigured: true,
    },
  ];

  const titles = buildModelCatalogDisplayTitleMap(models, []);
  assert.equal(titles.get('gpt-4o-mini'), 'Gpt 4o Mini');
});

test('modelCatalogDisplayTitle keeps raw id for gateway without catalog entry', () => {
  const model = {
    name: 'openai/gpt-5',
    apiBase: 'https://gateway.example/v1',
    provider: 'vercel-ai-gateway',
    transportKind: 'openai-compatible',
    reasoningEffort: 'default',
    keyConfigured: true,
  };
  assert.equal(modelCatalogDisplayTitle(model, undefined), 'openai/gpt-5');
});

test('findModelCatalogEntry returns entry without pricing', () => {
  const hints = [
    {
      provider: 'openrouter',
      transportKind: 'openai-compatible',
      apiBase: 'https://openrouter.ai/api/v1',
      modelIds: ['anthropic/claude-sonnet-4'],
      modelCatalog: [{ id: 'anthropic/claude-sonnet-4', displayName: 'Claude Sonnet 4' }],
      fetchedAtUnixMs: 1,
    },
  ];
  const model = {
    name: 'anthropic/claude-sonnet-4',
    apiBase: 'https://openrouter.ai/api/v1',
    provider: 'openrouter',
    transportKind: 'openai-compatible',
    reasoningEffort: 'default',
    keyConfigured: true,
  };
  const entry = findModelCatalogEntry(model, hints);
  assert.equal(entry?.displayName, 'Claude Sonnet 4');
  assert.equal(modelCatalogDisplayTitle(model, entry), 'Claude Sonnet 4');
});
