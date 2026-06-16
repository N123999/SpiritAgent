import assert from 'node:assert/strict';
import { test } from 'node:test';

import { setLlmFetchTransportOverrideForTests } from '../llm-fetch.js';
import { AiSdkOpenAiCompatibleTransport } from './ai-sdk-transport.js';

function googleGenerateContentResponse(text: string) {
  return {
    candidates: [{
      content: {
        parts: [{ text }],
      },
      finishReason: 'STOP',
    }],
    usageMetadata: {
      promptTokenCount: 1,
      candidatesTokenCount: 1,
      totalTokenCount: 2,
    },
  };
}

test('Google chat transport uses official provider, base URL, thinking config, and trace kind', async () => {
  let capturedUrl = '';
  let capturedBody: Record<string, unknown> | undefined;
  setLlmFetchTransportOverrideForTests(async (input, init) => {
    capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : 'request';
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify(googleGenerateContentResponse('GOOGLE_OK')), {
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
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        llmVendor: 'google',
        reasoningEffort: 'low',
        workspaceRoot: process.cwd(),
      },
      { messages: [{ role: 'user', content: 'hello' }], steps: 0 },
      [],
    );

    assert.equal(result.kind, 'success');
    assert.match(capturedUrl, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent/);
    assert.doesNotMatch(capturedUrl, /\/openai/);
    assert.equal(capturedBody?.reasoning_effort, undefined);
    const generationConfig = capturedBody?.generationConfig;
    assert.ok(generationConfig && typeof generationConfig === 'object' && !Array.isArray(generationConfig));
    const thinkingConfig = (generationConfig as Record<string, unknown>).thinkingConfig;
    assert.deepEqual(thinkingConfig, {
      thinkingBudget: 1024,
      includeThoughts: true,
    });
    const trace = result.kind === 'success' ? result.result.requestTrace[0] : undefined;
    assert.equal(
      trace && typeof trace === 'object' && !Array.isArray(trace) ? trace.kind : undefined,
      'google_sdk_generate_content',
    );
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test('Google Gemini 3 models map reasoning effort to thinkingLevel', async () => {
  let capturedBody: Record<string, unknown> | undefined;
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify(googleGenerateContentResponse('GEMINI3_OK')), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const transport = new AiSdkOpenAiCompatibleTransport();
  try {
    const result = await transport.startToolAgentRound(
      {
        apiKey: 'test-key',
        model: 'gemini-3.1-pro-preview',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        llmVendor: 'google',
        reasoningEffort: 'high',
        workspaceRoot: process.cwd(),
      },
      { messages: [{ role: 'user', content: 'hello' }], steps: 0 },
      [],
    );

    assert.equal(result.kind, 'success');
    const generationConfig = capturedBody?.generationConfig;
    assert.ok(generationConfig && typeof generationConfig === 'object' && !Array.isArray(generationConfig));
    assert.deepEqual((generationConfig as Record<string, unknown>).thinkingConfig, {
      thinkingLevel: 'high',
      includeThoughts: true,
    });
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});
