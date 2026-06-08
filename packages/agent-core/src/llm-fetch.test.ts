import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSpiritAgentUserAgent,
  configureLlmClientVersion,
  configureLlmHttpVersion,
  getLlmClientVersion,
  getLlmFetch,
  getLlmHttpVersion,
  mergeLlmFetchInit,
  normalizeLlmHttpVersion,
  setLlmFetchTransportOverrideForTests,
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

test('buildSpiritAgentUserAgent formats product and version', () => {
  assert.equal(buildSpiritAgentUserAgent('1.2.3'), 'SpiritAgent/1.2.3');
  assert.equal(buildSpiritAgentUserAgent(' 0.1.0 '), 'SpiritAgent/0.1.0');
});

test('configureLlmClientVersion updates getLlmClientVersion and ignores empty strings', () => {
  configureLlmClientVersion('2.0.0');
  assert.equal(getLlmClientVersion(), '2.0.0');
  configureLlmClientVersion('   ');
  assert.equal(getLlmClientVersion(), '2.0.0');
  configureLlmClientVersion('0.1.0');
});

test('mergeLlmFetchInit sets User-Agent from record headers', () => {
  configureLlmClientVersion('1.0.0');
  const merged = mergeLlmFetchInit({
    method: 'POST',
    headers: {
      Authorization: 'Bearer token',
    },
  });
  assert.equal(merged.method, 'POST');
  assert.ok(merged.headers instanceof Headers);
  assert.equal((merged.headers as Headers).get('Authorization'), 'Bearer token');
  assert.equal((merged.headers as Headers).get('User-Agent'), 'SpiritAgent/1.0.0');
});

test('mergeLlmFetchInit sets User-Agent from Headers instance without mutating source', () => {
  configureLlmClientVersion('3.4.5');
  const source = new Headers({ 'Content-Type': 'application/json' });
  const merged = mergeLlmFetchInit({ headers: source });
  assert.equal(source.get('User-Agent'), null);
  assert.equal((merged.headers as Headers).get('Content-Type'), 'application/json');
  assert.equal((merged.headers as Headers).get('User-Agent'), 'SpiritAgent/3.4.5');
});

test('mergeLlmFetchInit overwrites existing User-Agent', () => {
  configureLlmClientVersion('9.9.9');
  const merged = mergeLlmFetchInit({
    headers: {
      'User-Agent': 'other-client/1.0',
    },
  });
  assert.equal((merged.headers as Headers).get('User-Agent'), 'SpiritAgent/9.9.9');
});

test('getLlmFetch applies SpiritAgent User-Agent on outbound calls', async () => {
  configureLlmClientVersion('4.5.6');
  let capturedInit: RequestInit | undefined;
  setLlmFetchTransportOverrideForTests(async (_input, init) => {
    capturedInit = init;
    return new Response('ok');
  });
  try {
    await getLlmFetch()('https://example.com/v1/chat/completions', { method: 'POST' });
    assert.ok(capturedInit?.headers instanceof Headers);
    assert.equal((capturedInit.headers as Headers).get('User-Agent'), 'SpiritAgent/4.5.6');
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});
