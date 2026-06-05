import assert from 'node:assert/strict';
import test from 'node:test';

import {
  moonshotSupportedReasoningEfforts,
  parseAnthropicModelEntriesPayload,
  parseOpenAiCompatibleModelEntriesPayload,
  parseMoonshotModelEntriesPayload,
  parseOpenRouterModelEntriesPayload,
  parseVercelAiGatewayModelEntriesPayload,
} from './openai-models.js';

test('parseAnthropicModelEntriesPayload extracts image input and supported effort levels', () => {
  const entries = parseAnthropicModelEntriesPayload({
    data: [
      {
        id: 'claude-sonnet-4-5',
        capabilities: {
          image_input: { supported: true },
          effort: {
            supported: true,
            low: { supported: true },
            medium: { supported: true },
            high: { supported: true },
            xhigh: { supported: false },
            max: { supported: false },
          },
        },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'claude-sonnet-4-5',
      supportsImageInput: true,
      supportedReasoningEfforts: ['low', 'medium', 'high'],
    },
  ]);
});

test('parseAnthropicModelEntriesPayload keeps explicit no-effort support as empty list', () => {
  const entries = parseAnthropicModelEntriesPayload({
    data: [
      {
        id: 'claude-haiku-no-effort',
        capabilities: {
          image_input: { supported: false },
          effort: { supported: false },
        },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'claude-haiku-no-effort',
      supportsImageInput: false,
      supportedReasoningEfforts: [],
    },
  ]);
});

test('parseMoonshotModelEntriesPayload maps Moonshot model trait fields', () => {
  const entries = parseMoonshotModelEntriesPayload({
    object: 'list',
    data: [
      {
        id: 'kimi-k2.5',
        object: 'model',
        supports_image_in: true,
        supports_video_in: false,
        supports_reasoning: true,
        context_length: 256000,
      },
      {
        id: 'kimi-k2-turbo-preview',
        supports_image_in: false,
        supports_video_in: false,
        supports_reasoning: false,
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'kimi-k2.5',
      supportsImageInput: true,
      supportsVideoInput: false,
      supportsReasoning: true,
      supportedReasoningEfforts: moonshotSupportedReasoningEfforts(true),
      contextLength: 256000,
    },
    {
      id: 'kimi-k2-turbo-preview',
      supportsImageInput: false,
      supportsVideoInput: false,
      supportsReasoning: false,
      supportedReasoningEfforts: [],
    },
  ]);
});

test('parseOpenAiCompatibleModelEntriesPayload keeps xAI models as plain ids', () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload({
    object: 'list',
    data: [
      { id: 'grok-4.3', object: 'model' },
      { id: ' grok-code-fast-1 ' },
      { object: 'model' },
    ],
  }, 'xai');

  assert.deepEqual(entries, [
    { id: 'grok-4.3' },
    { id: 'grok-code-fast-1' },
  ]);
});

test('parseVercelAiGatewayModelEntriesPayload maps language and image types', () => {
  const entries = parseVercelAiGatewayModelEntriesPayload({
    object: 'list',
    data: [
      {
        id: 'openai/gpt-5',
        type: 'language',
        tags: ['vision', 'tool-use'],
        context_window: 128000,
      },
      {
        id: 'google/imagen-4',
        type: 'image',
      },
      {
        id: 'alibaba/wan-v2.6-text-to-video',
        type: 'video',
      },
      {
        id: 'openai/text-embedding-3-small',
        type: 'embedding',
      },
      {
        id: 'legacy/model-without-type',
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'openai/gpt-5',
      contextLength: 128000,
    },
    {
      id: 'google/imagen-4',
      supportsImageGeneration: true,
    },
    {
      id: 'alibaba/wan-v2.6-text-to-video',
      supportsVideoGeneration: true,
    },
    {
      id: 'legacy/model-without-type',
    },
  ]);
});

test('parseOpenAiCompatibleModelEntriesPayload routes vercel-ai-gateway to typed parser', () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload({
    data: [
      { id: 'openai/gpt-5', type: 'language' },
      { id: 'google/imagen-4', type: 'image' },
      { id: 'cohere/rerank-english-v3.0', type: 'reranking' },
    ],
  }, 'vercel-ai-gateway');

  assert.deepEqual(entries, [
    { id: 'openai/gpt-5' },
    { id: 'google/imagen-4', supportsImageGeneration: true },
  ]);
});

test('parseOpenRouterModelEntriesPayload classifies output_modalities', () => {
  const entries = parseOpenRouterModelEntriesPayload({
    data: [
      {
        id: 'openai/gpt-4o',
        architecture: { output_modalities: ['text'] },
      },
      {
        id: 'google/imagen-4',
        architecture: { output_modalities: ['image'] },
      },
      {
        id: 'openai/gpt-image-1',
        output_modalities: ['text', 'image'],
      },
      {
        id: 'openai/text-embedding-3-small',
        architecture: { output_modalities: ['embedding'] },
      },
      {
        id: 'legacy/model-without-modalities',
      },
    ],
  });

  assert.deepEqual(entries, [
    { id: 'openai/gpt-4o' },
    { id: 'google/imagen-4', supportsImageGeneration: true },
    { id: 'openai/gpt-image-1' },
    { id: 'legacy/model-without-modalities' },
  ]);
});

test('parseVercelAiGatewayModelEntriesPayload extracts display metadata and pricing', () => {
  const entries = parseVercelAiGatewayModelEntriesPayload({
    data: [
      {
        id: 'openai/gpt-5',
        name: 'GPT-5',
        description: 'General-purpose language model.',
        type: 'language',
        context_window: 128000,
        pricing: {
          input: '0.000001',
          output: '0.000002',
        },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'openai/gpt-5',
      displayName: 'GPT-5',
      description: 'General-purpose language model.',
      pricing: {
        inputPerTokenUsd: '0.000001',
        outputPerTokenUsd: '0.000002',
      },
      contextLength: 128000,
    },
  ]);
});

test('parseOpenRouterModelEntriesPayload extracts display metadata and pricing', () => {
  const entries = parseOpenRouterModelEntriesPayload({
    data: [
      {
        id: 'anthropic/claude-sonnet-4',
        name: 'Claude Sonnet 4',
        description: 'Balanced reasoning model.',
        architecture: { output_modalities: ['text'] },
        pricing: {
          prompt: '0.000003',
          completion: '0.000015',
          request: '0',
        },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'anthropic/claude-sonnet-4',
      displayName: 'Claude Sonnet 4',
      description: 'Balanced reasoning model.',
      pricing: {
        inputPerTokenUsd: '0.000003',
        outputPerTokenUsd: '0.000015',
        requestPerCallUsd: '0',
      },
    },
  ]);
});

test('parseOpenAiCompatibleModelEntriesPayload routes openrouter to typed parser', () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload({
    data: [
      {
        id: 'anthropic/claude-sonnet-4',
        architecture: { output_modalities: ['text'] },
      },
      {
        id: 'stability/sdxl',
        architecture: { output_modalities: ['image'] },
      },
    ],
  }, 'openrouter');

  assert.deepEqual(entries, [
    { id: 'anthropic/claude-sonnet-4' },
    { id: 'stability/sdxl', supportsImageGeneration: true },
  ]);
});
