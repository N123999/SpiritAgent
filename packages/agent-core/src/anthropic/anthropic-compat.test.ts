import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAnthropicProviderOptions,
  resolveAnthropicThinkingConfig,
} from './anthropic-compat.js';

test('resolveAnthropicThinkingConfig disables thinking for known unsupported metadata', () => {
  assert.deepEqual(
    resolveAnthropicThinkingConfig({
      model: 'claude-3-haiku-20240307',
      supportedEfforts: [],
    }),
    { type: 'disabled' },
  );
});

test('resolveAnthropicThinkingConfig enables thinking when effort is explicitly selected', () => {
  assert.deepEqual(
    resolveAnthropicThinkingConfig({
      model: 'claude-future-reasoner',
      effort: 'max',
    }),
    { type: 'enabled', budgetTokens: 12_000 },
  );
});

test('resolveAnthropicThinkingConfig keeps known adaptive defaults', () => {
  assert.deepEqual(
    resolveAnthropicThinkingConfig({
      model: 'claude-opus-4-7',
    }),
    { type: 'adaptive', display: 'summarized' },
  );
});

test('resolveAnthropicThinkingConfig leaves unknown models undefined', () => {
  assert.equal(
    resolveAnthropicThinkingConfig({
      model: 'custom-anthropic-compatible-model',
    }),
    undefined,
  );
});

test('buildAnthropicProviderOptions emits disabled thinking for unsupported models', () => {
  assert.deepEqual(
    buildAnthropicProviderOptions({
      model: 'claude-3-haiku-20240307',
      supportedEfforts: [],
    }),
    {
      anthropic: {
        thinking: { type: 'disabled' },
        toolStreaming: true,
      },
    },
  );
});

test('buildAnthropicProviderOptions omits thinking for unknown models', () => {
  assert.deepEqual(
    buildAnthropicProviderOptions({
      model: 'custom-anthropic-compatible-model',
    }),
    {
      anthropic: {
        toolStreaming: true,
      },
    },
  );
});