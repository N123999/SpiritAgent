import assert from 'node:assert/strict';
import { test } from 'node:test';

import { setLlmFetchTransportOverrideForTests } from '../llm-fetch.js';
import { AiSdkOpenAiCompatibleTransport } from './ai-sdk-transport.js';

test('Google chat transport uses OpenAI-compatible provider, base URL, reasoning, and trace kind', async () => {
  let capturedUrl = '';
  let capturedBody: Record<string, unknown> | undefined;
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : 'request';
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: 'chatcmpl-google-test',
      object: 'chat.completion',
      created: 0,
      model: 'gemini-2.5-flash',
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'GOOGLE_OK' },
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
        model: 'gemini-2.5-flash',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        llmVendor: 'google',
        reasoningEffort: 'low',
        workspaceRoot: process.cwd(),
      },
      { messages: [{ role: 'user', content: 'hello' }], steps: 0 },
      [],
    );

    assert.equal(result.kind, 'success');
    assert.match(capturedUrl, /generativelanguage\.googleapis\.com\/v1beta\/openai/);
    assert.equal(capturedBody?.reasoning_effort, 'low');
    const trace = result.kind === 'success' ? result.result.requestTrace[0] : undefined;
    assert.equal(
      trace && typeof trace === 'object' && !Array.isArray(trace) ? trace.kind : undefined,
      'google_openai_compat_chat_completions',
    );
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});
