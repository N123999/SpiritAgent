import assert from 'node:assert/strict';
import { test } from 'node:test';

import { setLlmFetchTransportOverrideForTests } from '../llm-fetch.js';
import { applyCodeCompletionTransportProfile } from '../code-completion/transport-profile.js';
import { AiSdkOpenAiCompatibleTransport } from './ai-sdk-transport.js';

test('xAI chat transport uses official provider, base URL, reasoning options, and trace kind', async () => {
  let capturedUrl = '';
  let capturedBody: Record<string, unknown> | undefined;
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : 'request';
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: 'chatcmpl-xai-test',
      object: 'chat.completion',
      created: 0,
      model: 'grok-4.3',
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'XAI_OK' },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const transport = new AiSdkOpenAiCompatibleTransport();
  try {
    const result = await transport.startToolAgentRound(
      {
        apiKey: 'test-key',
        model: 'grok-4.3',
        baseUrl: 'https://api.x.ai/v1',
        llmVendor: 'xai',
        reasoningEffort: 'high',
        workspaceRoot: process.cwd(),
      },
      { messages: [{ role: 'user', content: 'hello' }], steps: 0 },
      [],
    );

    assert.equal(result.kind, 'success');
    assert.match(capturedUrl, /api\.x\.ai\/v1/);
    assert.equal(capturedBody?.reasoning_effort, 'high');
    const trace = result.kind === 'success' ? result.result.requestTrace[0] : undefined;
    assert.equal(
      trace && typeof trace === 'object' && !Array.isArray(trace) ? trace.kind : undefined,
      'xai_sdk_chat_completions',
    );
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test('xAI code-completion profile omits reasoning options', async () => {
  let capturedBody: Record<string, unknown> | undefined;
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: 'chatcmpl-xai-cc',
      object: 'chat.completion',
      created: 0,
      model: 'grok-4.3',
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'XAI_CC_OK' },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const transport = new AiSdkOpenAiCompatibleTransport();
  try {
    const config = applyCodeCompletionTransportProfile({
      apiKey: 'test-key',
      model: 'grok-4.3',
      baseUrl: 'https://api.x.ai/v1',
      llmVendor: 'xai',
      reasoningEffort: 'high',
      workspaceRoot: process.cwd(),
    }) as import('./openai-compat.js').OpenAiTransportConfig;

    const result = await transport.startToolAgentRound(
      config,
      { messages: [{ role: 'user', content: 'hello' }], steps: 0 },
      [],
    );

    assert.equal(result.kind, 'success');
    assert.equal(capturedBody?.reasoning_effort, undefined);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});
