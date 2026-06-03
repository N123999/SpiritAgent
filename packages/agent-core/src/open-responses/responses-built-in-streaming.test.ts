import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accumulateResponsesBuiltInToolPreviewsFromRawChunk,
  createResponsesBuiltInPreviewStreamState,
  resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson,
} from './responses-built-in-tools.js';

test('accumulateResponsesBuiltInToolPreviewsFromRawChunk emits preview for web_search_call', () => {
  const result = accumulateResponsesBuiltInToolPreviewsFromRawChunk(
    {
      type: 'response.output_item.added',
      item: {
        type: 'web_search_call',
        id: 'ws_1',
        status: 'in_progress',
        query: 'DeepSeek generation',
      },
    },
    0,
  );

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.kind, 'streaming-tool-preview');
  if (result.events[0]?.kind !== 'streaming-tool-preview') {
    return;
  }
  assert.equal(result.events[0].toolName, 'web_search');
  assert.equal(result.events[0].toolCallId, 'ws_1');
  assert.match(result.events[0].argumentsJson, /DeepSeek generation/);
});

test('accumulateResponsesBuiltInToolPreviewsFromRawChunk emits preview for web_search_call.in_progress', () => {
  const result = accumulateResponsesBuiltInToolPreviewsFromRawChunk(
    {
      type: 'response.web_search_call.in_progress',
      item_id: 'ws_1',
      output_index: 1,
    },
    createResponsesBuiltInPreviewStreamState(),
  );

  assert.equal(result.events.length, 1);
  if (result.events[0]?.kind !== 'streaming-tool-preview') {
    return;
  }
  assert.equal(result.events[0].toolName, 'web_search');
  assert.equal(result.events[0].toolCallId, 'ws_1');
  assert.equal(
    resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(result.events[0].argumentsJson),
    'preview',
  );
});

test('accumulateResponsesBuiltInToolPreviewsFromRawChunk preserves call id on output_item.done', () => {
  let state = createResponsesBuiltInPreviewStreamState(1);
  const inProgress = accumulateResponsesBuiltInToolPreviewsFromRawChunk(
    {
      type: 'response.web_search_call.in_progress',
      item_id: 'ws_1',
    },
    state,
  );
  state = inProgress.state;

  const result = accumulateResponsesBuiltInToolPreviewsFromRawChunk(
    {
      type: 'response.output_item.done',
      item: {
        type: 'web_search_call',
        id: 'ws_1',
        status: 'completed',
        query: 'DeepSeek generation',
      },
    },
    state,
  );

  assert.equal(result.events.length, 1);
  if (result.events[0]?.kind !== 'streaming-tool-preview') {
    return;
  }
  assert.equal(result.events[0].toolCallId, 'ws_1');
  assert.equal(result.nextPreviewIndex, 1);
});
