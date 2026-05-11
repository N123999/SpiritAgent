import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeGeneratedImageMarkdownRef } from './ai-sdk-transport.js';

test('normalizeGeneratedImageMarkdownRef normalizes valid managed refs', () => {
  assert.equal(
    normalizeGeneratedImageMarkdownRef('  SPIRIT-IMAGE://GENERATED/example%20image.png  '),
    'spirit-image://generated/example%20image.png',
  );
});

test('normalizeGeneratedImageMarkdownRef rejects empty refs', () => {
  assert.throws(
    () => normalizeGeneratedImageMarkdownRef('   '),
    /empty generated image markdownRef/u,
  );
});

test('normalizeGeneratedImageMarkdownRef rejects invalid managed refs', () => {
  assert.throws(
    () => normalizeGeneratedImageMarkdownRef('spirit-image://generated/%2Fsecret.png'),
    /invalid generated image markdownRef/u,
  );
});