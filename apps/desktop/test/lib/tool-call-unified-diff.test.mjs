import assert from 'node:assert/strict';
import test from 'node:test';

import { buildToolCallUnifiedDiff } from '../../src/lib/tool-call-unified-diff.ts';
import { refractorLanguageForPath } from '../../src/lib/refractor-tool-diff.ts';

test('buildToolCallUnifiedDiff marks new file lines as insertions', () => {
  const patch = buildToolCallUnifiedDiff('a.ts', '', 'line1\nline2\n');
  assert.match(patch, /^---/m);
  assert.match(patch, /^\+\+\+/m);
  assert.match(patch, /^\+line1$/m);
  assert.match(patch, /^\+line2$/m);
});

test('buildToolCallUnifiedDiff marks delete file lines as deletions', () => {
  const patch = buildToolCallUnifiedDiff('x.txt', 'alpha\nbeta\n', '');
  assert.match(patch, /^-alpha$/m);
  assert.match(patch, /^-beta$/m);
});

test('buildToolCallUnifiedDiff shows edit replacements', () => {
  const patch = buildToolCallUnifiedDiff('m.ts', 'a\nb\n', 'a\nc\n');
  assert.match(patch, /^-b$/m);
  assert.match(patch, /^\+c$/m);
});

test('refractorLanguageForPath maps aliases and plaintext', () => {
  assert.equal(refractorLanguageForPath('typescript'), 'typescript');
  assert.equal(refractorLanguageForPath('jsonc'), 'json');
  assert.equal(refractorLanguageForPath('shell'), 'bash');
  assert.equal(refractorLanguageForPath('plaintext'), undefined);
  assert.equal(refractorLanguageForPath('unknown-lang-xyz'), undefined);
});
