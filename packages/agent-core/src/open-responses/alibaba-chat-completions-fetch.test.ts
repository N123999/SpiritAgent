import assert from 'node:assert/strict';
import test from 'node:test';

import type { OpenAiTransportConfig } from '../openai/openai-compat.js';
import { createAlibabaChatCompletionsAwareFetch } from './alibaba-chat-completions-fetch.js';

const alibabaChatConfig: OpenAiTransportConfig = {
  transportKind: 'openai-compatible',
  apiKey: 'test-key',
  model: 'qwen3-max',
  llmVendor: 'alibaba',
};

test('alibaba chat fetch merges extra_body on streaming chat completions', async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const baseFetch: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response('{}', { status: 200 });
  };

  const fetch = createAlibabaChatCompletionsAwareFetch(alibabaChatConfig, baseFetch);
  await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ model: 'qwen3-max', messages: [], stream: true }),
  });

  const extraBody = capturedBody?.extra_body as Record<string, unknown> | undefined;
  assert.equal(extraBody?.enable_search, true);
  assert.equal(extraBody?.enable_thinking, true);
  assert.equal(extraBody?.enable_code_interpreter, true);
  assert.deepEqual(extraBody?.search_options, { search_strategy: 'agent_max' });
});

test('alibaba chat fetch uses search-only extra_body when not streaming', async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const baseFetch: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response('{}', { status: 200 });
  };

  const fetch = createAlibabaChatCompletionsAwareFetch(alibabaChatConfig, baseFetch);
  await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ model: 'qwen3-max', messages: [], stream: false }),
  });

  const extraBody = capturedBody?.extra_body as Record<string, unknown> | undefined;
  assert.deepEqual(extraBody, { enable_search: true });
});

test('alibaba chat fetch is passthrough for non-alibaba vendor', async () => {
  let called = false;
  const baseFetch: typeof fetch = async () => {
    called = true;
    return new Response('{}', { status: 200 });
  };

  const fetch = createAlibabaChatCompletionsAwareFetch(
    { ...alibabaChatConfig, llmVendor: 'openai' },
    baseFetch,
  );
  await fetch('https://example.com/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify({ model: 'gpt-4.1', messages: [], stream: true }),
  });

  assert.equal(called, true);
});
