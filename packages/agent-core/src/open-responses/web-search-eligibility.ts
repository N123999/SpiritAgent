import type { JsonObject } from '../ports.js';
import {
  isOpenResponsesTransportConfig,
  type LlmTransportConfig,
} from '../provider-config.js';
import {
  resolveOpenResponsesSdkProvider,
  type OpenResponsesTransportConfig,
} from './responses-compat.js';

/**
 * Set true when xAI Responses accepts `xai.tools.webSearch()` alongside host function tools.
 * Phase 3 enables this after the coexistence spike.
 */
export const XAI_WEB_SEARCH_WITH_LOCAL_TOOLS_ENABLED = true;

export type ProviderWebSearchMode = 'openai-sdk-web-search' | 'xai-sdk-web-search';

export function shouldUseProviderWebSearch(config: LlmTransportConfig): boolean {
  return resolveProviderWebSearchMode(config) !== undefined;
}

export function resolveProviderWebSearchMode(
  config: LlmTransportConfig,
): ProviderWebSearchMode | undefined {
  if (!isOpenResponsesTransportConfig(config)) {
    return undefined;
  }

  return resolveOpenResponsesWebSearchMode(config);
}

function resolveOpenResponsesWebSearchMode(
  config: OpenResponsesTransportConfig,
): ProviderWebSearchMode | undefined {
  const provider = resolveOpenResponsesSdkProvider(config);
  if (config.llmVendor === 'openai' && provider === 'openai') {
    return 'openai-sdk-web-search';
  }

  if (
    config.llmVendor === 'xai'
    && provider === 'xai'
    && XAI_WEB_SEARCH_WITH_LOCAL_TOOLS_ENABLED
  ) {
    return 'xai-sdk-web-search';
  }

  return undefined;
}

/** Model-visible guidance when provider-native web search is available. */
export function buildProviderWebSearchPromptSection(): string {
  return [
    'Web search on this transport:',
    'Use the provider web search capability when you need current public information.',
    'Prefer web search over guessing facts that may have changed after your knowledge cutoff.',
    'Do not invent search tools or APIs that are not declared in this request.',
  ].join('\n');
}

export function buildWebSearchResponsesTraceToolEntry(): JsonObject {
  return { type: 'web_search' };
}

/** xAI Responses rejects host function tools unless provider web search is enabled. */
export function xaiResponsesRejectsLocalFunctionTools(
  config: OpenResponsesTransportConfig,
  localFunctionToolCount: number,
): boolean {
  if (config.llmVendor !== 'xai' || localFunctionToolCount === 0) {
    return false;
  }

  return !shouldUseProviderWebSearch(config);
}
