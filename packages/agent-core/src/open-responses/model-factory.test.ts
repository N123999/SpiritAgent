import assert from 'node:assert/strict';
import test from 'node:test';

import { buildResponsesGenerateTools } from './model-factory.js';

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
