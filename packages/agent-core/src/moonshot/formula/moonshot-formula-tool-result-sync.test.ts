import assert from 'node:assert/strict';
import test from 'node:test';

import { createLlmMessageContentFromText, llmMessageTextContent, type LlmMessage } from '../../ports.js';
import { TOOL_OUTPUT_TRUNCATION_LABEL } from '../../tool-agent.js';
import { prepareAndSyncRuntimeToolResultToHistory } from '../../runtime/tool-output-append.js';

test('prepareAndSyncRuntimeToolResultToHistory truncates oversized Formula tool output', async () => {
  const encryptedOutput = `----MOONSHOT ENCRYPTED BEGIN----+nf6${'x'.repeat(20_000)}----MOONSHOT ENCRYPTED END----`;
  const historyStore: LlmMessage[] = [
    {
      role: 'assistant',
      content: [],
      toolCalls: [{
        id: 'web_search_0',
        name: 'web_search',
        argumentsJson: '{"query":"latest news"}',
      }],
    },
  ];

  const prepared = await prepareAndSyncRuntimeToolResultToHistory(
    {
      options: {
        persistToolOutputArchive: async () => '/tmp/archive/web_search_0.txt',
      } as never,
      historyStore,
    },
    'web_search_0',
    encryptedOutput,
  );

  assert.ok(prepared.length < encryptedOutput.length);
  assert.match(prepared, new RegExp(TOOL_OUTPUT_TRUNCATION_LABEL.replace(/[[\]]/g, '\\$&')));

  const toolMessage = historyStore.find(
    (message) => message.role === 'tool' && message.toolCallId === 'web_search_0',
  );
  assert.ok(toolMessage);
  assert.equal(llmMessageTextContent(toolMessage.content), prepared);
});
