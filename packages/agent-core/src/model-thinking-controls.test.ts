import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isDeepSeekReasoningOnlyModel,
  modelSupportsReasoningEffortWhileThinking,
  modelSupportsThinkingSwitch,
  modelUsesReasoningEffortPrimaryControl,
  resolveVendorExtendedThinking,
  shouldPinReasoningEffortToDefault,
} from './model-thinking-controls.js';

test('DeepSeek V4 supports thinking switch and effort while thinking', () => {
  const context = {
    provider: 'deepseek' as const,
    model: 'deepseek-v4-pro',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), false);
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelSupportsReasoningEffortWhileThinking(context), true);
  assert.equal(shouldPinReasoningEffortToDefault(true, context), false);
});

test('DeepSeek R1 has no thinking switch', () => {
  const context = {
    provider: 'deepseek' as const,
    model: 'deepseek-r1',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(isDeepSeekReasoningOnlyModel(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test('Moonshot uses reasoning effort primary control only', () => {
  const context = {
    provider: 'moonshot-ai' as const,
    model: 'kimi-k2.5',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test('OpenAI uses reasoning effort primary control only', () => {
  const context = {
    provider: 'openai' as const,
    model: 'gpt-5',
    transportKind: 'open-responses' as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test('Z.ai supports thinking switch with pinned effort when thinking on', () => {
  const context = {
    provider: 'z-ai' as const,
    model: 'glm-4.7',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelSupportsReasoningEffortWhileThinking(context), false);
  assert.equal(shouldPinReasoningEffortToDefault(true, context), true);
});

test('Gateway Claude slug uses reasoning effort primary control', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'anthropic/claude-sonnet-4-6',
    transportKind: 'open-responses' as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test('Gateway DeepSeek slug supports thinking switch', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'deepseek/deepseek-v3',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), true);
});

test('resolveVendorExtendedThinking maps enabled default to undefined wire omission', () => {
  assert.equal(resolveVendorExtendedThinking(undefined), undefined);
  assert.equal(resolveVendorExtendedThinking(true), undefined);
  assert.equal(resolveVendorExtendedThinking(false), false);
});
