import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildModelCatalogDisplayTitleMap,
  buildModelCatalogDetailFields,
  findModelCatalogEntry,
  modelCatalogDisplayTitle,
  modelCatalogHasDetailBody,
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

test('modelHasCatalogDetail is true when only video duration pricing is present', () => {
  assert.equal(
    modelHasCatalogDetail({
      id: 'alibaba/wan-v2.6-t2v',
      pricing: {
        videoDurationPricing: [{ resolution: '720p', costPerSecondUsd: '0.1' }],
      },
    }),
    true,
  );
});

test('buildModelCatalogDetailFields renders video duration pricing rows', () => {
  const fields = buildModelCatalogDetailFields({
    pricing: {
      videoDurationPricing: [
        { resolution: '720p', costPerSecondUsd: '0.1' },
        { resolution: '1080p', costPerSecondUsd: '0.15' },
      ],
    },
    t: (key, options) => {
      if (key === 'settings.modelDetailPricingVideoPerSecond') {
        return `${options.value} / sec`;
      }
      return key;
    },
  });

  assert.deepEqual(fields, [
    { id: 'video-duration-0-720p', label: '720p', value: '$0.10 / sec' },
    { id: 'video-duration-1-1080p', label: '1080p', value: '$0.15 / sec' },
  ]);
});

test('buildModelCatalogDetailFields appends audio suffix to video duration pricing labels', () => {
  const fields = buildModelCatalogDetailFields({
    pricing: {
      videoDurationPricing: [
        { resolution: '720p', costPerSecondUsd: '0.2' },
        { resolution: '720p', costPerSecondUsd: '0.4', audio: true },
        { resolution: '4k', costPerSecondUsd: '0.6', audio: true },
      ],
    },
    t: (key, options) => {
      if (key === 'settings.modelDetailPricingVideoPerSecond') {
        return `${options.value} / sec`;
      }
      if (key === 'settings.modelDetailPricingVideoResolutionWithAudio') {
        return `${options.resolution} (audio)`;
      }
      return key;
    },
  });

  assert.deepEqual(fields, [
    { id: 'video-duration-0-720p', label: '720p', value: '$0.20 / sec' },
    { id: 'video-duration-1-720p-audio', label: '720p (audio)', value: '$0.40 / sec' },
    { id: 'video-duration-2-4k-audio', label: '4k (audio)', value: '$0.60 / sec' },
  ]);
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

test('modelCatalogHasDetailBody is false when only displayName is present', () => {
  const model = {
    name: 'minimax/M2.7',
    apiBase: 'https://example/v1',
    provider: 'openrouter',
    transportKind: 'openai-compatible',
    reasoningEffort: 'default',
    keyConfigured: true,
  };
  assert.equal(
    modelCatalogHasDetailBody({
      model,
      catalogEntry: { id: 'minimax/M2.7', displayName: 'MiniMax M2.7' },
    }),
    false,
  );
});

test('modelCatalogHasDetailBody is true when description or pricing exists', () => {
  const model = {
    name: 'openai/gpt-5',
    apiBase: 'https://example/v1',
    provider: 'openrouter',
    transportKind: 'openai-compatible',
    reasoningEffort: 'default',
    keyConfigured: true,
  };
  assert.equal(
    modelCatalogHasDetailBody({
      model,
      catalogEntry: { id: 'openai/gpt-5', description: 'Flagship model' },
    }),
    true,
  );
  assert.equal(
    modelCatalogHasDetailBody({
      model,
      catalogEntry: {
        id: 'openai/gpt-5',
        pricing: { inputPerTokenUsd: '0.000003' },
      },
    }),
    true,
  );
});
