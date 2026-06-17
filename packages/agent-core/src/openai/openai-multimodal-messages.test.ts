import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { setLlmFetchTransportOverrideForTests } from '../llm-fetch.js';
import {
  createLlmMessageContentFromTextAndImages,
  createLlmVideoContentPart,
} from '../ports.js';
import {
  clearMoonshotVideoUploadCache,
} from './moonshot-files.js';
import {
  llmMessageToOpenAiMessage,
  resolveMoonshotVideoUrlsInOpenAiMessages,
} from './openai-multimodal-messages.js';
import { resolveXiaomiVideoUrlsInOpenAiMessages } from './xiaomi-video-messages.js';

const MINIMAL_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

test('llmMessageToOpenAiMessage serializes video parts as video_url with local path', () => {
  const assetRoot = '/workspace';
  const message = llmMessageToOpenAiMessage(
    {
      role: 'user',
      content: createLlmMessageContentFromTextAndImages('describe', [], ['clip.mp4']),
    },
    assetRoot,
  );

  assert.deepEqual(message, {
    role: 'user',
    content: [
      { type: 'text', text: 'describe' },
      {
        type: 'video_url',
        video_url: {
          url: resolve(assetRoot, 'clip.mp4').replace(/\\/g, '/'),
        },
      },
    ],
  });
});

test('resolveMoonshotVideoUrlsInOpenAiMessages uploads local video_url references', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-agent-core-moonshot-resolve-'));
  const videoPath = join(workspaceRoot, 'clip.mp4');
  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearMoonshotVideoUploadCache();

    setLlmFetchTransportOverrideForTests(async () =>
      new Response(JSON.stringify({ id: 'file-uploaded' }), { status: 200 }));

    const messages = [
      llmMessageToOpenAiMessage(
        {
          role: 'user',
          content: [createLlmVideoContentPart(videoPath)],
        },
        workspaceRoot,
      ),
    ];

    await resolveMoonshotVideoUrlsInOpenAiMessages(
      {
        apiKey: 'test-key',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2.5',
        llmVendor: 'moonshot-ai',
        modelCapabilities: { videoInput: true },
      },
      messages,
      workspaceRoot,
    );

    const content = (messages[0] as { content: Array<{ video_url: { url: string } }> }).content;
    assert.equal(content[0]?.video_url.url, 'ms://file-uploaded');
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    clearMoonshotVideoUploadCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('resolveXiaomiVideoUrlsInOpenAiMessages embeds local video as data URL base64', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-agent-core-xiaomi-resolve-'));
  const videoPath = join(workspaceRoot, 'clip.mp4');
  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);

    const messages = [
      llmMessageToOpenAiMessage(
        {
          role: 'user',
          content: [createLlmVideoContentPart(videoPath)],
        },
        workspaceRoot,
      ),
    ];

    resolveXiaomiVideoUrlsInOpenAiMessages(
      {
        apiKey: 'test-key',
        baseUrl: 'https://api.xiaomimimo.com/v1',
        model: 'mimo-v2.5',
        llmVendor: 'xiaomi',
        modelCapabilities: { videoInput: true },
      },
      messages,
      workspaceRoot,
    );

    const url = (messages[0] as { content: Array<{ video_url: { url: string } }> }).content[0]?.video_url.url ?? '';
    assert.match(url, /^data:video\/mp4;base64,/);
    assert.equal(url.slice('data:video/mp4;base64,'.length), MINIMAL_MP4_HEADER.toString('base64'));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
