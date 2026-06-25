import assert from 'node:assert/strict';
import test from 'node:test';

import {
  modelReasoningEffortOptions,
  resolveAnthropicTransportReasoningEffortForContext,
  resolveModelReasoningEffortForContext,
  resolveOpenAiTransportReasoningEffortForContext,
} from './reasoning-effort.js';

test('generic openai-compatible models normalize minimal to default', () => {
  assert.equal(
    resolveModelReasoningEffortForContext('minimal', { provider: 'custom', transportKind: 'openai-compatible' }),
    'default',
  );
});

test('deepseek v4 models normalize medium to high and preserve max', () => {
  assert.equal(
    resolveModelReasoningEffortForContext('medium', {
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      transportKind: 'openai-compatible',
    }),
    'high',
  );
  assert.equal(
    resolveOpenAiTransportReasoningEffortForContext('max', {
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      transportKind: 'openai-compatible',
    }),
    'max',
  );
});

test('anthropic models normalize max to high transport effort', () => {
  assert.equal(
    resolveAnthropicTransportReasoningEffortForContext('max', {
      provider: 'anthropic',
      transportKind: 'anthropic',
    }),
    'max',
  );
});

test('moonshot-ai supported efforts restrict unavailable levels', () => {
  assert.equal(
    resolveOpenAiTransportReasoningEffortForContext('minimal', {
      provider: 'moonshot-ai',
      model: 'kimi-k2-turbo-preview',
      transportKind: 'openai-compatible',
      supportedEfforts: [],
    }),
    undefined,
  );
  assert.equal(
    resolveOpenAiTransportReasoningEffortForContext('low', {
      provider: 'moonshot-ai',
      model: 'kimi-k2.5',
      transportKind: 'openai-compatible',
      supportedEfforts: ['minimal', 'low', 'medium', 'high'],
    }),
    'low',
  );
});

test('xAI models normalize reasoning efforts to supported values', () => {
  assert.equal(
    resolveModelReasoningEffortForContext('minimal', {
      provider: 'xai',
      transportKind: 'openai-compatible',
    }),
    'low',
  );
  assert.equal(
    resolveOpenAiTransportReasoningEffortForContext('max', {
      provider: 'xai',
      transportKind: 'openai-compatible',
    }),
    'high',
  );
  assert.equal(
    resolveOpenAiTransportReasoningEffortForContext('none', {
      provider: 'xai',
      transportKind: 'open-responses',
    }),
    'none',
  );
});

test('google models normalize reasoning efforts to supported values', () => {
  assert.equal(
    resolveModelReasoningEffortForContext('minimal', {
      provider: 'google',
      transportKind: 'openai-compatible',
    }),
    'low',
  );
  assert.equal(
    resolveOpenAiTransportReasoningEffortForContext('none', {
      provider: 'google',
      transportKind: 'openai-compatible',
    }),
    'none',
  );
  assert.equal(
    resolveOpenAiTransportReasoningEffortForContext('max', {
      provider: 'google',
      transportKind: 'openai-compatible',
    }),
    'high',
  );
});

test('anthropic supported efforts restrict unavailable levels', () => {
  assert.equal(
    resolveAnthropicTransportReasoningEffortForContext('xhigh', {
      provider: 'anthropic',
      transportKind: 'anthropic',
      supportedEfforts: ['low', 'medium', 'high'],
    }),
    undefined,
  );
  assert.equal(
    resolveAnthropicTransportReasoningEffortForContext('xhigh', {
      provider: 'anthropic',
      transportKind: 'anthropic',
      supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
    }),
    'xhigh',
  );
});

test('gateway claude models use anthropic effort options filtered by model capabilities', () => {
  const sonnetOptions = modelReasoningEffortOptions({
    provider: 'vercel-ai-gateway',
    model: 'anthropic/claude-sonnet-4.6',
    transportKind: 'openai-compatible',
  });
  assert.deepEqual(
    sonnetOptions.map((option) => option.value),
    ['default', 'low', 'medium', 'high'],
  );

  const opusOptions = modelReasoningEffortOptions({
    provider: 'vercel-ai-gateway',
    model: 'anthropic/claude-opus-4.7',
    transportKind: 'openai-compatible',
  });
  assert.ok(opusOptions.some((option) => option.value === 'max'));
  assert.ok(!opusOptions.some((option) => option.value === 'none'));

  assert.equal(
    resolveModelReasoningEffortForContext('max', {
      provider: 'vercel-ai-gateway',
      model: 'anthropic/claude-sonnet-4.6',
      transportKind: 'openai-compatible',
    }),
    'default',
  );
  assert.equal(
    resolveModelReasoningEffortForContext('max', {
      provider: 'vercel-ai-gateway',
      model: 'anthropic/claude-opus-4.7',
      transportKind: 'openai-compatible',
    }),
    'max',
  );
});