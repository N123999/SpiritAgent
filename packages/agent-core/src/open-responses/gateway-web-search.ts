import { createGateway } from '@ai-sdk/gateway';

import { getLlmFetch } from '../llm-fetch.js';
import type { JsonObject } from '../ports.js';
import type { OpenResponsesTransportConfig } from './responses-compat.js';

export function shouldUseGatewayWebSearch(config: OpenResponsesTransportConfig): boolean {
  return config.llmVendor === 'vercel-ai-gateway';
}

export function buildGatewayWebSearchTool(config: OpenResponsesTransportConfig): unknown {
  return createGateway({ apiKey: config.apiKey, fetch: getLlmFetch() }).tools.perplexitySearch();
}

export function buildGatewayResponsesWebSearchToolRequestEntry(): JsonObject {
  return {
    type: 'provider',
    id: 'gateway.perplexity_search',
    args: {},
  };
}

export function buildGatewayWebSearchTraceToolEntry(): JsonObject {
  return {
    type: 'provider_tool',
    id: 'gateway.perplexity_search',
    name: 'web_search',
  };
}
