import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { JsonValue } from '../../ports.js';
import { AiSdkOpenAiCompatibleTransport } from '../../openai/ai-sdk-transport.js';
import {
  extractLastOpenAiAssistantText,
  startOpenAiToolAgentState,
} from '../../openai/tool-agent-helpers.js';

import { printSmokeSection } from '../shared/index.js';

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
        id: 'chatcmpl-ai-sdk-reasoning-only',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'test-openai-compatible',
        choices: [
          {
            index: 0,
            delta: {
              reasoning_content: '先想一下，',
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-ai-sdk-reasoning-only',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'test-openai-compatible',
        choices: [
          {
            index: 0,
            delta: {
              reasoning_content: '最后直接把这段当结果返回。',
            },
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

  const transport = new AiSdkOpenAiCompatibleTransport();
  const state = startOpenAiToolAgentState(
    [],
    '请测试 reasoning-only 流式输出。',
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
    [],
  );

  const events = await collectEvents(started.eventStream);
  const completion = await started.completion;
  server.close();

  printSmokeSection('ai-sdk openai stream-reasoning-only smoke events', events);
  printSmokeSection('ai-sdk openai stream-reasoning-only smoke completion', completion);

  if (!events.some((event) => isJsonObject(event) && event.kind === 'thinking-chunk')) {
    throw new Error('ai-sdk openai stream-reasoning-only smoke 未收到 thinking-chunk。');
  }

  if (events.some((event) => isJsonObject(event) && event.kind === 'error')) {
    throw new Error('ai-sdk openai stream-reasoning-only smoke 不应收到 error 事件。');
  }

  if (completion.kind !== 'success' || completion.result.step.kind !== 'final-response-ready') {
    throw new Error('ai-sdk openai stream-reasoning-only smoke 未进入预期的 final-response-ready。');
  }

  const assistantText = extractLastOpenAiAssistantText(completion.result.state)?.trim();
  if (assistantText !== '先想一下，最后直接把这段当结果返回。') {
    throw new Error(`ai-sdk openai stream-reasoning-only smoke 未拿到 reasoning-only assistant 文本。实际: ${assistantText ?? '<empty>'}`);
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
  console.error(`ai-sdk openai stream-reasoning-only smoke failed: ${message}`);
  process.exitCode = 1;
});