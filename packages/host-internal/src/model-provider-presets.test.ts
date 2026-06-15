import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseModelProviderId,
  parsePresetModelProviderId,
  partitionModelsByProvider,
  resolveProviderConnectApiBase,
} from './model-provider-presets.js';

test('parse model provider helpers accept canonical ids and reject invalid values', () => {
  assert.equal(parseModelProviderId('alibaba'), 'alibaba');
  assert.equal(parseModelProviderId('vercel-ai-gateway'), 'vercel-ai-gateway');
  assert.equal(parseModelProviderId('openrouter'), 'openrouter');
  assert.equal(parseModelProviderId('openai'), 'openai');
  assert.equal(parseModelProviderId('google'), 'google');
  assert.equal(parseModelProviderId('xai'), 'xai');
  assert.equal(parseModelProviderId('custom'), 'custom');
  assert.equal(parseModelProviderId('moonshot-ai'), 'moonshot-ai');
  assert.equal(parseModelProviderId('kimi'), undefined);
  assert.equal(parseModelProviderId('unknown'), undefined);
  assert.equal(parseModelProviderId(''), undefined);

  assert.equal(parsePresetModelProviderId('alibaba'), 'alibaba');
  assert.equal(parsePresetModelProviderId('xai'), 'xai');
  assert.equal(parsePresetModelProviderId('custom'), undefined);
  assert.equal(parsePresetModelProviderId('unknown'), undefined);
});

test('partition models by provider preserves ordering and separates unmatched entries', () => {
  const models = [
    { name: 'qwen3.6-plus', provider: 'alibaba' as const },
    { name: 'deepseek-v4-pro', provider: 'deepseek' as const },
    { name: 'qwen3.6-max-preview', provider: 'alibaba' as const },
    { name: 'custom-model', provider: 'custom' as const },
    { name: 'legacy-openai' },
  ];

  assert.deepEqual(partitionModelsByProvider(models, 'alibaba'), {
    matched: [models[0], models[2]],
    unmatched: [models[1], models[3], models[4]],
  });
});

test('resolveProviderConnectApiBase uses transport-specific preset bases', () => {
  assert.equal(
    resolveProviderConnectApiBase('xai', 'openai-compatible'),
    'https://api.x.ai/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('xai', 'open-responses'),
    'https://api.x.ai/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('minimax', 'anthropic'),
    'https://api.minimaxi.com/anthropic/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('deepseek', 'anthropic'),
    'https://api.deepseek.com/anthropic',
  );
  assert.equal(
    resolveProviderConnectApiBase('alibaba', 'openai-compatible'),
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('alibaba', 'open-responses'),
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('alibaba', 'anthropic'),
    'https://dashscope.aliyuncs.com/apps/anthropic',
  );
  assert.equal(
    resolveProviderConnectApiBase('openai', 'open-responses'),
    'https://api.openai.com/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('google', 'openai-compatible'),
    'https://generativelanguage.googleapis.com/v1beta/openai',
  );
});

test('resolveProviderConnectApiBase returns OpenRouter preset base', () => {
  assert.equal(
    resolveProviderConnectApiBase('openrouter', 'openai-compatible'),
    'https://openrouter.ai/api/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('openrouter', 'open-responses'),
    'https://openrouter.ai/api/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('openrouter', 'anthropic'),
    'https://openrouter.ai/api/v1',
  );
});

test('resolveProviderConnectApiBase prefers custom override', () => {
  assert.equal(
    resolveProviderConnectApiBase('deepseek', 'anthropic', 'https://custom.example/v1'),
    'https://custom.example/v1',
  );
});
