import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGatewayAnthropicProviderOptions,
  gatewayAnthropicClaudeSupportedEfforts,
  isGatewayAnthropicClaudeModel,
  normalizeGatewayAnthropicClaudeModelId,
  resolveGatewayAnthropicClaudeCapabilities,
} from './gateway-anthropic-thinking.js';

test('normalizeGatewayAnthropicClaudeModelId maps gateway ids to hyphen form', () => {
  assert.equal(
    normalizeGatewayAnthropicClaudeModelId('anthropic/claude-sonnet-4.6'),
    'claude-sonnet-4-6',
  );
  assert.equal(
    normalizeGatewayAnthropicClaudeModelId('anthropic/claude-opus-4.7'),
    'claude-opus-4-7',
  );
});

test('isGatewayAnthropicClaudeModel matches vercel-ai-gateway anthropic routes only', () => {
  assert.equal(
    isGatewayAnthropicClaudeModel('vercel-ai-gateway', 'anthropic/claude-sonnet-4.6'),
    true,
  );
  assert.equal(
    isGatewayAnthropicClaudeModel('vercel-ai-gateway', 'openai/gpt-5'),
    false,
  );
  assert.equal(
    isGatewayAnthropicClaudeModel('openrouter', 'anthropic/claude-sonnet-4.6'),
    false,
  );
});

test('resolveGatewayAnthropicClaudeCapabilities maps adaptive models and effort levels', () => {
  assert.deepEqual(resolveGatewayAnthropicClaudeCapabilities('anthropic/claude-sonnet-4.6'), {
    thinkingMode: 'adaptive',
    supportedEfforts: ['low', 'medium', 'high'],
  });
  assert.deepEqual(resolveGatewayAnthropicClaudeCapabilities('anthropic/claude-opus-4.6'), {
    thinkingMode: 'adaptive',
    supportedEfforts: ['low', 'medium', 'high', 'max'],
  });
  assert.deepEqual(resolveGatewayAnthropicClaudeCapabilities('anthropic/claude-opus-4.7'), {
    thinkingMode: 'adaptive',
    supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    adaptiveDisplay: 'summarized',
  });
});

test('resolveGatewayAnthropicClaudeCapabilities maps legacy claude models to budget thinking', () => {
  assert.deepEqual(resolveGatewayAnthropicClaudeCapabilities('anthropic/claude-sonnet-4-5'), {
    thinkingMode: 'budget',
    supportedEfforts: ['low', 'medium', 'high'],
  });
});

test('gatewayAnthropicClaudeSupportedEfforts exports effort vocabulary for catalog metadata', () => {
  assert.deepEqual(
    gatewayAnthropicClaudeSupportedEfforts('anthropic/claude-sonnet-4.6'),
    ['low', 'medium', 'high'],
  );
  assert.equal(gatewayAnthropicClaudeSupportedEfforts('openai/gpt-5'), undefined);
});

test('buildGatewayAnthropicProviderOptions sends adaptive thinking for sonnet 4.6', () => {
  assert.deepEqual(
    buildGatewayAnthropicProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'anthropic/claude-sonnet-4.6',
      reasoningEffort: 'default',
    }),
    {
      anthropic: {
        toolStreaming: true,
        thinking: { type: 'adaptive' },
      },
    },
  );
});

test('buildGatewayAnthropicProviderOptions maps effort and summarized display for opus 4.7', () => {
  assert.deepEqual(
    buildGatewayAnthropicProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'anthropic/claude-opus-4.7',
      reasoningEffort: 'high',
    }),
    {
      anthropic: {
        toolStreaming: true,
        thinking: { type: 'adaptive', display: 'summarized' },
        effort: 'high',
      },
    },
  );
});

test('buildGatewayAnthropicProviderOptions uses budget thinking for legacy claude when effort selected', () => {
  assert.deepEqual(
    buildGatewayAnthropicProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'anthropic/claude-sonnet-4-5',
      reasoningEffort: 'medium',
    }),
    {
      anthropic: {
        toolStreaming: true,
        thinking: { type: 'enabled', budgetTokens: 8_000 },
        effort: 'medium',
      },
    },
  );
});

test('buildGatewayAnthropicProviderOptions omits budget thinking for legacy claude at default effort', () => {
  assert.deepEqual(
    buildGatewayAnthropicProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'anthropic/claude-sonnet-4-5',
      reasoningEffort: 'default',
    }),
    {
      anthropic: {
        toolStreaming: true,
      },
    },
  );
});
