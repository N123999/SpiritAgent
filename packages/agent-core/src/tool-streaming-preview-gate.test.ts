import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hostToolArgumentsReadyForEarlyStreamingPreview,
  hostToolArgumentsReadyForPreview,
  resolveStreamingToolPreviewEmit,
  tryExtractPartialToolPath,
} from './tool-streaming-preview-gate.js';

test('tryExtractPartialToolPath reads path from incomplete JSON', () => {
  const partial = '{"path":"D:\\\\SpiritAgent\\\\README.md","old_text":"';
  assert.equal(tryExtractPartialToolPath(partial), 'D:\\SpiritAgent\\README.md');
});

test('edit_file early preview when only path is streamed', () => {
  const partial = '{"path":"README.md","old_text":"';
  assert.equal(hostToolArgumentsReadyForEarlyStreamingPreview('edit_file', partial), true);
  assert.equal(hostToolArgumentsReadyForPreview('edit_file', partial), false);
});

test('resolveStreamingToolPreviewEmit repeats for growing edit_file args', () => {
  const partial = '{"path":"README.md","old_text":"x","new_text":"';
  const first = resolveStreamingToolPreviewEmit('edit_file', partial, {
    readyPreviewEmitted: false,
  });
  assert.equal(first.emit, true);

  const longer = `${partial}${'y'.repeat(500)}`;
  const second = resolveStreamingToolPreviewEmit('edit_file', longer, first.nextState);
  assert.equal(second.emit, true);
});
