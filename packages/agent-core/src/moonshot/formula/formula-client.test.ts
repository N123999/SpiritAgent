import assert from 'node:assert/strict';
import test from 'node:test';

import { setLlmFetchTransportOverrideForTests } from '../../llm-fetch.js';
import {
  fetchFormulaTools,
  invokeFormulaFiber,
} from './formula-client.js';
import { MOONSHOT_FORMULA_WEB_SEARCH_URI } from './formula-registry.js';

const config = {
  apiKey: 'test-key',
  baseUrl: 'https://api.moonshot.ai/v1',
};

test('fetchFormulaTools returns tools from Formula API', async () => {
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    assert.match(url, /\/formulas\/moonshot\/web-search:latest\/tools$/);
    return new Response(
      JSON.stringify({
        object: 'list',
        tools: [
          {
            type: 'function',
            function: {
              name: 'web_search',
              description: 'Search the web for information',
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string' },
                },
                required: ['query'],
              },
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  setLlmFetchTransportOverrideForTests(fetchImpl);
  try {
    const tools = await fetchFormulaTools(config, MOONSHOT_FORMULA_WEB_SEARCH_URI);
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.function.name, 'web_search');
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test('invokeFormulaFiber returns encrypted_output on success', async () => {
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    assert.match(url, /\/formulas\/moonshot\/web-search:latest\/fibers$/);
    assert.equal(init?.method, 'POST');
    const body = JSON.parse(String(init?.body)) as { name: string; arguments: string };
    assert.equal(body.name, 'web_search');
    assert.equal(body.arguments, '{"query":"latest news"}');
    return new Response(
      JSON.stringify({
        status: 'succeeded',
        context: {
          encrypted_output: '----MOONSHOT ENCRYPTED BEGIN----+nf6----MOONSHOT ENCRYPTED END----',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  setLlmFetchTransportOverrideForTests(fetchImpl);
  try {
    const result = await invokeFormulaFiber(
      config,
      MOONSHOT_FORMULA_WEB_SEARCH_URI,
      'web_search',
      '{"query":"latest news"}',
    );
    assert.deepEqual(result, {
      kind: 'succeeded',
      content: '----MOONSHOT ENCRYPTED BEGIN----+nf6----MOONSHOT ENCRYPTED END----',
    });
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test('invokeFormulaFiber falls back to output when encrypted_output is absent', async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({
      status: 'succeeded',
      context: {
        output: 'plain output',
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

  setLlmFetchTransportOverrideForTests(fetchImpl);
  try {
    const result = await invokeFormulaFiber(
      config,
      MOONSHOT_FORMULA_WEB_SEARCH_URI,
      'web_search',
      '{}',
    );
    assert.deepEqual(result, { kind: 'succeeded', content: 'plain output' });
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});

test('invokeFormulaFiber returns failed on non-succeeded status', async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({
      status: 'failed',
      context: {
        error: 'rate limited',
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

  setLlmFetchTransportOverrideForTests(fetchImpl);
  try {
    const result = await invokeFormulaFiber(
      config,
      MOONSHOT_FORMULA_WEB_SEARCH_URI,
      'web_search',
      '{}',
    );
    assert.equal(result.kind, 'failed');
    if (result.kind === 'failed') {
      assert.match(result.error, /rate limited/);
    }
  } finally {
    setLlmFetchTransportOverrideForTests(undefined);
  }
});
