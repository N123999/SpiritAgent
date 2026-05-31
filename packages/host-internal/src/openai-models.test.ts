import assert from 'node:assert/strict';
import test from 'node:test';

import {
  moonshotSupportedReasoningEfforts,
  parseAnthropicModelEntriesPayload,
  parseOpenAiCompatibleModelEntriesPayload,
  parseMoonshotModelEntriesPayload,
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
