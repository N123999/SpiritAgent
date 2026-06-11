import assert from 'node:assert/strict';
import test from 'node:test';

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  deleteFileLineDeltaFromContent,
  preserveDeleteFileBaseline,
  preserveDeleteFileLineDelta,
  editFileLineDeltaFromArgumentsJson,
  lineChangeCounts,
  resolveToolLineDeltaForDisplay,
  toolLineDeltaFromArgumentsJson,
  toolLineDeltaFromRequest,
  tryExtractPartialJsonStringValue,
  tryExtractPartialPlanName,
} from '../../src/lib/edit-file-line-delta.ts';

test('lineChangeCounts uses line-level LCS', () => {
  assert.deepEqual(lineChangeCounts('a\nb', 'a\nc\nd'), { removed: 1, added: 2 });
  assert.deepEqual(lineChangeCounts('same', 'same'), { removed: 0, added: 0 });
});

test('tryExtractPartialPlanName reads in-flight plan name', () => {
  const partial = '{"name":"my-plan","content":"# ';
  assert.equal(tryExtractPartialPlanName(partial), 'my-plan');
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

test('deleteFileLineDeltaFromContent counts removed lines only', () => {
  assert.deepEqual(deleteFileLineDeltaFromContent('one\ntwo\n'), { added: 0, removed: 3 });
  assert.equal(deleteFileLineDeltaFromContent(''), undefined);
});

test('delete file line delta matches on-disk utf8 content', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'spirit-delete-delta-'));
  const filePath = path.join(workspaceRoot, 'hello.txt');
  writeFileSync(filePath, 'alpha\nbeta', 'utf8');
  const content = readFileSync(filePath, 'utf8');
  assert.deepEqual(deleteFileLineDeltaFromContent(content), { added: 0, removed: 2 });
});

test('toolLineDeltaFromRequest ignores delete_file without disk read', () => {
  assert.equal(toolLineDeltaFromRequest('delete_file', { path: 'x.ts' }), undefined);
});

test('preserveDeleteFileLineDelta keeps prior removed count after file is gone', () => {
  const prior = { added: 0, removed: 11 };
  const attached = {
    toolName: 'delete_file',
    phase: 'succeeded',
    headline: '删除 hello.txt',
    detailLines: [],
  };
  assert.deepEqual(preserveDeleteFileLineDelta('delete_file', attached, prior).editLineDelta, prior);
  assert.equal(preserveDeleteFileLineDelta('create_file', attached, prior).editLineDelta, undefined);
});

test('resolveToolLineDeltaForDisplay hides delta when tool phase is failed', () => {
  const argsExcerpt = JSON.stringify({ path: 'a.ts', content: 'line one\nline two\nline three' });
  assert.deepEqual(
    resolveToolLineDeltaForDisplay({
      toolName: 'create_file',
      phase: 'failed',
      headline: '创建',
      detailLines: [],
      argsExcerpt,
    }),
    undefined,
  );
  assert.deepEqual(
    resolveToolLineDeltaForDisplay({
      toolName: 'create_file',
      phase: 'succeeded',
      headline: '创建',
      detailLines: [],
      argsExcerpt,
    }),
    { removed: 0, added: 3 },
  );
});

test('preserveDeleteFileBaseline keeps prior text after delete succeeds', () => {
  const priorText = 'line one\nline two';
  const attached = {
    toolName: 'delete_file',
    phase: 'succeeded',
    headline: '删除 hello.txt',
    detailLines: [],
  };
  assert.equal(
    preserveDeleteFileBaseline('delete_file', attached, priorText).deleteFileBaselineText,
    priorText,
  );
  assert.equal(
    preserveDeleteFileBaseline('create_file', attached, priorText).deleteFileBaselineText,
    undefined,
  );
});
