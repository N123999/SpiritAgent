import assert from 'node:assert/strict';
import test from 'node:test';
import type { TextStreamPart } from 'ai';

import type { JsonValue, ToolAgentRoundCompletion } from '../ports.js';
import type { ToolAgentState } from '../tool-agent.js';
import { createDeferred, responsesEventStreamToRuntimeEvents } from './streaming.js';
import type { OpenResponsesTransportConfig } from './responses-compat.js';

const config: OpenResponsesTransportConfig = {
  transportKind: 'open-responses',
  apiKey: 'test',
  model: 'test',
  responsesProvider: 'open-responses-compatible',
};

async function* streamWithDuplicateToolCallParts(): AsyncGenerator<TextStreamPart<any>> {
  yield {
    type: 'raw',
    rawValue: {
      type: 'response.output_item.added',
      item: {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_dup_test',
        name: 'shell',
        arguments: '',
        status: 'in_progress',
      },
    },
  };
  yield {
    type: 'tool-call',
    toolCallId: 'call_dup_test',
    toolName: 'shell',
    input: { command: 'sleep 5' },
  };
  yield {
    type: 'raw',
    rawValue: {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_dup_test',
        name: 'shell',
        arguments: '{"command":"sleep 5"}',
        status: 'completed',
      },
    },
  };
  yield {
    type: 'raw',
    rawValue: {
      type: 'response.completed',
      response: { id: 'resp-dedup-test' },
    },
  };
}

test('responses streaming does not duplicate tool calls when SDK emits raw and tool-call', async () => {
  const state: ToolAgentState = { messages: [], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const events: JsonValue[] = [];

  for await (const event of responsesEventStreamToRuntimeEvents(
    config,
    streamWithDuplicateToolCallParts(),
    {},
    state,
    [],
    completion,
  )) {
    events.push(event as JsonValue);
  }

  const result = await completion.promise;
  assert.equal(result.kind, 'success');
  assert.equal(result.result.step.kind, 'tool-calls');
  if (result.result.step.kind !== 'tool-calls') {
    throw new Error('expected tool-calls step');
  }

  assert.equal(result.result.step.calls.length, 1);
  assert.equal(result.result.step.calls[0]?.id, 'call_dup_test');
  assert.equal(result.result.step.calls[0]?.name, 'shell');
});
