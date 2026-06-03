import assert from 'node:assert/strict';
import test from 'node:test';

import { createAlibabaResponsesAwareFetch } from './alibaba-responses-fetch.js';
import type { OpenResponsesTransportConfig } from './responses-compat.js';

const alibabaResponsesConfig: OpenResponsesTransportConfig = {
  transportKind: 'open-responses',
  apiKey: 'test-key',
  model: 'qwen3-max',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  llmVendor: 'alibaba',
};

test('alibaba responses fetch merges builtin tools', async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const baseFetch: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response('{}', { status: 200 });
  };

  const fetch = createAlibabaResponsesAwareFetch(alibabaResponsesConfig, baseFetch);
  await fetch('https://dashscope.example/v1/responses', {
    method: 'POST',
    body: JSON.stringify({
      model: 'qwen3-max',
      input: [],
      tools: [{ type: 'function', name: 'demo_lookup' }],
    }),
  });

  const tools = capturedBody?.tools as Array<{ type?: string }> | undefined;
  assert.ok(tools?.some((tool) => tool.type === 'web_search'));
  assert.ok(tools?.some((tool) => tool.type === 'code_interpreter'));
  assert.equal(tools?.some((tool) => tool.type === 'web_extractor'), false);
  assert.ok(tools?.some((tool) => tool.type === 'function'));
});

test('alibaba responses fetch does not duplicate builtin tools', async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const baseFetch: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response('{}', { status: 200 });
  };

  const fetch = createAlibabaResponsesAwareFetch(alibabaResponsesConfig, baseFetch);
  await fetch('https://dashscope.example/v1/responses', {
    method: 'POST',
    body: JSON.stringify({
      model: 'qwen3-max',
      input: [],
      tools: [{ type: 'web_search' }, { type: 'code_interpreter' }],
    }),
  });

  const tools = capturedBody?.tools as Array<{ type?: string }> | undefined;
  assert.equal(tools?.filter((tool) => tool.type === 'web_search').length, 1);
});
