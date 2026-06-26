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

test('deepseek non-v4 models do not expose openai-compatible reasoning effort options', () => {
  const options = modelReasoningEffortOptions({
    provider: 'deepseek',
    model: 'deepseek-chat',
    transportKind: 'openai-compatible',
  });
  assert.deepEqual(options, [{ value: 'default', label: 'Default' }]);
});

test('gateway deepseek v4 models use deepseek v4 reasoning effort options', () => {
  const options = modelReasoningEffortOptions({
    provider: 'vercel-ai-gateway',
    model: 'deepseek/deepseek-v4-pro',
    transportKind: 'openai-compatible',
  });
  assert.deepEqual(
    options.map((option) => option.value),
    ['default', 'high', 'max'],
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
      model: 'gemini-3-flash-preview',
      transportKind: 'openai-compatible',
    }),
    'minimal',
  );
  assert.equal(
    resolveModelReasoningEffortForContext('minimal', {
      provider: 'google',
      model: 'gemini-2.5-flash',
      transportKind: 'openai-compatible',
    }),
    'none',
  );
  assert.equal(
    resolveOpenAiTransportReasoningEffortForContext('none', {
      provider: 'google',
      model: 'gemini-2.5-flash',
      transportKind: 'openai-compatible',
    }),
    'none',
  );
  assert.equal(
    resolveOpenAiTransportReasoningEffortForContext('none', {
      provider: 'google',
      model: 'gemini-3-flash-preview',
      transportKind: 'openai-compatible',
    }),
    'minimal',
  );
  assert.equal(
    resolveOpenAiTransportReasoningEffortForContext('max', {
      provider: 'google',
      transportKind: 'openai-compatible',
      model: 'gemini-2.5-flash',
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

test('gateway gemini models use google effort options', () => {
  const geminiProOptions = modelReasoningEffortOptions({
    provider: 'vercel-ai-gateway',
    model: 'google/gemini-3.1-pro-preview',
    transportKind: 'open-responses',
  });
  assert.deepEqual(
    geminiProOptions.map((option) => option.value),
    ['default', 'low', 'medium', 'high'],
  );

  const geminiFlashOptions = modelReasoningEffortOptions({
    provider: 'vercel-ai-gateway',
    model: 'google/gemini-3-flash-preview',
    transportKind: 'open-responses',
  });
  assert.deepEqual(
    geminiFlashOptions.map((option) => option.value),
    ['default', 'minimal', 'low', 'medium', 'high'],
  );

  const gemini25Options = modelReasoningEffortOptions({
    provider: 'vercel-ai-gateway',
    model: 'google/gemini-2.5-flash',
    transportKind: 'openai-compatible',
  });
  assert.deepEqual(
    gemini25Options.map((option) => option.value),
    ['default', 'none', 'low', 'medium', 'high'],
  );

  assert.equal(
    resolveModelReasoningEffortForContext('none', {
      provider: 'vercel-ai-gateway',
      model: 'google/gemini-3-flash-preview',
      transportKind: 'open-responses',
    }),
    'minimal',
  );
  assert.equal(
    resolveOpenAiTransportReasoningEffortForContext('medium', {
      provider: 'vercel-ai-gateway',
      model: 'google/gemini-2.5-flash',
      transportKind: 'openai-compatible',
    }),
    'medium',
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

test('openrouter claude models use anthropic effort options filtered by model capabilities', () => {
  const sonnetOptions = modelReasoningEffortOptions({
    provider: 'openrouter',
    model: 'anthropic/claude-sonnet-4.6',
    transportKind: 'open-responses',
  });
  assert.deepEqual(
    sonnetOptions.map((option) => option.value),
    ['default', 'low', 'medium', 'high'],
  );

  assert.equal(
    resolveModelReasoningEffortForContext('medium', {
      provider: 'openrouter',
      model: 'anthropic/claude-opus-4.8',
      transportKind: 'open-responses',
    }),
    'medium',
  );
});