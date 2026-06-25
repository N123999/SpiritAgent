import assert from 'node:assert/strict';
import test from 'node:test';

import { buildResponsesGenerateTools, buildResponsesProviderOptions } from './model-factory.js';

const hostTool = {
  type: 'function',
  function: {
    name: 'grep',
    description: 'search',
    parameters: { type: 'object', properties: {} },
  },
} as const;

test('buildResponsesGenerateTools adds web_search for openai official', () => {
  const tools = buildResponsesGenerateTools(
    {
      transportKind: 'open-responses',
      apiKey: 'test-key',
      model: 'gpt-5.4',
      llmVendor: 'openai',
      responsesProvider: 'openai',
    },
    [hostTool],
  );

  assert.ok('web_search' in tools);
  assert.ok('grep' in tools);
});

test('buildResponsesGenerateTools adds web_search for gateway', () => {
  const tools = buildResponsesGenerateTools(
    {
      transportKind: 'open-responses',
      apiKey: 'test-key',
      model: 'openai/gpt-5.4',
      llmVendor: 'vercel-ai-gateway',
    },
    [hostTool],
  );

  assert.ok('web_search' in tools);
  assert.ok('grep' in tools);
});

test('buildResponsesGenerateTools uses function apply_patch for Bedrock Mantle', () => {
  const tools = buildResponsesGenerateTools(
    {
      transportKind: 'open-responses',
      apiKey: 'test-key',
      model: 'openai.gpt-5.5',
      baseUrl: 'https://bedrock-mantle.us-east-2.api.aws/openai/v1',
      llmVendor: 'openai',
      responsesProvider: 'openai',
    },
    [hostTool],
  );

  assert.ok('apply_patch' in tools);
  assert.equal('grep' in tools, true);
});

test('buildResponsesGenerateTools omits sdk web_search for Bedrock Mantle', () => {
  const tools = buildResponsesGenerateTools(
    {
      transportKind: 'open-responses',
      apiKey: 'test-key',
      model: 'openai.gpt-5.5',
      baseUrl: 'https://bedrock-mantle.us-east-2.api.aws/openai/v1',
      llmVendor: 'openai',
      responsesProvider: 'openai',
    },
    [hostTool],
  );

  assert.equal('web_search' in tools, false);
  assert.ok('grep' in tools);
});

test('buildResponsesGenerateTools omits sdk web_search for openrouter', () => {
  const tools = buildResponsesGenerateTools(
    {
      transportKind: 'open-responses',
      apiKey: 'test-key',
      model: 'openai/gpt-4o',
      llmVendor: 'openrouter',
    },
    [hostTool],
  );

  assert.equal('web_search' in tools, false);
  assert.ok('grep' in tools);
});

test('buildResponsesGenerateTools adds web_search for xai when enabled', () => {
  const tools = buildResponsesGenerateTools(
    {
      transportKind: 'open-responses',
      apiKey: 'test-key',
      model: 'grok-4',
      llmVendor: 'xai',
      responsesProvider: 'xai',
    },
    [hostTool],
  );

  assert.ok('web_search' in tools);
});

test('buildResponsesProviderOptions maps gateway openai reasoning options', () => {
  const options = buildResponsesProviderOptions({
    transportKind: 'open-responses',
    apiKey: 'test-key',
    model: 'openai/gpt-5.4',
    llmVendor: 'vercel-ai-gateway',
    reasoningEffort: 'medium',
  });

  assert.deepEqual(options, {
    openai: {
      reasoningEffort: 'medium',
      reasoningSummary: 'auto',
    },
  });
});

test('buildResponsesProviderOptions maps gateway anthropic claude to adaptive thinking', () => {
  assert.deepEqual(
    buildResponsesProviderOptions({
      transportKind: 'open-responses',
      apiKey: 'test-key',
      model: 'anthropic/claude-sonnet-4.6',
      llmVendor: 'vercel-ai-gateway',
      reasoningEffort: 'medium',
    }),
    {
      anthropic: {
        toolStreaming: true,
        thinking: { type: 'adaptive' },
        effort: 'medium',
      },
    },
  );
});

test('buildResponsesProviderOptions maps gateway anthropic opus 4.8 to summarized adaptive thinking', () => {
  assert.deepEqual(
    buildResponsesProviderOptions({
      transportKind: 'open-responses',
      apiKey: 'test-key',
      model: 'anthropic/claude-opus-4.8',
      llmVendor: 'vercel-ai-gateway',
      reasoningEffort: 'medium',
    }),
    {
      anthropic: {
        toolStreaming: true,
        thinking: { type: 'adaptive', display: 'summarized' },
        effort: 'medium',
      },
    },
  );
});

test('buildResponsesProviderOptions maps azure provider options', () => {
  const options = buildResponsesProviderOptions({
    transportKind: 'open-responses',
    apiKey: 'test-key',
    model: 'my-deploy',
    llmVendor: 'azure',
    responsesProvider: 'azure',
    azureResourceName: 'my-resource',
    reasoningEffort: 'low',
    store: false,
  });

  assert.deepEqual(options, {
    azure: {
      store: false,
      truncation: 'disabled',
      reasoningEffort: 'low',
      reasoningSummary: 'auto',
    },
  });
});
