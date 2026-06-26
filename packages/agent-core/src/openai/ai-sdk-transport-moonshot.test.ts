import assert from 'node:assert/strict';
import { test } from 'node:test';

import { setLlmFetchTransportOverrideForTests } from '../llm-fetch.js';
import { applyCodeCompletionTransportProfile } from '../code-completion/transport-profile.js';
import {
  clearMoonshotChatCompletionMessages,
  openAiMessagesContainVideoUrl,
  peekMoonshotChatCompletionMessages,
  stashMoonshotChatCompletionMessages,
} from './moonshot-chat-completion-messages.js';
import { AiSdkOpenAiCompatibleTransport } from './ai-sdk-transport.js';

test('Moonshot official provider fetch restores stashed video messages and reasoning_effort', async () => {
  const requestMessages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'describe the video' },
        { type: 'video_url', video_url: { url: 'ms://file-abc' } },
      ],
    },
  ];
  assert.equal(openAiMessagesContainVideoUrl(requestMessages), true);
  stashMoonshotChatCompletionMessages(requestMessages);
  assert.ok(peekMoonshotChatCompletionMessages());

  const capturedBodies: Record<string, unknown>[] = [];
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    capturedBodies.push(body);
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const transport = new AiSdkOpenAiCompatibleTransport();
  try {
    const result = await transport.startToolAgentRound(
      {
        apiKey: 'test-key',
        model: 'kimi-k2.5',
        baseUrl: 'https://api.moonshot.cn/v1',
        llmVendor: 'moonshot-ai',
        reasoningEffort: 'low',
        workspaceRoot: process.cwd(),
      },
      { messages: [{ role: 'user', content: 'describe the video' }], steps: 0 },
      [],
    );

    assert.equal(result.kind, 'success');
    const chatCompletionBody = capturedBodies.find((body) =>
      Array.isArray(body.messages) && JSON.stringify(body.messages).includes('video_url'),
    );
    assert.ok(chatCompletionBody);
    assert.equal(chatCompletionBody.reasoning_effort, 'low');
    assert.deepEqual(chatCompletionBody.messages, requestMessages);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearMoonshotChatCompletionMessages();
  }
});

test('Moonshot transport uses official provider trace kind and base URL', async () => {
  let capturedUrl = '';
  setLlmFetchTransportOverrideForTests(async (input) => {
    capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : 'request';
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const transport = new AiSdkOpenAiCompatibleTransport();
  try {
    const result = await transport.startToolAgentRound(
      {
        apiKey: 'test-key',
        model: 'kimi-k2.5',
        baseUrl: 'https://api.moonshot.cn/v1',
        llmVendor: 'moonshot-ai',
        workspaceRoot: process.cwd(),
      },
      { messages: [{ role: 'user', content: 'hi' }], steps: 0 },
      [],
    );

    assert.equal(result.kind, 'success');
    assert.match(capturedUrl, /api\.moonshot\.cn\/v1/);
    const trace = result.kind === 'success' ? result.result.requestTrace[0] : undefined;
    assert.equal(
      trace && typeof trace === 'object' && !Array.isArray(trace) ? trace.kind : undefined,
      'moonshot_sdk_chat_completions',
    );
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test('Moonshot code-completion profile sends thinking.type disabled via provider options', async () => {
  let capturedBody: Record<string, unknown> | undefined;
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      choices: [{
        message: {
          role: 'assistant',
          content: '{"ok":true}',
        },
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
      model: 'kimi-k2.5',
      baseUrl: 'https://api.moonshot.cn/v1',
      llmVendor: 'moonshot-ai',
      workspaceRoot: process.cwd(),
    }) as import('./openai-compat.js').OpenAiTransportConfig;

    await transport.createJsonSchemaCompletion(config, {
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      schemaName: 'test',
      userPrompt: 'reply',
    });

    assert.deepEqual(capturedBody?.thinking, { type: 'disabled' });
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});
