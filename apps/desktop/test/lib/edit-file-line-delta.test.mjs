import assert from 'node:assert/strict';
import test from 'node:test';

import {
  editFileLineDeltaFromArgumentsJson,
  lineChangeCounts,
  toolLineDeltaFromArgumentsJson,
  toolLineDeltaFromRequest,
  tryExtractPartialJsonStringValue,
} from '../../src/lib/edit-file-line-delta.ts';

test('lineChangeCounts uses line-level LCS', () => {
  assert.deepEqual(lineChangeCounts('a\nb', 'a\nc\nd'), { removed: 1, added: 2 });
  assert.deepEqual(lineChangeCounts('same', 'same'), { removed: 0, added: 0 });
});

test('tryExtractPartialJsonStringValue reads in-flight old_text', () => {
  const partial = '{"path":"x.ts","old_text":"line one\\nline two","new_text":"line';
  assert.equal(tryExtractPartialJsonStringValue(partial, 'old_text'), 'line one\nline two');
  assert.equal(tryExtractPartialJsonStringValue(partial, 'new_text'), 'line');
});

test('editFileLineDeltaFromArgumentsJson updates while new_text streams', () => {
  const partial = '{"path":"m.ts","old_text":"a\\nb","new_text":"a\\nc\\n';
  const delta = editFileLineDeltaFromArgumentsJson(partial);
  assert.deepEqual(delta, { removed: 1, added: 2 });
});

test('editFileLineDeltaFromArgumentsJson parses complete JSON', () => {
  const json = JSON.stringify({
    path: 'm.ts',
    old_text: 'x',
    new_text: 'x\ny',
  });
  assert.deepEqual(editFileLineDeltaFromArgumentsJson(json), { removed: 0, added: 1 });
});

test('create_file line delta counts new content lines', () => {
  assert.deepEqual(
    toolLineDeltaFromRequest('create_file', { path: 'a.ts', content: 'one\ntwo' }),
    { added: 2, removed: 0 },
  );
});

test('create_plan partial content streams in', () => {
  const partial = '{"name":"plan","content":"line one';
  assert.deepEqual(toolLineDeltaFromArgumentsJson('create_plan', partial), {
    added: 1,
    removed: 0,
  });
});
