import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCodeCompletionTransportProfile } from '../code-completion/transport-profile.js';
import { openAiVendorChatCompletionBodyExtras } from './openai-compat.js';

test('SiliconFlow code-completion profile always sends enable_thinking false', () => {
  const config = applyCodeCompletionTransportProfile({
    apiKey: 'k',
    model: 'Qwen/Qwen3-8B',
    llmVendor: 'siliconflow',
  });

  assert.deepEqual(
    openAiVendorChatCompletionBodyExtras(config as import('./openai-compat.js').OpenAiTransportConfig),
    {
      enable_thinking: false,
    },
  );
});
