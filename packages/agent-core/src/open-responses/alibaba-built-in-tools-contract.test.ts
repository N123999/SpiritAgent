import assert from 'node:assert/strict';
import test from 'node:test';

import type { JsonValue } from '../ports.js';
import { buildResponsesTraceTools } from './apply-patch-bridge.js';
import { buildResponsesProviderOptions } from './model-factory.js';
import {
  xaiResponsesRejectsLocalFunctionTools,
} from './web-search-eligibility.js';
import type { OpenResponsesTransportConfig } from './responses-compat.js';

const alibabaResponsesConfig: OpenResponsesTransportConfig = {
  transportKind: 'open-responses',
  apiKey: 'test-key',
  model: 'qwen3-max',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  llmVendor: 'alibaba',
};

test('alibaba responses provider options enable thinking', () => {
  const options = buildResponsesProviderOptions(alibabaResponsesConfig);
  assert.equal(options.alibaba?.enable_thinking, true);
});

test('alibaba responses trace lists builtin tools with host function tools', () => {
  const traceTools = buildResponsesTraceTools(alibabaResponsesConfig, [demoToolDefinition()]);
  for (const type of ['web_search', 'code_interpreter'] as const) {
    assert.ok(
      traceTools.some(
        (tool) =>
          typeof tool === 'object'
          && tool !== null
          && !Array.isArray(tool)
          && (tool as { type?: string }).type === type,
      ),
      `missing ${type}`,
    );
  }
  assert.ok(
    traceTools.some(
      (tool) =>
        typeof tool === 'object'
        && tool !== null
        && !Array.isArray(tool)
        && (tool as { type?: string }).type === 'function',
    ),
  );
});

test('xai local-tool rejection does not apply to alibaba', () => {
  assert.equal(xaiResponsesRejectsLocalFunctionTools(alibabaResponsesConfig, 2), false);
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
