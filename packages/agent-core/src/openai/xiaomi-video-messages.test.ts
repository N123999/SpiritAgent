import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { createLlmVideoContentPart } from '../ports.js';
import { llmMessageToOpenAiMessage } from './openai-multimodal-messages.js';
import { resolveXiaomiVideoUrlsInOpenAiMessages } from './xiaomi-video-messages.js';

const MINIMAL_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

test('resolveXiaomiVideoUrlsInOpenAiMessages embeds local video as data URL base64', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-agent-core-xiaomi-video-'));
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

test('resolveXiaomiVideoUrlsInOpenAiMessages leaves public https URLs unchanged', () => {
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'video_url',
          video_url: { url: 'https://example.com/video.mp4' },
        },
      ],
    },
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
  );

  const url = (messages[0] as { content: Array<{ video_url: { url: string } }> }).content[0]?.video_url.url;
  assert.equal(url, 'https://example.com/video.mp4');
});
