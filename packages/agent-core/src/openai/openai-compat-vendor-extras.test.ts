import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCodeCompletionTransportProfile } from '../code-completion/transport-profile.js';
import { openAiVendorChatCompletionBodyExtras } from './openai-compat.js';

test('DeepSeek code-completion profile disables thinking via vendorExtendedThinking', () => {
  const config = applyCodeCompletionTransportProfile({
    apiKey: 'k',
    model: 'deepseek-v4-flash',
    llmVendor: 'deepseek',
  });

  assert.deepEqual(
    openAiVendorChatCompletionBodyExtras(config as import('./openai-compat.js').OpenAiTransportConfig),
    {
      thinking: { type: 'disabled' },
    },
  );
});

test('Z.ai code-completion profile disables thinking via request body extras', () => {
  const config = applyCodeCompletionTransportProfile({
    apiKey: 'k',
    model: 'glm-4.7',
    llmVendor: 'z-ai',
  });

  assert.equal((config as import('./openai-compat.js').OpenAiTransportConfig).vendorExtendedThinking, false);
  assert.deepEqual(
    openAiVendorChatCompletionBodyExtras(config as import('./openai-compat.js').OpenAiTransportConfig),
    {
      thinking: { type: 'disabled' },
    },
  );
});

test('Zhipu AI code-completion profile disables thinking via request body extras', () => {
  const config = applyCodeCompletionTransportProfile({
    apiKey: 'k',
    model: 'glm-4-plus',
    llmVendor: 'zhipu-ai',
  });

  assert.equal((config as import('./openai-compat.js').OpenAiTransportConfig).vendorExtendedThinking, false);
  assert.deepEqual(
    openAiVendorChatCompletionBodyExtras(config as import('./openai-compat.js').OpenAiTransportConfig),
    {
      thinking: { type: 'disabled' },
    },
  );
});

test('MiniMax code-completion profile disables thinking via request body extras', () => {
  const config = applyCodeCompletionTransportProfile({
    apiKey: 'k',
    model: 'MiniMax-M3',
    llmVendor: 'minimax',
  });

  assert.deepEqual(
    openAiVendorChatCompletionBodyExtras(config as import('./openai-compat.js').OpenAiTransportConfig),
    {
      thinking: { type: 'disabled' },
    },
  );
});

test('Xiaomi code-completion profile disables thinking via request body extras', () => {
  const config = applyCodeCompletionTransportProfile({
    apiKey: 'k',
    model: 'mimo-v2',
    llmVendor: 'xiaomi',
  });

  assert.deepEqual(
    openAiVendorChatCompletionBodyExtras(config as import('./openai-compat.js').OpenAiTransportConfig),
    {
      thinking: { type: 'disabled' },
    },
  );
});
