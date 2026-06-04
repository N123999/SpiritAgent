import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  previewCatalogMapForTransport,
  previewModelCatalogForTransport,
  usesAnthropicModelCatalogMetadata,
  usesProviderListedModelCatalogMetadata,
} from '../../dist-electron/src/host/model-catalog-metadata.js';

test('custom anthropic transport consumes Anthropic model catalog metadata', () => {
  assert.equal(
    usesAnthropicModelCatalogMetadata({ provider: 'custom', transportKind: 'anthropic' }),
    true,
  );

  const preview = previewModelCatalogForTransport({
    provider: 'custom',
    transportKind: 'anthropic',
    listedModels: [
      {
        id: 'claude-sonnet-4-20250514',
        supportsImageInput: false,
        supportedReasoningEfforts: ['low', 'high', 'high', 'default', 'max'],
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: 'claude-sonnet-4-20250514',
      capabilities: ['chat'],
      supportedReasoningEfforts: ['low', 'high', 'max'],
    },
  ]);

  const catalogMap = previewCatalogMapForTransport({
    provider: 'custom',
    transportKind: 'anthropic',
    modelCatalog: preview,
  });

  assert.deepEqual(catalogMap.get('claude-sonnet-4-20250514'), preview[0]);
});

test('moonshot-ai provider consumes Moonshot model catalog metadata', () => {
  assert.equal(usesProviderListedModelCatalogMetadata({ provider: 'moonshot-ai' }), true);

  const preview = previewModelCatalogForTransport({
    provider: 'moonshot-ai',
    transportKind: 'openai-compatible',
    listedModels: [
      {
        id: 'kimi-k2.5',
        supportsImageInput: true,
        supportsVideoInput: false,
        supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high'],
      },
      {
        id: 'kimi-k2-turbo-preview',
        supportsImageInput: false,
        supportsVideoInput: false,
        supportedReasoningEfforts: [],
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: 'kimi-k2.5',
      capabilities: ['chat', 'image'],
      supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high'],
    },
    {
      id: 'kimi-k2-turbo-preview',
      capabilities: ['chat'],
      supportedReasoningEfforts: [],
    },
  ]);
});

test('vercel-ai-gateway provider maps language and image model types to catalog capabilities', () => {
  assert.equal(usesProviderListedModelCatalogMetadata({ provider: 'vercel-ai-gateway' }), true);

  const preview = previewModelCatalogForTransport({
    provider: 'vercel-ai-gateway',
    transportKind: 'openai-compatible',
    listedModels: [
      {
        id: 'openai/gpt-5',
        supportsImageInput: true,
      },
      {
        id: 'google/imagen-4',
        supportsImageGeneration: true,
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: 'openai/gpt-5',
      capabilities: ['chat', 'image'],
    },
    {
      id: 'google/imagen-4',
      capabilities: ['imageGeneration'],
    },
  ]);
});

test('openai-compatible transport does not treat metadata as Anthropic-specific catalog data', () => {
  assert.equal(
    usesAnthropicModelCatalogMetadata({ provider: 'custom', transportKind: 'openai-compatible' }),
    false,
  );

  assert.equal(
    previewModelCatalogForTransport({
      provider: 'custom',
      transportKind: 'openai-compatible',
      listedModels: [{ id: 'some-model', supportsImageInput: true, supportedReasoningEfforts: ['low'] }],
    }),
    undefined,
  );

  assert.equal(
    previewCatalogMapForTransport({
      provider: 'custom',
      transportKind: 'openai-compatible',
      modelCatalog: [{ id: 'some-model', capabilities: ['chat', 'image'] }],
    }).size,
    0,
  );
});