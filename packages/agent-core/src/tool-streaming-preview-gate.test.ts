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
  assert.deepEqual(previewRequestFromStreamingArguments('edit_file', partial), {
    path: 'README.md',
  });
});

test('create_file partial preview exposes path before content streams', () => {
  const partial = '{"path":"src/messages.ts","content":"';
  assert.deepEqual(previewRequestFromStreamingArguments('create_file', partial), {
    path: 'src/messages.ts',
  });
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

test('resolveStreamingToolPreviewEmit repeats create_file when content grows', () => {
  const partial = '{"path":"a.ts","content":"line';
  const first = resolveStreamingToolPreviewEmit('create_file', partial, {
    readyPreviewEmitted: false,
  });
  assert.equal(first.emit, true);

  const longer = `${partial} one\\nline two`;
  const second = resolveStreamingToolPreviewEmit('create_file', longer, first.nextState);
  assert.equal(second.emit, true);

  const paddedSameShape = `${longer}${'x'.repeat(80)}`;
  const third = resolveStreamingToolPreviewEmit('create_file', paddedSameShape, second.nextState);
  assert.equal(third.emit, true);
});

test('resolveStreamingToolPreviewEmit repeats edit_file when line delta changes', () => {
  const partial = '{"path":"README.md","old_text":"a\\nb","new_text":"a\\nb\\nc';
  const first = resolveStreamingToolPreviewEmit('edit_file', partial, {
    readyPreviewEmitted: false,
  });
  assert.equal(first.emit, true);

  const withExtraLine = `${partial}\\nd`;
  const second = resolveStreamingToolPreviewEmit('edit_file', withExtraLine, first.nextState);
  assert.equal(second.emit, true);

  const paddedSameDelta = `${withExtraLine}${'x'.repeat(500)}`;
  const third = resolveStreamingToolPreviewEmit('edit_file', paddedSameDelta, second.nextState);
  assert.equal(third.emit, false);
});
