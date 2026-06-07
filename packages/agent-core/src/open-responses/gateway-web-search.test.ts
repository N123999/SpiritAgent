import assert from 'node:assert/strict';
import test from 'node:test';

import type { JsonValue } from '../ports.js';
import { buildResponsesTraceTools } from './apply-patch-bridge.js';
import {
  buildGatewayWebSearchTool,
  buildGatewayWebSearchTraceToolEntry,
  shouldUseGatewayWebSearch,
} from './gateway-web-search.js';
import { buildResponsesGenerateTools } from './model-factory.js';
import {
  resolveProviderWebSearchMode,
  shouldUseProviderWebSearch,
} from './web-search-eligibility.js';
import type { OpenResponsesTransportConfig } from './responses-compat.js';

const gatewayConfig: OpenResponsesTransportConfig = {
  transportKind: 'open-responses',
  apiKey: 'test-key',
  model: 'openai/gpt-5.4',
  llmVendor: 'vercel-ai-gateway',
};

const hostTool = {
  type: 'function',
  function: {
    name: 'grep',
    description: 'search',
    parameters: { type: 'object', properties: {} },
  },
} as const;

test('shouldUseGatewayWebSearch matches vercel-ai-gateway open-responses', () => {
  assert.equal(shouldUseGatewayWebSearch(gatewayConfig), true);
  assert.equal(
    shouldUseGatewayWebSearch({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'openai/gpt-5.4',
      llmVendor: 'openrouter',
    }),
    false,
  );
});

test('resolveProviderWebSearchMode enables gateway-sdk-web-search', () => {
  assert.equal(resolveProviderWebSearchMode(gatewayConfig), 'gateway-sdk-web-search');
  assert.equal(shouldUseProviderWebSearch(gatewayConfig), true);
});

test('buildGatewayWebSearchTool returns provider tool with gateway perplexity id', () => {
  const tool = buildGatewayWebSearchTool(gatewayConfig) as {
    type?: string;
    id?: string;
  };
  assert.equal(tool.type, 'provider');
  assert.equal(tool.id, 'gateway.perplexity_search');
});

test('buildResponsesGenerateTools adds web_search for gateway', () => {
  const tools = buildResponsesGenerateTools(gatewayConfig, [hostTool]);
  assert.ok('web_search' in tools);
  assert.ok('grep' in tools);
});

test('buildGatewayWebSearchTraceToolEntry names web_search for UI parity', () => {
  assert.deepEqual(buildGatewayWebSearchTraceToolEntry(), {
    type: 'provider_tool',
    id: 'gateway.perplexity_search',
    name: 'web_search',
  });
});

test('gateway responses trace lists web_search alongside host tools when eligible', () => {
  const traceTools = buildResponsesTraceTools(gatewayConfig, [hostTool as JsonValue]);
  assert.ok(
    traceTools.some(
      (tool) =>
        typeof tool === 'object'
        && tool !== null
        && !Array.isArray(tool)
        && (tool as { id?: string }).id === 'gateway.perplexity_search'
        && (tool as { name?: string }).name === 'web_search',
    ),
  );
});
