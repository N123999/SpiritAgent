import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseModelProviderId,
  parsePresetModelProviderId,
  partitionModelsByProvider,
} from './model-provider-presets.js';

test('parse model provider helpers accept canonical ids and reject invalid values', () => {
  assert.equal(parseModelProviderId('alibaba'), 'alibaba');
  assert.equal(parseModelProviderId('vercel-ai-gateway'), 'vercel-ai-gateway');
  assert.equal(parseModelProviderId('openai'), 'openai');
  assert.equal(parseModelProviderId('custom'), 'custom');
  assert.equal(parseModelProviderId('unknown'), undefined);
  assert.equal(parseModelProviderId(''), undefined);

  assert.equal(parsePresetModelProviderId('alibaba'), 'alibaba');
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
