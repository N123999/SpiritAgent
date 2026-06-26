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
