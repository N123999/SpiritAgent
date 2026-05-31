import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractOpenResponsesReasoningTextFromRawChunk,
} from './streaming.js';
import {
  resolveOpenResponsesReasoningSummary,
} from './responses-compat.js';

test('resolveOpenResponsesReasoningSummary defaults to auto', () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      model: 'gpt-5',
      reasoningEffort: 'medium',
    }),
    'auto',
  );
});

test('resolveOpenResponsesReasoningSummary respects none effort', () => {
  assert.equal(
    resolveOpenResponsesReasoningSummary({
      model: 'gpt-5',
      reasoningEffort: 'none',
      reasoningSummary: 'auto',
    }),
    undefined,
  );
});

test('extractOpenResponsesReasoningTextFromRawChunk reads summary delta', () => {
  assert.equal(
    extractOpenResponsesReasoningTextFromRawChunk({
      type: 'response.reasoning_summary_text.delta',
      delta: 'Planning next step.',
    }),
    'Planning next step.',
  );
});
