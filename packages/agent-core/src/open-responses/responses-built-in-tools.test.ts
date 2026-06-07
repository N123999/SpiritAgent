import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accumulateResponsesBuiltInToolPreviewsFromRawChunk,
  buildGatewaySdkProviderBuiltinToolResultArgumentsJson,
  buildResponsesBuiltInToolArgumentsJson,
  buildResponsesBuiltInToolCardData,
  isGenericProviderWebSearchQuery,
  isResponsesBuiltInToolName,
  parseResponsesBuiltInToolUiFromArgumentsJson,
  resolveResponsesBuiltInToolStreamPhase,
  resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson,
  responsesBuiltInToolNameFromOutputItemType,
} from './responses-built-in-tools.js';

test('responsesBuiltInToolNameFromOutputItemType maps Responses output items', () => {
  assert.equal(responsesBuiltInToolNameFromOutputItemType('web_search_call'), 'web_search');
  assert.equal(responsesBuiltInToolNameFromOutputItemType('web_extractor_call'), undefined);
  assert.equal(
    responsesBuiltInToolNameFromOutputItemType('code_interpreter_call'),
    'code_interpreter',
  );
  assert.equal(responsesBuiltInToolNameFromOutputItemType('function_call'), undefined);
});

test('isResponsesBuiltInToolName recognizes builtin tool names', () => {
  assert.equal(isResponsesBuiltInToolName('web_search'), true);
  assert.equal(isResponsesBuiltInToolName('web_fetch'), false);
});

test('buildResponsesBuiltInToolArgumentsJson extracts query and _spiritUi', () => {
  const json = buildResponsesBuiltInToolArgumentsJson(
    {
      type: 'web_search_call',
      status: 'completed',
      action: { type: 'search', query: 'DeepSeek latest generation' },
    },
    'web_search',
  );
  const parsed = JSON.parse(json) as {
    query?: string;
    status?: string;
    _spiritUi?: { headlineDetail?: string; inputExcerpt?: string };
  };
  assert.equal(parsed.query, 'DeepSeek latest generation');
  assert.equal(parsed.status, 'completed');
  assert.equal(parsed._spiritUi?.headlineDetail, undefined);
  assert.match(parsed._spiritUi?.inputExcerpt ?? '', /DeepSeek latest generation/);
});

test('isGenericProviderWebSearchQuery detects Bailian placeholder query', () => {
  assert.equal(isGenericProviderWebSearchQuery('Web search'), true);
  assert.equal(isGenericProviderWebSearchQuery('DeepSeek V4'), false);
});

test('buildResponsesBuiltInToolCardData formats web_search sources', () => {
  const card = buildResponsesBuiltInToolCardData(
    {
      type: 'web_search_call',
      status: 'completed',
      action: {
        type: 'search',
        query: 'Web search',
        sources: [
          { type: 'url', url: 'https://www.deepseek.com/' },
          { type: 'url', url: 'https://example.com/page' },
        ],
      },
    },
    'web_search',
  );
  assert.equal(card.sourceCount, 2);
  assert.equal(card.headlineDetail, undefined);
  assert.match(card.outputExcerpt ?? '', /deepseek\.com/);
  assert.equal(card.detailLines?.length, 2);
});

test('buildResponsesBuiltInToolCardData formats code_interpreter logs', () => {
  const card = buildResponsesBuiltInToolCardData(
    {
      type: 'code_interpreter_call',
      status: 'completed',
      code: 'print("hello")',
      outputs: [{ type: 'logs', logs: 'hello\n' }],
    },
    'code_interpreter',
  );
  assert.equal(card.headlineDetail, 'print("hello")');
  assert.match(card.outputExcerpt ?? '', /hello/);
  assert.match(card.inputExcerpt, /print/);
});

test('parseResponsesBuiltInToolUiFromArgumentsJson reads embedded ui', () => {
  const json = buildResponsesBuiltInToolArgumentsJson(
    {
      type: 'web_search_call',
      status: 'completed',
      action: { type: 'search', query: 'test query' },
    },
    'web_search',
  );
  const ui = parseResponsesBuiltInToolUiFromArgumentsJson(json);
  assert.equal(ui?.headlineDetail, undefined);
  assert.match(ui?.inputExcerpt ?? '', /test query/);
});

test('resolveResponsesBuiltInToolStreamPhase maps terminal statuses', () => {
  assert.equal(
    resolveResponsesBuiltInToolStreamPhase({ type: 'web_search_call', status: 'completed' }),
    'succeeded',
  );
  assert.equal(
    resolveResponsesBuiltInToolStreamPhase({ type: 'web_search_call', status: 'in_progress' }),
    'preview',
  );
  assert.equal(
    resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(
      JSON.stringify({ status: 'completed', query: 'test' }),
    ),
    'succeeded',
  );
});

test('buildGatewaySdkProviderBuiltinToolResultArgumentsJson marks completed with output', () => {
  const json = buildGatewaySdkProviderBuiltinToolResultArgumentsJson(
    'web_search',
    { query: 'latest models', max_results: 10 },
    {
      results: [
        { title: 'Example', url: 'https://example.com/page', snippet: 'hello' },
      ],
      id: 'search-1',
    },
    false,
  );
  assert.ok(json);
  assert.equal(resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(json!), 'succeeded');
  const ui = parseResponsesBuiltInToolUiFromArgumentsJson(json!);
  assert.match(ui?.outputExcerpt ?? '', /example\.com/);
  assert.equal(ui?.sourceCount, 1);
});

test('buildGatewaySdkProviderBuiltinToolResultArgumentsJson marks failed on tool-error', () => {
  const json = buildGatewaySdkProviderBuiltinToolResultArgumentsJson(
    'web_search',
    { query: 'latest models' },
    { error: 'search failed' },
    true,
  );
  assert.ok(json);
  assert.equal(resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(json!), 'failed');
});

test('accumulateResponsesBuiltInToolPreviewsFromRawChunk marks completed on output_item.done', () => {
  const result = accumulateResponsesBuiltInToolPreviewsFromRawChunk(
    {
      type: 'response.output_item.done',
      item: {
        type: 'web_search_call',
        id: 'ws_done',
        status: 'completed',
        action: { type: 'search', query: 'DeepSeek generation' },
      },
    },
    0,
  );

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.kind, 'streaming-tool-preview');
  if (result.events[0]?.kind !== 'streaming-tool-preview') {
    return;
  }
  const args = JSON.parse(result.events[0].argumentsJson) as {
    status?: string;
    _spiritUi?: { outputExcerpt?: string };
  };
  assert.equal(args.status, 'completed');
  assert.equal(
    resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(result.events[0].argumentsJson),
    'succeeded',
  );
  const ui = parseResponsesBuiltInToolUiFromArgumentsJson(result.events[0].argumentsJson);
  assert.equal(ui?.headlineDetail, undefined);
  assert.equal(ui?.sourceCount, undefined);
});
