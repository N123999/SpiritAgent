import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appendDirectMediaTurnToArchive } from '../../dist-electron/src/host/direct-media-turn.js';

test('appendDirectMediaTurnToArchive appends user, assistant tool_calls, and tool rows', () => {
  const bundle = {
    archiveHistory: [],
  };

  appendDirectMediaTurnToArchive(bundle, {
    prompt: 'a moonlit courtyard',
    toolCallId: 'call-direct-video',
    toolName: 'generate_video',
    request: { name: 'generate_video', prompt: 'a moonlit courtyard' },
    summaryText: [
      '[generated video]',
      'video_ref: spirit-agent://generated/video/courtyard.mp4',
    ].join('\n'),
  });

  assert.equal(bundle.archiveHistory.length, 3);
  assert.equal(bundle.archiveHistory[0].role, 'user');
  assert.equal(bundle.archiveHistory[0].content[0].text, 'a moonlit courtyard');
  assert.equal(bundle.archiveHistory[1].role, 'assistant');
  assert.equal(bundle.archiveHistory[1].toolCalls?.[0]?.name, 'generate_video');
  assert.equal(bundle.archiveHistory[1].toolCalls?.[0]?.id, 'call-direct-video');
  assert.match(
    bundle.archiveHistory[1].toolCalls?.[0]?.argumentsJson ?? '',
    /a moonlit courtyard/,
  );
  assert.equal(bundle.archiveHistory[2].role, 'tool');
  assert.equal(bundle.archiveHistory[2].toolCallId, 'call-direct-video');
  assert.match(bundle.archiveHistory[2].content[0].text, /spirit-agent:\/\/generated\/video/);
});
