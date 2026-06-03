import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAlibabaChatCompletionsExtraBody,
  buildAlibabaResponsesBuiltInTools,
  mergeAlibabaResponsesBuiltInTools,
  shouldUseAlibabaChatCompletionsBuiltInTools,
  shouldUseAlibabaBuiltInTools,
  shouldUseAlibabaResponsesBuiltInTools,
} from './alibaba-built-in-tools.js';

test('shouldUseAlibabaBuiltInTools for alibaba chat and responses', () => {
  assert.equal(
    shouldUseAlibabaBuiltInTools({
      apiKey: 'k',
      model: 'qwen3-max',
      llmVendor: 'alibaba',
    }),
    true,
  );
  assert.equal(
    shouldUseAlibabaBuiltInTools({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'qwen3-max',
      llmVendor: 'alibaba',
    }),
    true,
  );
  assert.equal(
    shouldUseAlibabaBuiltInTools({
      apiKey: 'k',
      model: 'gpt-4.1',
      llmVendor: 'openai',
    }),
    false,
  );
});

test('shouldUseAlibabaChatCompletionsBuiltInTools only for alibaba chat transport', () => {
  assert.equal(
    shouldUseAlibabaChatCompletionsBuiltInTools({
      apiKey: 'k',
      model: 'qwen3-max',
      llmVendor: 'alibaba',
    }),
    true,
  );
  assert.equal(
    shouldUseAlibabaChatCompletionsBuiltInTools({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'qwen3-max',
      llmVendor: 'alibaba',
    }),
    false,
  );
});

test('buildAlibabaChatCompletionsExtraBody search-only when not streaming', () => {
  assert.deepEqual(buildAlibabaChatCompletionsExtraBody({ streaming: false }), {
    enable_search: true,
  });
});

test('shouldUseAlibabaResponsesBuiltInTools only for open-responses alibaba', () => {
  assert.equal(
    shouldUseAlibabaResponsesBuiltInTools({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'qwen3-max',
      llmVendor: 'alibaba',
    }),
    true,
  );
  assert.equal(
    shouldUseAlibabaResponsesBuiltInTools({
      apiKey: 'k',
      model: 'qwen3-max',
      llmVendor: 'alibaba',
    }),
    false,
  );
});

test('buildAlibabaChatCompletionsExtraBody streaming bundle', () => {
  const body = buildAlibabaChatCompletionsExtraBody({ streaming: true });
  assert.equal(body.enable_search, true);
  assert.equal(body.enable_thinking, true);
  assert.equal(body.enable_code_interpreter, true);
  assert.deepEqual(body.search_options, { search_strategy: 'agent_max' });
});

test('buildAlibabaResponsesBuiltInTools returns two builtin types', () => {
  const tools = buildAlibabaResponsesBuiltInTools();
  assert.equal(tools.length, 2);
  assert.deepEqual(
    tools.map((tool) => tool.type),
    ['web_search', 'code_interpreter'],
  );
});

test('mergeAlibabaResponsesBuiltInTools does not duplicate', () => {
  const merged = mergeAlibabaResponsesBuiltInTools([
    { type: 'function', function: { name: 'grep', parameters: {} } },
    { type: 'web_search' },
  ]);
  const types = merged
    .map((tool) => (typeof tool === 'object' && tool !== null && !Array.isArray(tool)
      ? (tool as { type?: string }).type
      : undefined))
    .filter((type): type is string => typeof type === 'string');
  assert.equal(types.filter((type) => type === 'web_search').length, 1);
  assert.ok(types.includes('code_interpreter'));
  assert.ok(types.includes('function'));
});
