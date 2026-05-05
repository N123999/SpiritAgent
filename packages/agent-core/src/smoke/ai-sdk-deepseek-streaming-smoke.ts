import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { JsonValue } from '../ports.js';
import { AiSdkOpenAiCompatibleTransport } from '../openai/ai-sdk-transport.js';
import {
  appendOpenAiToolResultMessage,
  extractLastOpenAiAssistantText,
  startOpenAiToolAgentState,
} from '../openai/tool-agent-helpers.js';

import { demoLookupToolDefinition, printSmokeSection } from './ai-sdk-openai-shared.js';

async function main(): Promise<void> {
  let requestCount = 0;
  const requestBodies: JsonValue[] = [];

  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    requestBodies.push(await readJsonBody(request));
    requestCount += 1;

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });

    const chunks =
      requestCount === 1
        ? [
            {
              id: 'chatcmpl-deepseek-stream',
              object: 'chat.completion.chunk',
              created: 0,
              model: 'deepseek-v4-pro',
              choices: [
                {
                  index: 0,
                  delta: {
                    reasoning_content: '先想一下，',
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_deepseek_stream_1',
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
              id: 'chatcmpl-deepseek-stream',
              object: 'chat.completion.chunk',
              created: 0,
              model: 'deepseek-v4-pro',
              choices: [
                {
                  index: 0,
                  delta: {
                    reasoning_content: '再查工具。',
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: ':"Spirit Agent deepseek"}',
                        },
                      },
                    ],
                  },
                  finish_reason: null,
                },
              ],
            },
            {
              id: 'chatcmpl-deepseek-stream',
              object: 'chat.completion.chunk',
              created: 0,
              model: 'deepseek-v4-pro',
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: 'tool_calls',
                },
              ],
            },
          ]
        : [
            {
              id: 'chatcmpl-deepseek-stream-final',
              object: 'chat.completion.chunk',
              created: 0,
              model: 'deepseek-v4-pro',
              choices: [
                {
                  index: 0,
                  delta: {
                    content: 'AI_SDK_DEEPSEEK_OK',
                  },
                  finish_reason: null,
                },
              ],
            },
            {
              id: 'chatcmpl-deepseek-stream-final',
              object: 'chat.completion.chunk',
              created: 0,
              model: 'deepseek-v4-pro',
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: 'stop',
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

  const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}/v1`;
  const transport = new AiSdkOpenAiCompatibleTransport();
  const state = startOpenAiToolAgentState(
    [],
    'Call demo_lookup exactly once.',
    process.cwd(),
    [],
    [],
    [],
    'deepseek-v4-pro',
  );
  const started = await transport.startToolAgentRoundStreaming(
    {
      apiKey: 'test-key',
      model: 'deepseek-v4-pro',
      baseUrl,
      llmVendor: 'deepseek',
    },
    state,
    demoLookupToolDefinition(),
  );

  const firstEvents = await collectEvents(started.eventStream);
  const firstCompletion = await started.completion;

  printSmokeSection('ai-sdk deepseek streaming smoke step 1 events', firstEvents);
  printSmokeSection('ai-sdk deepseek streaming smoke step 1 completion', firstCompletion);

  if (!firstEvents.some((event) => isJsonObject(event) && event.kind === 'streaming-tool-preview')) {
    server.close();
    throw new Error('ai-sdk deepseek streaming smoke 未收到 streaming-tool-preview 事件。');
  }

  if (firstEvents.filter((event) => isJsonObject(event) && event.kind === 'thinking-chunk').length !== 2) {
    server.close();
    throw new Error('ai-sdk deepseek streaming smoke 的 thinking-chunk 数量异常，疑似发生重复累计。');
  }

  if (firstCompletion.kind !== 'success' || firstCompletion.result.step.kind !== 'tool-calls') {
    server.close();
    throw new Error('ai-sdk deepseek streaming smoke step 1 未进入预期的 tool-calls。');
  }

  const firstAssistant = firstCompletion.result.state.messages.at(-1);
  if (!isJsonObject(firstAssistant) || firstAssistant.reasoning_content !== '先想一下，再查工具。') {
    server.close();
    throw new Error('ai-sdk deepseek streaming smoke 未在 assistant tool_call message 上保留 reasoning_content。');
  }

  const resumedState = appendOpenAiToolResultMessage(
    firstCompletion.result.state,
    'call_deepseek_stream_1',
    '{"query":"Spirit Agent deepseek","result":"official provider ok"}',
  );

  const secondStarted = await transport.startToolAgentRoundStreaming(
    {
      apiKey: 'test-key',
      model: 'deepseek-v4-pro',
      baseUrl,
      llmVendor: 'deepseek',
    },
    resumedState,
    demoLookupToolDefinition(),
  );

  const secondEvents = await collectEvents(secondStarted.eventStream);
  const secondCompletion = await secondStarted.completion;
  server.close();

  printSmokeSection('ai-sdk deepseek streaming smoke step 2 events', secondEvents);
  printSmokeSection('ai-sdk deepseek streaming smoke step 2 completion', secondCompletion);

  if (secondCompletion.kind !== 'success' || secondCompletion.result.step.kind !== 'final-response-ready') {
    throw new Error('ai-sdk deepseek streaming smoke step 2 未进入预期的 final-response-ready。');
  }

  const assistantText = extractLastOpenAiAssistantText(secondCompletion.result.state)?.trim();
  if (assistantText !== 'AI_SDK_DEEPSEEK_OK') {
    throw new Error(`ai-sdk deepseek streaming smoke step 2 未拿到预期最终 assistant 文本。实际: ${assistantText ?? '<empty>'}`);
  }

  const firstRequest = requestBodies[0];
  if (!isJsonObject(firstRequest) || !isJsonObject(firstRequest.thinking) || firstRequest.thinking.type !== 'enabled') {
    throw new Error('ai-sdk deepseek streaming smoke 未在首轮请求上通过官方 DeepSeek provider 发送 thinking=enabled。');
  }

  const secondRequestAssistant = findLastAssistantWithToolCalls(requestBodies[1]);
  if (!isJsonObject(secondRequestAssistant) || secondRequestAssistant.reasoning_content !== '先想一下，再查工具。') {
    throw new Error('ai-sdk deepseek streaming smoke 未把 reasoning_content 回灌到第二轮 DeepSeek request body。');
  }

  const traceEntry = secondCompletion.result.requestTrace[0];
  if (!isJsonObject(traceEntry) || traceEntry.kind !== 'deepseek_sdk_chat_completions') {
    throw new Error('ai-sdk deepseek streaming smoke 未标记 DeepSeek 专用 request trace kind。');
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

async function readJsonBody(request: NodeJS.ReadableStream): Promise<JsonValue> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonValue;
}

function findLastAssistantWithToolCalls(requestBody: JsonValue | undefined): JsonValue | undefined {
  if (!isJsonObject(requestBody) || !Array.isArray(requestBody.messages)) {
    return undefined;
  }

  return [...requestBody.messages]
    .reverse()
    .find((message) => isJsonObject(message) && message.role === 'assistant' && Array.isArray(message.tool_calls));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk deepseek streaming smoke failed: ${message}`);
  process.exitCode = 1;
});