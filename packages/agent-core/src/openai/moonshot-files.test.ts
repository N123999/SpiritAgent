import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  configureLlmClientVersion,
  setLlmFetchTransportOverrideForTests,
} from '../llm-fetch.js';
import {
  clearMoonshotVideoUploadCache,
  uploadMoonshotVideoFile,
} from './moonshot-files.js';

const MINIMAL_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

test('uploadMoonshotVideoFile posts multipart with purpose=video, User-Agent, and returns ms:// url', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-agent-core-moonshot-upload-'));
  const videoPath = join(workspaceRoot, 'clip.mp4');
  let capturedBody: FormData | undefined;
  let capturedUserAgent: string | null = null;

  try {
    await writeFile(videoPath, MINIMAL_MP4_HEADER);
    clearMoonshotVideoUploadCache();
    configureLlmClientVersion('1.2.3');
    setLlmFetchTransportOverrideForTests(async (_input, init) => {
      capturedBody = init?.body as FormData;
      const headers = init?.headers;
      capturedUserAgent = headers instanceof Headers ? headers.get('User-Agent') : null;
      return new Response(JSON.stringify({ id: 'file-abc123' }), { status: 200 });
    });

    const url = await uploadMoonshotVideoFile(
      { apiKey: 'test-key', baseUrl: 'https://api.moonshot.cn/v1' },
      videoPath,
    );

    assert.equal(url, 'ms://file-abc123');
    assert.equal(capturedBody?.get('purpose'), 'video');
    assert.ok(capturedBody?.get('file'));
    assert.equal(capturedUserAgent, 'SpiritAgent/1.2.3');

    const cached = await uploadMoonshotVideoFile(
      { apiKey: 'test-key', baseUrl: 'https://api.moonshot.cn/v1' },
      videoPath,
    );
    assert.equal(cached, 'ms://file-abc123');
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
    configureLlmClientVersion('0.1.0');
    clearMoonshotVideoUploadCache();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
