import assert from 'node:assert/strict';
import test from 'node:test';
import type { TextStreamPart } from 'ai';

import type { ToolAgentRoundCompletion } from '../ports.js';
import type { ToolAgentState } from '../tool-agent.js';
import { createDeferred, responsesEventStreamToRuntimeEvents } from './streaming.js';
import type { OpenResponsesTransportConfig } from './responses-compat.js';

const config: OpenResponsesTransportConfig = {
  transportKind: 'open-responses',
  apiKey: 'test',
  model: 'openrouter/auto',
  llmVendor: 'openrouter',
  responsesProvider: 'open-responses-compatible',
};

async function collectThinkingChunks(
  stream: AsyncIterable<TextStreamPart<any>>,
): Promise<string[]> {
  const state: ToolAgentState = { messages: [], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const chunks: string[] = [];

  for await (const event of responsesEventStreamToRuntimeEvents(
    config,
    stream,
    state,
    [],
    completion,
  )) {
    if (event.kind === 'thinking-chunk') {
      chunks.push(event.text);
    }
  }

  await completion.promise;
  return chunks;
}

test('responses streaming ignores duplicate raw reasoning when reasoning-delta exists', async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield {
      type: 'raw',
      rawValue: {
        type: 'response.reasoning_text.delta',
        delta: 'The',
      },
    };
    yield { type: 'reasoning-delta', id: 'rs_1', text: 'The' };
    yield { type: 'reasoning-delta', id: 'rs_1', text: ' user' };
    yield { type: 'text-delta', id: 't1', text: 'OK' };
    yield {
      type: 'raw',
      rawValue: {
        type: 'response.completed',
        response: { id: 'resp-dedup' },
      },
    };
  }

  const chunks = await collectThinkingChunks(stream());
  assert.deepEqual(chunks, ['The', ' user']);
});

test('responses streaming uses only the first reasoning-delta item id', async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield { type: 'reasoning-delta', id: 'rs_summary', text: 'Plan.' };
    yield { type: 'reasoning-delta', id: 'rs_full', text: ' Full reasoning.' };
    yield { type: 'text-delta', id: 't2', text: 'Done' };
    yield {
      type: 'raw',
      rawValue: {
        type: 'response.completed',
        response: { id: 'resp-one-item' },
      },
    };
  }

  const chunks = await collectThinkingChunks(stream());
  assert.deepEqual(chunks, ['Plan.']);
});
