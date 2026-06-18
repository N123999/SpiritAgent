import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeGeneratedImageMarkdownRef } from './ai-sdk-transport.js';

test('normalizeGeneratedImageMarkdownRef normalizes valid managed refs', () => {
  assert.equal(
    normalizeGeneratedImageMarkdownRef('  SPIRIT://GENERATED/image/example%20image.png  '),
    'spirit://generated/image/example%20image.png',
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
    () => normalizeGeneratedImageMarkdownRef('spirit://generated/image/%2Fsecret.png'),
    /invalid generated image markdownRef/u,
  );
});