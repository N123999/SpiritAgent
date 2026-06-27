import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAnthropicClaudeAdaptiveThinkingModel,
  isAnthropicClaudeBudgetThinkingModel,
  isDeepSeekReasoningOnlyModel,
  modelEffortControlLabelKind,
  modelShowsReasoningEffortControl,
  modelSupportsReasoningEffortWhileThinking,
  modelSupportsThinkingSwitch,
  modelUsesReasoningEffortPrimaryControl,
  resolveAnthropicExplicitThinkingConfig,
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
  assert.equal(modelShowsReasoningEffortControl(context, true), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), false);
});

test('DeepSeek non-V4 has no thinking switch or reasoning effort control', () => {
  const context = {
    provider: 'deepseek' as const,
    model: 'deepseek-chat',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), false);
  assert.equal(modelSupportsReasoningEffortWhileThinking(context), false);
  assert.equal(modelShowsReasoningEffortControl(context, true), false);
  assert.equal(modelShowsReasoningEffortControl(context, false), false);
});

test('Z.ai shows reasoning effort when thinking enabled', () => {
  const context = {
    provider: 'z-ai' as const,
    model: 'glm-4.7',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, true), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), false);
  assert.equal(shouldPinReasoningEffortToDefault(true, context), false);
  assert.equal(shouldPinReasoningEffortToDefault(false, context), true);
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

test('Moonshot kimi-k2 uses reasoning effort primary control only', () => {
  const context = {
    provider: 'moonshot-ai' as const,
    model: 'kimi-k2',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test('Moonshot kimi-k2.5 supports thinking switch and effort when thinking enabled', () => {
  const context = {
    provider: 'moonshot-ai' as const,
    model: 'kimi-k2.5',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), false);
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, true), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), false);
  assert.equal(shouldPinReasoningEffortToDefault(false, context), true);
});

test('Moonshot kimi-k2.7-code uses reasoning effort primary control only', () => {
  const context = {
    provider: 'moonshot-ai' as const,
    model: 'kimi-k2.7-code',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
  assert.equal(modelShowsReasoningEffortControl(context, false), true);
});

test('Moonshot moonshot-v1 uses reasoning effort primary control only', () => {
  const context = {
    provider: 'moonshot-ai' as const,
    model: 'moonshot-v1-8k',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test('Gateway Moonshot kimi-k2.5 supports thinking switch', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'moonshotai/kimi-k2.5',
    transportKind: 'open-responses' as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), false);
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, true), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), false);
});

test('Gateway Xiaomi mimo-v2.5 supports thinking switch on chat transport', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'xiaomi/mimo-v2.5',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), false);
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), false);
  assert.equal(shouldPinReasoningEffortToDefault(false, context), true);
});

test('Gateway Xiaomi mimo-v2.5 uses reasoning effort primary control on responses transport', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'xiaomi/mimo-v2.5',
    transportKind: 'open-responses' as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
  assert.equal(modelShowsReasoningEffortControl(context, false), true);
  assert.equal(shouldPinReasoningEffortToDefault(false, context), false);
});

test('direct Xiaomi mimo-v2.5 uses reasoning effort primary control on responses transport', () => {
  const context = {
    provider: 'xiaomi' as const,
    model: 'mimo-v2.5',
    transportKind: 'open-responses' as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
  assert.equal(modelShowsReasoningEffortControl(context, false), true);
});

test('Gateway Xiaomi mimo-v2-flash has no thinking switch', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'xiaomi/mimo-v2-flash',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test('Gateway Z.ai glm-4.7 supports thinking switch', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'zai/glm-4.7',
    transportKind: 'open-responses' as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), false);
});

test('Gateway Z.ai glm-4 has no thinking switch', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'zai/glm-4',
    transportKind: 'open-responses' as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test('direct MiniMax M3 supports thinking switch', () => {
  const context = {
    provider: 'minimax' as const,
    model: 'MiniMax-M3',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), true);
});

test('direct MiniMax M2.5 has no thinking switch', () => {
  const context = {
    provider: 'minimax' as const,
    model: 'MiniMax-M2.5',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test('Gateway MiniMax M3 supports thinking switch', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'minimax/minimax-m3',
    transportKind: 'open-responses' as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), true);
});

test('Gateway MiniMax M2.5 has no thinking switch', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'minimax/MiniMax-M2.5',
    transportKind: 'open-responses' as const,
  };
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

test('Gateway OpenAI slug uses reasoning effort primary control', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'openai/gpt-5.5',
    transportKind: 'open-responses' as const,
  };
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), true);
  assert.equal(modelSupportsThinkingSwitch(context), false);
  assert.equal(modelShowsReasoningEffortControl(context, false), true);
  assert.equal(modelEffortControlLabelKind(context), 'reasoningEffort');
});

test('Gateway Claude adaptive supports thinking switch and effort label', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'anthropic/claude-opus-4-8',
    transportKind: 'open-responses' as const,
  };
  assert.equal(isAnthropicClaudeAdaptiveThinkingModel(context), true);
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), false);
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, true), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), true);
  assert.equal(shouldPinReasoningEffortToDefault(false, context), false);
  assert.equal(modelEffortControlLabelKind(context), 'effort');
});

test('Gateway Claude legacy budget supports thinking switch without effort control', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'anthropic/claude-opus-4-5',
    transportKind: 'open-responses' as const,
  };
  assert.equal(isAnthropicClaudeAdaptiveThinkingModel(context), false);
  assert.equal(isAnthropicClaudeBudgetThinkingModel(context), true);
  assert.equal(modelUsesReasoningEffortPrimaryControl(context), false);
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, true), false);
  assert.equal(modelEffortControlLabelKind(context), 'reasoningEffort');
});

test('Gateway Claude without extended thinking stays hidden', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'anthropic/claude-3-5-sonnet',
    transportKind: 'open-responses' as const,
  };
  assert.equal(isAnthropicClaudeBudgetThinkingModel(context), false);
  assert.equal(isAnthropicClaudeAdaptiveThinkingModel(context), false);
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test('Gateway DeepSeek non-V4 has no thinking switch', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'deepseek/deepseek-v3',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), false);
  assert.equal(modelShowsReasoningEffortControl(context, true), false);
});

test('Gateway DeepSeek V3.2 has no thinking switch', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'deepseek/deepseek-v3.2',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), false);
});

test('Gateway DeepSeek V4 shows reasoning effort when thinking enabled', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'deepseek/deepseek-v4-pro',
    transportKind: 'openai-compatible' as const,
  };
  assert.equal(modelSupportsThinkingSwitch(context), true);
  assert.equal(modelSupportsReasoningEffortWhileThinking(context), true);
  assert.equal(modelShowsReasoningEffortControl(context, true), true);
  assert.equal(modelShowsReasoningEffortControl(context, false), false);
});

test('resolveAnthropicExplicitThinkingConfig maps adaptive and disabled', () => {
  const adaptiveContext = {
    provider: 'vercel-ai-gateway' as const,
    model: 'anthropic/claude-opus-4-8',
    transportKind: 'open-responses' as const,
  };
  assert.deepEqual(resolveAnthropicExplicitThinkingConfig(undefined, adaptiveContext), {
    type: 'adaptive',
    display: 'summarized',
  });
  assert.deepEqual(resolveAnthropicExplicitThinkingConfig(true, adaptiveContext), {
    type: 'adaptive',
    display: 'summarized',
  });
  assert.deepEqual(resolveAnthropicExplicitThinkingConfig(false, adaptiveContext), {
    type: 'disabled',
  });
});

test('resolveAnthropicExplicitThinkingConfig maps budget disabled only', () => {
  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: 'anthropic/claude-opus-4-5',
    transportKind: 'open-responses' as const,
  };
  assert.equal(resolveAnthropicExplicitThinkingConfig(undefined, context), undefined);
  assert.equal(resolveAnthropicExplicitThinkingConfig(true, context), undefined);
  assert.deepEqual(resolveAnthropicExplicitThinkingConfig(false, context), {
    type: 'disabled',
  });
});

test('resolveVendorExtendedThinking maps enabled default to undefined wire omission', () => {
  assert.equal(resolveVendorExtendedThinking(undefined), undefined);
  assert.equal(resolveVendorExtendedThinking(true), undefined);
  assert.equal(resolveVendorExtendedThinking(false), false);
});
