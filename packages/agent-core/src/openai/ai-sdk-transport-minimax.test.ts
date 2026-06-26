import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { setLlmFetchTransportOverrideForTests } from '../llm-fetch.js';
import { clearMinimaxVideoUploadCache } from './minimax-files.js';
import {
  clearMoonshotChatCompletionMessages,
  openAiMessagesContainVideoUrl,
  peekMoonshotChatCompletionMessages,
  stashMoonshotChatCompletionMessages,
} from './moonshot-chat-completion-messages.js';
import { AiSdkOpenAiCompatibleTransport } from './ai-sdk-transport.js';
import { resolveOpenAiModelCompatibilityProfile } from './openai-compat.js';

const MINIMAL_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

test('resolveOpenAiModelCompatibilityProfile strips minimax media without explicit capabilities', () => {
  const profile = resolveOpenAiModelCompatibilityProfile({
    llmVendor: 'minimax',
    model: 'MiniMax-M2.5',
  });
  assert.equal(profile.hasExplicitCapabilities, true);
  assert.deepEqual(profile.capabilities, {});
});

test('MiniMax openai-compatible fetch restores stashed video messages with mm_file url', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-agent-core-minimax-openai-video-'));
  const videoPath = join(workspaceRoot, 'clip.mp4');

  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearMinimaxVideoUploadCache();

    const capturedBodies: Record<string, unknown>[] = [];
    setLlmFetchTransportOverrideForTests(async (_input, init) => {
      if (init?.body instanceof FormData) {
        return new Response(JSON.stringify({ file_id: 'file-mm-1' }), { status: 200 });
      }

      const bodyText = String(init?.body ?? '');
      const body = JSON.parse(bodyText) as Record<string, unknown>;
      capturedBodies.push(body);
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const transport = new AiSdkOpenAiCompatibleTransport();
    const result = await transport.startToolAgentRound(
      {
        apiKey: 'test-key',
        model: 'MiniMax-M3',
        baseUrl: 'https://api.minimax.io/v1',
        llmVendor: 'minimax',
        workspaceRoot,
        modelCapabilities: { imageInput: true, videoInput: true },
      },
      {
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'describe the video' },
            { type: 'video_url', video_url: { url: videoPath } },
          ],
        }],
        steps: 0,
      },
      [],
    );

    assert.equal(result.kind, 'success');
    const chatCompletionBody = capturedBodies.find((body) =>
      Array.isArray(body.messages) && JSON.stringify(body.messages).includes('mm_file://'),
    );
    assert.ok(chatCompletionBody);
    assert.match(JSON.stringify(chatCompletionBody.messages), /mm_file:\/\/file-mm-1/);
    assert.equal(peekMoonshotChatCompletionMessages(), undefined);
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearMoonshotChatCompletionMessages();
    clearMinimaxVideoUploadCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('MiniMax openai-compatible stashes video_url messages before SDK request', () => {
  const requestMessages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'describe the video' },
        { type: 'video_url', video_url: { url: 'mm_file://file-mm-1' } },
      ],
    },
  ];
  assert.equal(openAiMessagesContainVideoUrl(requestMessages), true);
  stashMoonshotChatCompletionMessages(requestMessages);
  assert.ok(peekMoonshotChatCompletionMessages());
  clearMoonshotChatCompletionMessages();
});
