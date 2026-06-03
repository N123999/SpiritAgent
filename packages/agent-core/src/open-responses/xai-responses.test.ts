import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { JsonValue } from '../ports.js';
import { buildResponsesTraceTools } from './apply-patch-bridge.js';
import { buildResponsesProviderOptions } from './model-factory.js';
import {
  XAI_WEB_SEARCH_WITH_LOCAL_TOOLS_ENABLED,
  xaiResponsesRejectsLocalFunctionTools,
} from './web-search-eligibility.js';
import {
  buildOpenResponsesRequestTrace,
  resolveOpenResponsesSdkProvider,
  type OpenResponsesTransportConfig,
} from './responses-compat.js';

const xaiConfig: OpenResponsesTransportConfig = {
  transportKind: 'open-responses',
  apiKey: 'test-key',
  model: 'grok-4.3',
  baseUrl: 'https://api.x.ai/v1',
  llmVendor: 'xai',
  reasoningEffort: 'medium',
};

test('xAI responses provider resolves official SDK, options, and trace kind', () => {
  assert.equal(resolveOpenResponsesSdkProvider(xaiConfig), 'xai');
  assert.deepEqual(buildResponsesProviderOptions(xaiConfig), {
    xai: { reasoningEffort: 'medium' },
  });

  const trace = buildOpenResponsesRequestTrace(
    xaiConfig,
    1,
    [{ role: 'user', content: 'hello' }],
    [],
  )[0];
  assert.equal(
    trace && typeof trace === 'object' && !Array.isArray(trace) ? trace.kind : undefined,
    'xai_sdk_responses',
  );
});

test('xAI responses allows local function tools when provider web search is enabled', () => {
  assert.equal(XAI_WEB_SEARCH_WITH_LOCAL_TOOLS_ENABLED, true);
  assert.equal(xaiResponsesRejectsLocalFunctionTools(xaiConfig, 1), false);
});

test('xAI responses trace lists web_search alongside host tools when eligible', () => {
  const traceTools = buildResponsesTraceTools(xaiConfig, [demoToolDefinition()]);
  assert.ok(
    traceTools.some(
      (tool) =>
        typeof tool === 'object'
        && tool !== null
        && !Array.isArray(tool)
        && (tool as { type?: string }).type === 'web_search',
    ),
  );
});

function demoToolDefinition(): JsonValue {
  return {
    type: 'function',
    function: {
      name: 'demo_lookup',
      description: 'Lookup demo data.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  };
}
