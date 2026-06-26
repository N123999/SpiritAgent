import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCodeCompletionTransportProfile } from '../code-completion/transport-profile.js';
import { openAiVendorChatCompletionBodyExtras } from './openai-compat.js';

test('Volcengine code-completion profile disables thinking via thinking.type', () => {
  const config = applyCodeCompletionTransportProfile({
    apiKey: 'k',
    model: 'doubao-seed-1-6',
    llmVendor: 'volcengine',
  });

  assert.deepEqual(
    openAiVendorChatCompletionBodyExtras(config as import('./openai-compat.js').OpenAiTransportConfig),
    {
      thinking: { type: 'disabled' },
    },
  );
});
