import assert from 'node:assert/strict';
import test from 'node:test';

import { finalAssistantHistoryMessageFromState } from './tool-agent.js';

test('finalAssistantHistoryMessageFromState preserves providerState from last assistant', () => {
  const message = finalAssistantHistoryMessageFromState(
    {
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: 'draft',
          providerState: { openAiResponses: { responseId: 'resp_final' } },
        },
      ],
      steps: 1,
    },
    'final text',
  );

  assert.equal(message.role, 'assistant');
  assert.deepEqual(message.providerState, {
    openAiResponses: { responseId: 'resp_final' },
  });
});
