import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEarlyExecutableArgumentsJson,
  hostToolArgumentsReadyForEarlyStreamingPreview,
  hostToolArgumentsReadyForPreview,
  previewRequestFromStreamingArguments,
  readFilePartialAllowsEarlyExecution,
  readFileStreamingPreviewSignature,
  resolveStreamingToolPreviewEmit,
  tryExtractPartialPlanName,
  tryExtractPartialReadFileFields,
  tryExtractPartialToolPath,
} from './tool-streaming-preview-gate.js';

test('tryExtractPartialToolPath reads path from incomplete JSON', () => {
  const partial = '{"path":"D:\\\\SpiritAgent\\\\README.md","old_text":"';
  assert.equal(tryExtractPartialToolPath(partial), 'D:\\SpiritAgent\\README.md');
});

test('apply_patch early preview when operation.path is streamed', () => {
  const partial = '{"operation":{"type":"create_file","path":"demo.txt","diff":"+hel';
  assert.equal(hostToolArgumentsReadyForEarlyStreamingPreview('apply_patch', partial), true);
  assert.equal(hostToolArgumentsReadyForPreview('apply_patch', partial), false);
  assert.deepEqual(previewRequestFromStreamingArguments('apply_patch', partial), {
    operation: { path: 'demo.txt', type: 'create_file' },
  });
});

test('edit_file early preview when only path is streamed', () => {
  const partial = '{"path":"README.md","old_text":"';
  assert.equal(hostToolArgumentsReadyForEarlyStreamingPreview('edit_file', partial), true);
  assert.equal(hostToolArgumentsReadyForPreview('edit_file', partial), false);
});

test('create_plan early preview when only name is streamed', () => {
  const partial = '{"name":"random-fun-plan","content":"# Title';
  assert.equal(tryExtractPartialPlanName(partial), 'random-fun-plan');
  assert.equal(hostToolArgumentsReadyForEarlyStreamingPreview('create_plan', partial), true);
  assert.equal(hostToolArgumentsReadyForPreview('create_plan', partial), false);
  assert.deepEqual(previewRequestFromStreamingArguments('create_plan', partial), {
    name: 'random-fun-plan',
  });
});

test('resolveStreamingToolPreviewEmit repeats for growing create_plan args', () => {
  const partial = '{"name":"demo-plan","content":"# ';
  const first = resolveStreamingToolPreviewEmit('create_plan', partial, {
    readyPreviewEmitted: false,
  });
  assert.equal(first.emit, true);

  const longer = `${partial}${'x'.repeat(500)}`;
  const second = resolveStreamingToolPreviewEmit('create_plan', longer, first.nextState);
  assert.equal(second.emit, true);
});

test('buildEarlyExecutableArgumentsJson builds read_file path from partial JSON', () => {
  const partial = '{"path":"Cargo.toml","start_line":';
  assert.equal(buildEarlyExecutableArgumentsJson('read_file', partial), undefined);
  assert.equal(readFilePartialAllowsEarlyExecution(partial), false);

  const pathOnly = '{"path":"package.json"';
  assert.equal(buildEarlyExecutableArgumentsJson('read_file', pathOnly), '{"path":"package.json"}');
  assert.deepEqual(previewRequestFromStreamingArguments('read_file', pathOnly), { path: 'package.json' });

  const withLines = '{"path":"README.md","start_line":10,"end_line":50';
  assert.deepEqual(tryExtractPartialReadFileFields(withLines), {
    path: 'README.md',
    start_line: 10,
    end_line: 50,
  });
  assert.equal(
    buildEarlyExecutableArgumentsJson('read_file', withLines),
    '{"path":"README.md","start_line":10,"end_line":50}',
  );
});

test('resolveStreamingToolPreviewEmit repeats read_file preview when line range streams in', () => {
  const pathOnly = '{"path":"README.md"';
  const first = resolveStreamingToolPreviewEmit('read_file', pathOnly, {
    readyPreviewEmitted: false,
  });
  assert.equal(first.emit, true);
  assert.equal(readFileStreamingPreviewSignature(pathOnly), 'README.md\0\0');

  const withStart = '{"path":"README.md","start_line":10';
  const second = resolveStreamingToolPreviewEmit('read_file', withStart, first.nextState);
  assert.equal(second.emit, true);

  const withEnd = '{"path":"README.md","start_line":10,"end_line":50';
  const third = resolveStreamingToolPreviewEmit('read_file', withEnd, second.nextState);
  assert.equal(third.emit, true);

  const unchanged = resolveStreamingToolPreviewEmit('read_file', withEnd, third.nextState);
  assert.equal(unchanged.emit, false);
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
