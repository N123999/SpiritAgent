import assert from 'node:assert/strict';
import test from 'node:test';

import {
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