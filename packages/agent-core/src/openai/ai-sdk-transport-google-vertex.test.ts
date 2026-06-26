import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCodeCompletionTransportProfile } from '../code-completion/transport-profile.js';
import type { OpenAiTransportConfig } from './openai-compat.js';
import { buildGoogleThinkingConfigForEffort } from './gateway-google-thinking.js';

test('Google Vertex code-completion profile maps reasoningEffort none to thinkingBudget 0', () => {
  const config = applyCodeCompletionTransportProfile({
    apiKey: 'k',
    model: 'gemini-2.5-flash',
    llmVendor: 'google-vertex-ai',
    reasoningEffort: 'high',
  }) as OpenAiTransportConfig;

  assert.equal(config.transportRequestProfile, 'code-completion');
  assert.equal(config.reasoningEffort, 'none');
  assert.deepEqual(
    buildGoogleThinkingConfigForEffort(config.model, config.reasoningEffort),
    { thinkingBudget: 0 },
  );
});
