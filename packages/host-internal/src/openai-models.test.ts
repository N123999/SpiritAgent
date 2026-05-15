import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAnthropicModelEntriesPayload } from './openai-models.js';

test('parseAnthropicModelEntriesPayload extracts vision and supported effort levels', () => {
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
      supportsVision: true,
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
      supportsVision: false,
      supportedReasoningEfforts: [],
    },
  ]);
});
