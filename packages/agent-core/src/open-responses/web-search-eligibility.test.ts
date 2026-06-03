import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProviderWebSearchPromptSection,
  resolveProviderWebSearchMode,
  shouldUseProviderWebSearch,
  XAI_WEB_SEARCH_WITH_LOCAL_TOOLS_ENABLED,
} from './web-search-eligibility.js';

test('resolveProviderWebSearchMode excludes moonshot-ai chat', () => {
  assert.equal(
    resolveProviderWebSearchMode({
      transportKind: 'openai-compatible',
      apiKey: 'k',
      model: 'kimi-k2.5',
      llmVendor: 'moonshot-ai',
    }),
    undefined,
  );
});

test('resolveProviderWebSearchMode openai official responses', () => {
  assert.equal(
    resolveProviderWebSearchMode({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'gpt-5.4',
      llmVendor: 'openai',
      responsesProvider: 'openai',
    }),
    'openai-sdk-web-search',
  );
});

test('resolveProviderWebSearchMode xai when enabled', () => {
  assert.equal(
    resolveProviderWebSearchMode({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'grok-4',
      llmVendor: 'xai',
      responsesProvider: 'xai',
    }),
    XAI_WEB_SEARCH_WITH_LOCAL_TOOLS_ENABLED ? 'xai-sdk-web-search' : undefined,
  );
});

test('resolveProviderWebSearchMode excludes vercel gateway', () => {
  assert.equal(
    resolveProviderWebSearchMode({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'openai/gpt-5.4',
      llmVendor: 'vercel-ai-gateway',
    }),
    undefined,
  );
  assert.equal(
    shouldUseProviderWebSearch({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'openai/gpt-5.4',
      llmVendor: 'vercel-ai-gateway',
    }),
    false,
  );
});

test('resolveProviderWebSearchMode alibaba open-responses', () => {
  assert.equal(
    resolveProviderWebSearchMode({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'qwen3-max',
      llmVendor: 'alibaba',
    }),
    'alibaba-responses-built-in-tools',
  );
  assert.equal(
    shouldUseProviderWebSearch({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'qwen3-max',
      llmVendor: 'alibaba',
    }),
    true,
  );
});

test('resolveProviderWebSearchMode excludes openai-compatible openai vendor', () => {
  assert.equal(
    resolveProviderWebSearchMode({
      apiKey: 'k',
      model: 'gpt-4.1',
      llmVendor: 'openai',
    }),
    undefined,
  );
});

test('buildProviderWebSearchPromptSection mentions web search for openai responses', () => {
  const section = buildProviderWebSearchPromptSection({
    transportKind: 'open-responses',
    apiKey: 'k',
    model: 'gpt-5.4',
    llmVendor: 'openai',
    responsesProvider: 'openai',
  });
  assert.match(section ?? '', /web search/i);
});

test('buildProviderWebSearchPromptSection omits alibaba', () => {
  assert.equal(
    buildProviderWebSearchPromptSection({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'qwen3-max',
      llmVendor: 'alibaba',
    }),
    undefined,
  );
});
