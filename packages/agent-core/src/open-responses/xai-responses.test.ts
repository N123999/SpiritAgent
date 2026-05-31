import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { JsonValue } from '../ports.js';
import { AiSdkOpenResponsesTransport } from './ai-sdk-transport.js';
import { buildResponsesProviderOptions } from './model-factory.js';
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

test('xAI responses transport rejects local function tools with clear guidance', async () => {
  const transport = new AiSdkOpenResponsesTransport();
  const result = await transport.startToolAgentRound(
    xaiConfig,
    { messages: [{ role: 'user', content: 'call a tool' }], steps: 0 },
    [demoToolDefinition()],
  );

  assert.equal(result.kind, 'failure');
  assert.match(result.kind === 'failure' ? result.error : '', /不支持本地 function tools/u);
  const trace = result.requestTrace[0];
  assert.equal(
    trace && typeof trace === 'object' && !Array.isArray(trace) ? trace.kind : undefined,
    'xai_sdk_responses',
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
