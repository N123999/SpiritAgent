import assert from 'node:assert/strict';
import test from 'node:test';

import {
  configureLlmHttpVersion,
  getLlmHttpVersion,
  normalizeLlmHttpVersion,
} from './llm-fetch.js';

test('normalizeLlmHttpVersion accepts common aliases and defaults to http2', () => {
  assert.equal(normalizeLlmHttpVersion('http1.1'), 'http1.1');
  assert.equal(normalizeLlmHttpVersion('HTTP/1.1'), 'http1.1');
  assert.equal(normalizeLlmHttpVersion('http2'), 'http2');
  assert.equal(normalizeLlmHttpVersion('h2'), 'http2');
  assert.equal(normalizeLlmHttpVersion('unknown'), 'http2');
  assert.equal(normalizeLlmHttpVersion(undefined), 'http2');
});

test('configureLlmHttpVersion updates getLlmHttpVersion', () => {
  configureLlmHttpVersion('http1.1');
  assert.equal(getLlmHttpVersion(), 'http1.1');
  configureLlmHttpVersion('http2');
  assert.equal(getLlmHttpVersion(), 'http2');
});
