import assert from 'node:assert/strict';
import test from 'node:test';

import {
  moonshotSupportedReasoningEfforts,
  parseAnthropicModelEntriesPayload,
  parseGoogleModelEntriesPayload,
  parseOpenAiCompatibleModelEntriesPayload,
  parseMoonshotModelEntriesPayload,
  parseOpenRouterModelEntriesPayload,
  parseSiliconFlowModelEntriesPayload,
  parseVercelAiGatewayModelEntriesPayload,
  parseVolcengineModelEntriesPayload,
  parseXiaomiModelEntriesPayload,
  parseMinimaxModelEntriesPayload,
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

test('parseVercelAiGatewayModelEntriesPayload infers supportedReasoningEfforts for anthropic claude models', () => {
  const entries = parseVercelAiGatewayModelEntriesPayload({
    data: [
      {
        id: 'anthropic/claude-sonnet-4.6',
        type: 'language',
      },
      {
        id: 'anthropic/claude-opus-4.7',
        type: 'language',
      },
      {
        id: 'openai/gpt-5',
        type: 'language',
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'anthropic/claude-sonnet-4.6',
      supportedReasoningEfforts: ['low', 'medium', 'high'],
    },
    {
      id: 'anthropic/claude-opus-4.7',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    },
    {
      id: 'openai/gpt-5',
    },
  ]);
});

test('parseVercelAiGatewayModelEntriesPayload infers supportedReasoningEfforts for google gemini models', () => {
  const entries = parseVercelAiGatewayModelEntriesPayload({
    data: [
      {
        id: 'google/gemini-3.1-pro-preview',
        type: 'language',
      },
      {
        id: 'google/gemini-2.5-flash',
        type: 'language',
      },
      {
        id: 'google/imagen-4',
        type: 'image',
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'google/gemini-3.1-pro-preview',
      supportedReasoningEfforts: ['low', 'medium', 'high'],
    },
    {
      id: 'google/gemini-2.5-flash',
      supportedReasoningEfforts: ['none', 'low', 'medium', 'high'],
    },
    {
      id: 'google/imagen-4',
      supportsImageGeneration: true,
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

test('parseVercelAiGatewayModelEntriesPayload extracts video duration pricing', () => {
  const entries = parseVercelAiGatewayModelEntriesPayload({
    data: [
      {
        id: 'alibaba/wan-v2.6-t2v',
        name: 'Wan v2.6 Text-to-Video',
        type: 'video',
        pricing: {
          video_duration_pricing: [
            { resolution: '720p', cost_per_second: '0.1' },
            { resolution: '1080p', cost_per_second: '0.15' },
          ],
        },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'alibaba/wan-v2.6-t2v',
      displayName: 'Wan v2.6 Text-to-Video',
      pricing: {
        videoDurationPricing: [
          { resolution: '720p', costPerSecondUsd: '0.1' },
          { resolution: '1080p', costPerSecondUsd: '0.15' },
        ],
      },
      supportsVideoGeneration: true,
    },
  ]);
});

test('parseVercelAiGatewayModelEntriesPayload extracts video duration pricing with audio tiers', () => {
  const entries = parseVercelAiGatewayModelEntriesPayload({
    data: [
      {
        id: 'google/veo-3.1-generate-001',
        name: 'Veo 3.1',
        type: 'video',
        pricing: {
          video_duration_pricing: [
            { resolution: '720p', audio: false, cost_per_second: '0.2' },
            { resolution: '720p', audio: true, cost_per_second: '0.4' },
            { resolution: '4k', audio: true, cost_per_second: '0.6' },
          ],
        },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'google/veo-3.1-generate-001',
      displayName: 'Veo 3.1',
      pricing: {
        videoDurationPricing: [
          { resolution: '720p', costPerSecondUsd: '0.2' },
          { resolution: '720p', costPerSecondUsd: '0.4', audio: true },
          { resolution: '4k', costPerSecondUsd: '0.6', audio: true },
        ],
      },
      supportsVideoGeneration: true,
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
      supportedReasoningEfforts: ['low', 'medium', 'high'],
    },
  ]);
});

test('parseOpenRouterModelEntriesPayload reads reasoning supported_efforts from api', () => {
  const entries = parseOpenRouterModelEntriesPayload({
    data: [
      {
        id: 'anthropic/claude-sonnet-4.6',
        architecture: { output_modalities: ['text'] },
        reasoning: { supported_efforts: ['high', 'medium', 'low'] },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'anthropic/claude-sonnet-4.6',
      supportedReasoningEfforts: ['high', 'medium', 'low'],
    },
  ]);
});

test('parseOpenRouterModelEntriesPayload keeps explicit empty supported_efforts without claude fallback', () => {
  const entries = parseOpenRouterModelEntriesPayload({
    data: [
      {
        id: 'anthropic/claude-sonnet-4.6',
        architecture: { output_modalities: ['text'] },
        reasoning: { supported_efforts: [] },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'anthropic/claude-sonnet-4.6',
      supportedReasoningEfforts: [],
    },
  ]);
});

test('parseOpenRouterModelEntriesPayload infers claude efforts when api omits reasoning', () => {
  const entries = parseOpenRouterModelEntriesPayload({
    data: [
      {
        id: 'anthropic/claude-opus-4.8',
        architecture: { output_modalities: ['text'] },
      },
    ],
  });

  assert.deepEqual(entries[0]?.supportedReasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max']);
});

test('parseXiaomiModelEntriesPayload marks multimodal allowlist models', () => {
  const entries = parseXiaomiModelEntriesPayload({
    object: 'list',
    data: [
      { id: 'mimo-v2.5', object: 'model', owned_by: 'xiaomi' },
      { id: 'mimo-v2-omni', object: 'model', owned_by: 'xiaomi' },
      { id: 'mimo-v2-flash', object: 'model', owned_by: 'xiaomi' },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'mimo-v2.5',
      supportsImageInput: true,
      supportsVideoInput: true,
    },
    {
      id: 'mimo-v2-omni',
      supportsImageInput: true,
      supportsVideoInput: true,
    },
    {
      id: 'mimo-v2-flash',
      supportsImageInput: false,
      supportsVideoInput: false,
    },
  ]);
});

test('parseMinimaxModelEntriesPayload marks M3 multimodal models only', () => {
  const entries = parseMinimaxModelEntriesPayload({
    object: 'list',
    data: [
      { id: 'MiniMax-M3', object: 'model' },
      { id: 'minimax-m3', object: 'model' },
      { id: 'MiniMax-M2.5', object: 'model' },
      { id: 'MiniMax-M2.5-highspeed', object: 'model' },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'MiniMax-M3',
      supportsImageInput: true,
      supportsVideoInput: true,
    },
    {
      id: 'minimax-m3',
      supportsImageInput: true,
      supportsVideoInput: true,
    },
    {
      id: 'MiniMax-M2.5',
      supportsImageInput: false,
      supportsVideoInput: false,
    },
    {
      id: 'MiniMax-M2.5-highspeed',
      supportsImageInput: false,
      supportsVideoInput: false,
    },
  ]);
});

test('parseOpenAiCompatibleModelEntriesPayload routes minimax provider to minimax parser', () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload(
    {
      object: 'list',
      data: [{ id: 'MiniMax-M3', object: 'model' }],
    },
    'minimax',
  );

  assert.deepEqual(entries, [
    {
      id: 'MiniMax-M3',
      supportsImageInput: true,
      supportsVideoInput: true,
    },
  ]);
});

test('parseOpenAiCompatibleModelEntriesPayload without provider omits minimax multimodal flags', () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload({
    object: 'list',
    data: [{ id: 'MiniMax-M3', object: 'model' }],
  });

  assert.deepEqual(entries, [{ id: 'MiniMax-M3' }]);
});

test('parseSiliconFlowModelEntriesPayload marks capabilities by list kind', () => {
  const chatEntries = parseSiliconFlowModelEntriesPayload(
    {
      object: 'list',
      data: [
        { id: 'Qwen/Qwen2.5-VL-7B-Instruct', object: 'model' },
        { id: 'deepseek-ai/DeepSeek-V3', object: 'model' },
      ],
    },
    'chat',
  );
  assert.deepEqual(chatEntries, [
    { id: 'Qwen/Qwen2.5-VL-7B-Instruct', supportsImageInput: true },
    { id: 'deepseek-ai/DeepSeek-V3' },
  ]);

  const imageEntries = parseSiliconFlowModelEntriesPayload(
    {
      object: 'list',
      data: [{ id: 'black-forest-labs/FLUX.1-schnell', object: 'model' }],
    },
    'image',
  );
  assert.deepEqual(imageEntries, [
    { id: 'black-forest-labs/FLUX.1-schnell', supportsImageGeneration: true },
  ]);

  const videoEntries = parseSiliconFlowModelEntriesPayload(
    {
      object: 'list',
      data: [{ id: 'Wan-AI/Wan2.2-T2V-A14B', object: 'model' }],
    },
    'video',
  );
  assert.deepEqual(videoEntries, [
    { id: 'Wan-AI/Wan2.2-T2V-A14B', supportsVideoGeneration: true },
  ]);
});

test('parseOpenAiCompatibleModelEntriesPayload routes xiaomi provider to xiaomi parser', () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload(
    {
      object: 'list',
      data: [{ id: 'mimo-v2.5', object: 'model' }],
    },
    'xiaomi',
  );

  assert.deepEqual(entries, [
    {
      id: 'mimo-v2.5',
      supportsImageInput: true,
      supportsVideoInput: true,
    },
  ]);
});

test('parseVolcengineModelEntriesPayload maps domain and skips shutdown models', () => {
  const entries = parseVolcengineModelEntriesPayload({
    object: 'list',
    data: [
      {
        id: 'doubao-1-5-pro-32k-250115',
        name: 'doubao-1-5-pro-32k',
        domain: 'LLM',
        token_limits: { context_window: 131072 },
      },
      {
        id: 'doubao-seed-1-6-250615',
        name: 'doubao-seed-1-6',
        domain: 'VLM',
        modalities: { input_modalities: ['text', 'image', 'video'], output_modalities: ['text'] },
        token_limits: { context_window: 262144 },
      },
      {
        id: 'doubao-seedance-2-0-260128',
        name: 'doubao-seedance-2-0',
        domain: 'VideoGeneration',
      },
      {
        id: 'doubao-seedream-4-0-250828',
        name: 'doubao-seedream-4-0',
        domain: 'ImageGeneration',
      },
      {
        id: 'doubao-pro-32k-240828',
        name: 'doubao-pro-32k',
        domain: 'LLM',
        status: 'Shutdown',
      },
      {
        id: 'doubao-embedding-text-240515',
        name: 'doubao-embedding',
        domain: 'Embedding',
        status: 'Retiring',
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'doubao-1-5-pro-32k-250115',
      displayName: 'doubao-1-5-pro-32k',
      contextLength: 131072,
    },
    {
      id: 'doubao-seed-1-6-250615',
      displayName: 'doubao-seed-1-6',
      supportsImageInput: true,
      supportsVideoInput: true,
      contextLength: 262144,
    },
    {
      id: 'doubao-seedance-2-0-260128',
      displayName: 'doubao-seedance-2-0',
      supportsVideoGeneration: true,
    },
    {
      id: 'doubao-seedream-4-0-250828',
      displayName: 'doubao-seedream-4-0',
      supportsImageGeneration: true,
    },
  ]);
});

test('parseOpenAiCompatibleModelEntriesPayload routes volcengine to typed parser', () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload({
    data: [
      {
        id: 'doubao-seedance-2-0-260128',
        name: 'doubao-seedance-2-0',
        domain: 'VideoGeneration',
      },
    ],
  }, 'volcengine');

  assert.deepEqual(entries, [
    {
      id: 'doubao-seedance-2-0-260128',
      displayName: 'doubao-seedance-2-0',
      supportsVideoGeneration: true,
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
    {
      id: 'anthropic/claude-sonnet-4',
      supportedReasoningEfforts: ['low', 'medium', 'high'],
    },
    { id: 'stability/sdxl', supportsImageGeneration: true },
  ]);
});

test('parseOpenRouterModelEntriesPayload maps context_length', () => {
  const entries = parseOpenRouterModelEntriesPayload({
    data: [
      {
        id: 'anthropic/claude-sonnet-4',
        context_length: 200000,
        architecture: { output_modalities: ['text'] },
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'anthropic/claude-sonnet-4',
      contextLength: 200000,
      supportedReasoningEfforts: ['low', 'medium', 'high'],
    },
  ]);
});

test('parseGoogleModelEntriesPayload maps displayName, description, and contextLength', () => {
  const entries = parseGoogleModelEntriesPayload({
    models: [
      {
        name: 'models/gemini-3.1-pro-preview',
        version: '3.1-pro-preview',
        displayName: 'Gemini 3.1 Pro Preview',
        description: 'Preview model for advanced reasoning.',
        inputTokenLimit: 1048576,
        outputTokenLimit: 8192,
        supportedGenerationMethods: ['generateContent', 'countTokens'],
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'gemini-3.1-pro-preview',
      displayName: 'Gemini 3.1 Pro Preview',
      description: 'Preview model for advanced reasoning.',
      contextLength: 1048576 + 8192,
    },
  ]);
});

test('parseGoogleModelEntriesPayload prefers baseModelId and skips non-generateContent models', () => {
  const entries = parseGoogleModelEntriesPayload({
    models: [
      {
        name: 'models/embedding-001',
        baseModelId: 'embedding-001',
        displayName: 'Embedding',
        supportedGenerationMethods: ['embedContent'],
      },
      {
        name: 'models/gemini-2.0-flash',
        baseModelId: 'gemini-2.0-flash',
        displayName: 'Gemini 2.0 Flash',
        inputTokenLimit: 1000,
        outputTokenLimit: 500,
        supportedGenerationMethods: ['generateContent'],
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'gemini-2.0-flash',
      displayName: 'Gemini 2.0 Flash',
      contextLength: 1500,
    },
  ]);
});

test('parseGoogleModelEntriesPayload skips models without generateContent support', () => {
  const entries = parseGoogleModelEntriesPayload({
    models: [
      {
        name: 'models/gemini-2.0-flash',
        displayName: 'Gemini 2.0 Flash',
        inputTokenLimit: 1000,
        outputTokenLimit: 500,
        supportedGenerationMethods: ['generateContent'],
      },
      {
        name: 'models/unknown-capability',
        displayName: 'Unknown',
        inputTokenLimit: 100,
        outputTokenLimit: 50,
      },
      {
        name: 'models/empty-methods',
        displayName: 'Empty Methods',
        supportedGenerationMethods: [],
      },
    ],
  });

  assert.deepEqual(entries, [
    {
      id: 'gemini-2.0-flash',
      displayName: 'Gemini 2.0 Flash',
      contextLength: 1500,
    },
  ]);
});

test('parseOpenAiCompatibleModelEntriesPayload routes google provider to native parser', () => {
  const entries = parseOpenAiCompatibleModelEntriesPayload(
    {
      models: [
        {
          name: 'models/gemini-2.5-flash',
          displayName: 'Gemini 2.5 Flash',
          inputTokenLimit: 100,
          outputTokenLimit: 50,
          supportedGenerationMethods: ['generateContent'],
        },
      ],
    },
    'google',
  );

  assert.deepEqual(entries, [
    {
      id: 'gemini-2.5-flash',
      displayName: 'Gemini 2.5 Flash',
      contextLength: 150,
    },
  ]);
});
