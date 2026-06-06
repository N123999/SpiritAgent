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

test('openrouter provider passes through display metadata and pricing', () => {
  const preview = previewModelCatalogForTransport({
    provider: 'openrouter',
    transportKind: 'openai-compatible',
    listedModels: [
      {
        id: 'anthropic/claude-sonnet-4',
        displayName: 'Claude Sonnet 4',
        description: 'Balanced reasoning model.',
        pricing: {
          inputPerTokenUsd: '0.000003',
          outputPerTokenUsd: '0.000015',
        },
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: 'anthropic/claude-sonnet-4',
      displayName: 'Claude Sonnet 4',
      description: 'Balanced reasoning model.',
      pricing: {
        inputPerTokenUsd: '0.000003',
        outputPerTokenUsd: '0.000015',
      },
      capabilities: ['chat'],
    },
  ]);

  const catalogMap = previewCatalogMapForTransport({
    provider: 'openrouter',
    transportKind: 'openai-compatible',
    modelCatalog: preview,
  });

  assert.deepEqual(catalogMap.get('anthropic/claude-sonnet-4'), preview[0]);
});

test('openrouter provider maps output_modalities to catalog capabilities', () => {
  assert.equal(usesProviderListedModelCatalogMetadata({ provider: 'openrouter' }), true);

  const preview = previewModelCatalogForTransport({
    provider: 'openrouter',
    transportKind: 'openai-compatible',
    listedModels: [
      {
        id: 'openai/gpt-4o',
      },
      {
        id: 'google/imagen-4',
        supportsImageGeneration: true,
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: 'openai/gpt-4o',
      capabilities: ['chat'],
    },
    {
      id: 'google/imagen-4',
      capabilities: ['imageGeneration'],
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
      },
      {
        id: 'google/imagen-4',
        supportsImageGeneration: true,
      },
      {
        id: 'alibaba/wan-v2.6-text-to-video',
        supportsVideoGeneration: true,
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: 'openai/gpt-5',
      capabilities: ['chat'],
    },
    {
      id: 'google/imagen-4',
      capabilities: ['imageGeneration'],
    },
    {
      id: 'alibaba/wan-v2.6-text-to-video',
      capabilities: ['chat', 'videoGeneration'],
    },
  ]);
});

test('moonshot-ai video input maps to video capability not videoGeneration', () => {
  const preview = previewModelCatalogForTransport({
    provider: 'moonshot-ai',
    transportKind: 'openai-compatible',
    listedModels: [
      {
        id: 'moonshot-v1-128k-vision-preview',
        supportsVideoInput: true,
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: 'moonshot-v1-128k-vision-preview',
      capabilities: ['chat', 'video'],
    },
  ]);
});

test('volcengine provider maps domain-derived traits to catalog capabilities', () => {
  assert.equal(usesProviderListedModelCatalogMetadata({ provider: 'volcengine' }), true);

  const preview = previewModelCatalogForTransport({
    provider: 'volcengine',
    transportKind: 'openai-compatible',
    listedModels: [
      {
        id: 'doubao-1-5-pro-32k-250115',
        displayName: 'doubao-1-5-pro-32k',
        contextLength: 131072,
      },
      {
        id: 'doubao-seed-1-6-250615',
        supportsImageInput: true,
        supportsVideoInput: true,
      },
      {
        id: 'doubao-seedance-2-0-260128',
        supportsVideoGeneration: true,
      },
      {
        id: 'doubao-seedream-4-0-250828',
        supportsImageGeneration: true,
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: 'doubao-1-5-pro-32k-250115',
      displayName: 'doubao-1-5-pro-32k',
      capabilities: ['chat'],
    },
    {
      id: 'doubao-seed-1-6-250615',
      capabilities: ['chat', 'image', 'video'],
    },
    {
      id: 'doubao-seedance-2-0-260128',
      capabilities: ['chat', 'videoGeneration'],
    },
    {
      id: 'doubao-seedream-4-0-250828',
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