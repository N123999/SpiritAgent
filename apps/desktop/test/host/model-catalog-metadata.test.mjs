import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  previewCatalogMapForTransport,
  previewModelCatalogForTransport,
  usesAnthropicModelCatalogMetadata,
  usesProviderListedModelCatalogMetadata,
} from '../../dist-electron/src/host/model-catalog-metadata.js';

test('siliconflow provider uses listed model catalog metadata', () => {
  assert.equal(
    usesProviderListedModelCatalogMetadata({ provider: 'siliconflow', transportKind: 'openai-compatible' }),
    true,
  );

  const preview = previewModelCatalogForTransport({
    provider: 'siliconflow',
    transportKind: 'openai-compatible',
    listedModels: [
      { id: 'deepseek-ai/DeepSeek-V3' },
      { id: 'black-forest-labs/FLUX.1-schnell', supportsImageGeneration: true },
      { id: 'Wan-AI/Wan2.2-T2V-A14B', supportsVideoGeneration: true },
    ],
  });

  assert.deepEqual(preview, [
    { id: 'deepseek-ai/DeepSeek-V3', displayName: 'Deepseek Ai DeepSeek V3', capabilities: ['chat'] },
    {
      id: 'black-forest-labs/FLUX.1-schnell',
      displayName: 'Black Forest Labs FLUX.1 Schnell',
      capabilities: ['imageGeneration'],
    },
    {
      id: 'Wan-AI/Wan2.2-T2V-A14B',
      displayName: 'Wan AI Wan2.2 T2V A14B',
      capabilities: ['chat', 'videoGeneration'],
    },
  ]);
});

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
      displayName: 'Claude Sonnet 4 20250514',
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
      displayName: 'Kimi K2.5',
      capabilities: ['chat', 'image'],
      supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high'],
    },
    {
      id: 'kimi-k2-turbo-preview',
      displayName: 'Kimi K2 Turbo Preview',
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
      displayName: 'Moonshot V1 128k Vision Preview',
      capabilities: ['chat', 'video'],
    },
  ]);
});

test('xiaomi provider consumes Xiaomi model catalog metadata', () => {
  assert.equal(usesProviderListedModelCatalogMetadata({ provider: 'xiaomi' }), true);

  const preview = previewModelCatalogForTransport({
    provider: 'xiaomi',
    transportKind: 'openai-compatible',
    listedModels: [
      {
        id: 'mimo-v2.5',
        supportsImageInput: true,
        supportsVideoInput: true,
      },
      {
        id: 'mimo-v2-flash',
        supportsImageInput: false,
        supportsVideoInput: false,
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: 'mimo-v2.5',
      displayName: 'Mimo V2.5',
      capabilities: ['chat', 'image', 'video'],
    },
    {
      id: 'mimo-v2-flash',
      displayName: 'Mimo V2 Flash',
      capabilities: ['chat'],
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
      contextLength: 131072,
    },
    {
      id: 'doubao-seed-1-6-250615',
      displayName: 'Doubao Seed 1 6 250615',
      capabilities: ['chat', 'image', 'video'],
    },
    {
      id: 'doubao-seedance-2-0-260128',
      displayName: 'Doubao Seedance 2 0 260128',
      capabilities: ['chat', 'videoGeneration'],
    },
    {
      id: 'doubao-seedream-4-0-250828',
      displayName: 'Doubao Seedream 4 0 250828',
      capabilities: ['imageGeneration'],
    },
  ]);
});

test('google provider uses upstream display metadata from native models catalog', () => {
  assert.equal(usesProviderListedModelCatalogMetadata({ provider: 'google' }), true);

  const preview = previewModelCatalogForTransport({
    provider: 'google',
    transportKind: 'openai-compatible',
    listedModels: [
      {
        id: 'gemini-3.1-pro-preview',
        displayName: 'Gemini 3.1 Pro Preview',
        description: 'Preview model for advanced reasoning.',
        contextLength: 1048576 + 8192,
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: 'gemini-3.1-pro-preview',
      displayName: 'Gemini 3.1 Pro Preview',
      description: 'Preview model for advanced reasoning.',
      capabilities: ['chat'],
      contextLength: 1048576 + 8192,
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

test('openrouter provider passes contextLength through catalog metadata', () => {
  const preview = previewModelCatalogForTransport({
    provider: 'openrouter',
    transportKind: 'openai-compatible',
    listedModels: [
      {
        id: 'anthropic/claude-sonnet-4',
        contextLength: 200000,
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: 'anthropic/claude-sonnet-4',
      capabilities: ['chat'],
      contextLength: 200000,
    },
  ]);
});