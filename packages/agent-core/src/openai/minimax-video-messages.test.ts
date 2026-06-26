import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  configureLlmClientVersion,
  setLlmFetchTransportOverrideForTests,
} from '../llm-fetch.js';
import { clearMinimaxVideoUploadCache } from './minimax-files.js';
import { resolveMinimaxVideoInAnthropicMessages } from './minimax-video-messages.js';

const MINIMAL_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

test('resolveMinimaxVideoInAnthropicMessages uploads local video_url to mm_file reference', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-agent-core-minimax-video-msg-'));
  const videoPath = join(workspaceRoot, 'clip.mp4');

  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearMinimaxVideoUploadCache();
    configureLlmClientVersion('1.2.3');
    setLlmFetchTransportOverrideForTests(async () => new Response(
      JSON.stringify({ file_id: 'file-video-1' }),
      { status: 200 },
    ));

    const messages = [{
      role: 'user',
      content: [{
        type: 'video_url',
        video_url: { url: videoPath },
      }],
    }];

    await resolveMinimaxVideoInAnthropicMessages(
      {
        apiKey: 'test-key',
        baseUrl: 'https://api.minimax.io/anthropic/v1',
        model: 'MiniMax-M3',
        modelCapabilities: { videoInput: true },
      },
      messages,
      workspaceRoot,
    );

    const part = (messages[0] as { content: Array<{ video_url: { url: string } }> }).content[0];
    assert.equal(part.video_url.url, 'mm_file://file-video-1');
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    configureLlmClientVersion('0.1.0');
    clearMinimaxVideoUploadCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('resolveMinimaxVideoInAnthropicMessages skips when videoInput is disabled', async () => {
  const messages = [{
    role: 'user',
    content: [{
      type: 'video_url',
      video_url: { url: 'clip.mp4' },
    }],
  }];

  await resolveMinimaxVideoInAnthropicMessages(
    {
      apiKey: 'test-key',
      baseUrl: 'https://api.minimax.io/anthropic/v1',
      model: 'MiniMax-M3',
      modelCapabilities: {},
    },
    messages,
    process.cwd(),
  );

  const part = (messages[0] as { content: Array<{ video_url: { url: string } }> }).content[0];
  assert.equal(part.video_url.url, 'clip.mp4');
});
