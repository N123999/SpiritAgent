import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLlmMessageContentFromText,
  type LlmMessage,
} from '../ports.js';
import { AiSdkAnthropicTransport } from './ai-sdk-transport.js';

test('llmHistoryAsApiMessages preserves anthropic providerState for assistant tool calls', () => {
  const transport = new AiSdkAnthropicTransport();
  const history: LlmMessage[] = [{
    role: 'assistant',
    content: createLlmMessageContentFromText('calling weather'),
    toolCalls: [{
      id: 'call_weather',
      name: 'get_weather',
      argumentsJson: '{"city":"Paris"}',
    }],
    providerState: {
      reasoning_parts: [{
        type: 'reasoning',
        text: 'Let me verify the tool input first.',
        providerOptions: {
          anthropic: {
            signature: 'sig_demo',
          },
        },
      }],
      reasoning_content: 'Let me verify the tool input first.',
    },
  }];

  const messages = transport.llmHistoryAsApiMessages(history);
  assert.equal(messages.length, 1);

  const assistant = messages[0] as {
    role: string;
    content: string;
    reasoning_parts: Array<Record<string, unknown>>;
    tool_calls: Array<Record<string, unknown>>;
  };
  assert.equal(assistant.role, 'assistant');
  assert.equal(assistant.content, 'calling weather');
  assert.deepEqual(assistant.reasoning_parts, [
    {
      type: 'reasoning',
      text: 'Let me verify the tool input first.',
      providerOptions: {
        anthropic: {
          signature: 'sig_demo',
        },
      },
    },
  ]);
  assert.deepEqual(assistant.tool_calls, [
    {
      id: 'call_weather',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: '{"city":"Paris"}',
      },
    },
  ]);
});
