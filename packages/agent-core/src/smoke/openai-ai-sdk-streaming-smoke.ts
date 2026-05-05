import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { JsonValue } from '../ports.js';
import { AiSdkOpenAiTransport } from '../openai/ai-sdk-transport.js';
import { startOpenAiToolAgentState } from '../openai/tool-agent-helpers.js';

import { demoLookupToolDefinition, printSmokeSection } from './openai-shared.js';

async function main(): Promise<void> {
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });

    const chunks = [
      {
        id: 'chatcmpl-ai-sdk-stream',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'test-openai-compatible',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_ai_sdk_stream_1',
                  type: 'function',
                  function: {
                    name: 'demo_lookup',
                    arguments: '{"query"',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-ai-sdk-stream',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'test-openai-compatible',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: ':"Spirit Agent streaming"}',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-ai-sdk-stream',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'test-openai-compatible',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ];

    for (const chunk of chunks) {
      response.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    response.write('data: [DONE]\n\n');
    response.end();
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('无法获取本地 smoke server 端口。');
  }

  const transport = new AiSdkOpenAiTransport();
  const state = startOpenAiToolAgentState(
    [],
    'Call demo_lookup exactly once.',
    process.cwd(),
    [],
    [],
    [],
    'test-openai-compatible',
  );
  const started = await transport.startToolAgentRoundStreaming(
    {
      apiKey: 'test-key',
      model: 'test-openai-compatible',
      baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
    },
    state,
    demoLookupToolDefinition(),
  );

  const events = await collectEvents(started.eventStream);
  const completion = await started.completion;
  server.close();

  printSmokeSection('ai-sdk streaming smoke events', events);
  printSmokeSection('ai-sdk streaming smoke completion', completion);

  if (!events.some((event) => isJsonObject(event) && event.kind === 'streaming-tool-preview')) {
    throw new Error('ai-sdk streaming smoke 未收到 streaming-tool-preview 事件。');
  }

  if (events.some((event) => isJsonObject(event) && event.kind === 'error')) {
    throw new Error('ai-sdk streaming smoke 不应收到 error 事件。');
  }

  if (completion.kind !== 'success' || completion.result.step.kind !== 'tool-calls') {
    throw new Error('ai-sdk streaming smoke 未进入预期的 tool-calls。');
  }

  const assistantMessage = completion.result.state.messages.at(-1);
  if (!isJsonObject(assistantMessage) || assistantMessage.reasoning_content !== '') {
    throw new Error('ai-sdk streaming smoke 未在 assistant tool_call message 上保留空 reasoning_content。');
  }

  const streamedToolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];
  const firstToolCall = streamedToolCalls[0];
  if (!isJsonObject(firstToolCall) || firstToolCall.index !== 0) {
    throw new Error('ai-sdk streaming smoke 未在流式 tool_call 上保留 index 字段。');
  }
}

async function collectEvents(stream: AsyncIterable<{ kind: string } & Record<string, unknown>>): Promise<JsonValue[]> {
  const events: JsonValue[] = [];
  for await (const event of stream) {
    events.push(event as unknown as JsonValue);
  }
  return events;
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`openai ai-sdk streaming smoke failed: ${message}`);
  process.exitCode = 1;
});