import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeMoonshotWebSearchIntoChatCompletionBody,
  mergeMoonshotWebSearchToolsForTrace,
} from './moonshot-web-search.js';

const moonshotConfig = {
  apiKey: 'k',
  model: 'kimi-k2.5',
  llmVendor: 'moonshot-ai' as const,
  baseUrl: 'https://api.moonshot.cn/v1',
};

test('mergeMoonshotWebSearchIntoChatCompletionBody appends builtin_function', () => {
  const body = mergeMoonshotWebSearchIntoChatCompletionBody(moonshotConfig, {
    model: 'kimi-k2.5',
    messages: [],
    tools: [{ type: 'function', function: { name: 'grep', parameters: {} } }],
  });

  assert.equal(Array.isArray(body.tools), true);
  const tools = body.tools as unknown[];
  assert.equal(tools.length, 2);
  const builtin = tools[1] as { type?: string; function?: { name?: string } };
  assert.equal(builtin.type, 'builtin_function');
  assert.equal(builtin.function?.name, '$web_search');
});

test('mergeMoonshotWebSearchToolsForTrace does not duplicate builtin', () => {
  const builtin = {
    type: 'builtin_function',
    function: { name: '$web_search' },
  };
  const tools = mergeMoonshotWebSearchToolsForTrace(moonshotConfig, [builtin]);
  assert.equal(tools.length, 1);
});

test('mergeMoonshotWebSearchIntoChatCompletionBody skips non-moonshot', () => {
  const body = { model: 'gpt-4.1', messages: [] };
  const merged = mergeMoonshotWebSearchIntoChatCompletionBody(
    { ...moonshotConfig, llmVendor: 'openai' },
    body,
  );
  assert.equal(merged.tools, undefined);
});
