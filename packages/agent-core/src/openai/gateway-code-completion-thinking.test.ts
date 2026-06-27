import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGatewayCodeCompletionProviderOptions,
  parseGatewayUpstreamSlug,
  shouldUseGatewayCodeCompletionProviderOptions,
} from './gateway-code-completion-thinking.js';

const gatewayConfig = {
  llmVendor: 'vercel-ai-gateway' as const,
  transportRequestProfile: 'code-completion' as const,
};

test('parseGatewayUpstreamSlug extracts upstream slug', () => {
  assert.equal(parseGatewayUpstreamSlug('deepseek/deepseek-v3'), 'deepseek');
  assert.equal(parseGatewayUpstreamSlug('moonshotai/kimi-k2'), 'moonshotai');
  assert.equal(parseGatewayUpstreamSlug('zai/glm-4.7'), 'zai');
  assert.equal(parseGatewayUpstreamSlug('gpt-5'), undefined);
});

test('shouldUseGatewayCodeCompletionProviderOptions matches gateway code-completion only', () => {
  assert.equal(
    shouldUseGatewayCodeCompletionProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      transportRequestProfile: 'code-completion',
    }),
    true,
  );
  assert.equal(
    shouldUseGatewayCodeCompletionProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      transportRequestProfile: 'agent',
    }),
    false,
  );
});

test('buildGatewayCodeCompletionProviderOptions routes anthropic claude to disabled thinking', () => {
  assert.deepEqual(
    buildGatewayCodeCompletionProviderOptions({
      ...gatewayConfig,
      model: 'anthropic/claude-sonnet-4.6',
    }),
    {
      anthropic: {
        thinking: { type: 'disabled' },
        toolStreaming: true,
      },
    },
  );
});

test('buildGatewayCodeCompletionProviderOptions routes google gemini to thinkingBudget 0', () => {
  assert.deepEqual(
    buildGatewayCodeCompletionProviderOptions({
      ...gatewayConfig,
      model: 'google/gemini-2.5-flash',
    }),
    {
      google: {
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    },
  );
});

test('buildGatewayCodeCompletionProviderOptions routes openai to none/off', () => {
  assert.deepEqual(
    buildGatewayCodeCompletionProviderOptions({
      ...gatewayConfig,
      model: 'openai/gpt-5',
    }),
    {
      openai: {
        reasoningEffort: 'none',
        reasoningSummary: 'off',
      },
    },
  );
});

test('buildGatewayCodeCompletionProviderOptions routes deepseek and moonshotai to thinking disabled', () => {
  assert.deepEqual(
    buildGatewayCodeCompletionProviderOptions({
      ...gatewayConfig,
      model: 'deepseek/deepseek-v3',
    }),
    {
      deepseek: {
        thinking: { type: 'disabled' },
      },
    },
  );
  assert.deepEqual(
    buildGatewayCodeCompletionProviderOptions({
      ...gatewayConfig,
      model: 'moonshotai/kimi-k2',
    }),
    {
      moonshotai: {
        thinking: { type: 'disabled' },
      },
    },
  );
});

test('buildGatewayCodeCompletionProviderOptions routes zai alibaba minimax xiaomi slugs', () => {
  assert.deepEqual(
    buildGatewayCodeCompletionProviderOptions({
      ...gatewayConfig,
      model: 'zai/glm-4.7',
    }),
    {
      zai: {
        thinking: { type: 'disabled' },
      },
    },
  );
  assert.deepEqual(
    buildGatewayCodeCompletionProviderOptions({
      ...gatewayConfig,
      model: 'alibaba/qwen3-max',
    }),
    {
      alibaba: {
        enableThinking: false,
      },
    },
  );
  assert.deepEqual(
    buildGatewayCodeCompletionProviderOptions({
      ...gatewayConfig,
      model: 'minimax/MiniMax-M2.5',
    }),
    {
      minimax: {
        thinking: { type: 'disabled' },
      },
    },
  );
  assert.deepEqual(
    buildGatewayCodeCompletionProviderOptions({
      ...gatewayConfig,
      model: 'xiaomi/mimo-v2',
    }),
    {
      openai: {
        reasoningEffort: 'none',
        reasoningSummary: 'off',
      },
    },
  );
});

test('buildGatewayCodeCompletionProviderOptions disables xai reasoning via xai namespace', () => {
  assert.deepEqual(
    buildGatewayCodeCompletionProviderOptions({
      ...gatewayConfig,
      model: 'xai/grok-4.3',
    }),
    {
      xai: {
        reasoningEffort: 'none',
      },
    },
  );
});

test('buildGatewayCodeCompletionProviderOptions falls back to openai none for unknown slugs', () => {
  assert.deepEqual(
    buildGatewayCodeCompletionProviderOptions({
      ...gatewayConfig,
      model: 'fireworks/some-model',
    }),
    {
      openai: {
        reasoningEffort: 'none',
        reasoningSummary: 'off',
      },
    },
  );
});
