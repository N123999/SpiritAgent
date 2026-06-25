import assert from 'node:assert/strict';
import test from 'node:test';
import type { TextStreamPart } from 'ai';

import type { ToolAgentRoundCompletion } from '../ports.js';
import type { ToolAgentState } from '../tool-agent.js';
import { createDeferred, responsesEventStreamToRuntimeEvents } from './streaming.js';
import type { OpenResponsesTransportConfig } from './responses-compat.js';

const gatewayGeminiConfig: OpenResponsesTransportConfig = {
  transportKind: 'open-responses',
  apiKey: 'test',
  model: 'google/gemini-3.1-pro-preview',
  llmVendor: 'vercel-ai-gateway',
};

async function collectThinkingChunks(
  config: OpenResponsesTransportConfig,
  stream: AsyncIterable<TextStreamPart<any>>,
): Promise<string[]> {
  const state: ToolAgentState = { messages: [], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const chunks: string[] = [];

  for await (const event of responsesEventStreamToRuntimeEvents(
    config,
    stream,
    {},
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

test('gateway gemini streaming maps reasoning-delta to thinking-chunk', async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield { type: 'reasoning-delta', id: 'thought_1', text: 'Sum primes.' };
    yield { type: 'reasoning-delta', id: 'thought_1', text: ' Check list.' };
    yield { type: 'text-delta', id: 't1', text: 'The answer is 129.' };
    yield {
      type: 'raw',
      rawValue: {
        type: 'response.completed',
        response: { id: 'resp-gateway-gemini' },
      },
    };
  }

  const chunks = await collectThinkingChunks(gatewayGeminiConfig, stream());
  assert.deepEqual(chunks, ['Sum primes.', ' Check list.']);
});
