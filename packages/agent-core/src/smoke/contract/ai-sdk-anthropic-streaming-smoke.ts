import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { JsonValue } from '../../ports.js';
import { AiSdkAnthropicTransport } from '../../anthropic/ai-sdk-transport.js';
import {
  appendToolResultMessage,
  buildToolAgentMessages,
  extractLastAssistantText,
  isJsonObject,
  startToolAgentState,
} from '../../tool-agent.js';

import { demoLookupToolDefinition, printSmokeSection } from '../shared/index.js';

const ANTHROPIC_REASONING_TEXT = '先想一下，再查工具。';
const ANTHROPIC_REASONING_SIGNATURE = 'sig_anthropic_stream_1';
const ANTHROPIC_TOOL_USE_ID = 'toolu_anthropic_stream_1';

async function main(): Promise<void> {
  let requestCount = 0;
  const requestBodies: JsonValue[] = [];

  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/messages') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    const body = await readJsonBody(request);
    requestBodies.push(body);
    requestCount += 1;

    if (
      requestCount === 2 &&
      !requestIncludesReplayedThinking(body, ANTHROPIC_REASONING_TEXT, ANTHROPIC_REASONING_SIGNATURE)
    ) {
      response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'The `content[].thinking` in the thinking mode must be passed back to the API.',
        },
      }));
      return;
    }

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });

    const chunks =
      requestCount === 1
        ? [
            {
              type: 'message_start',
              message: {
                id: 'msg_anthropic_stream_1',
                model: 'deepseek-v4-pro',
                usage: { input_tokens: 12 },
              },
            },
            {
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'thinking',
                thinking: '',
              },
            },
            {
              type: 'content_block_delta',
              index: 0,
              delta: {
                type: 'thinking_delta',
                thinking: ANTHROPIC_REASONING_TEXT,
              },
            },
            {
              type: 'content_block_delta',
              index: 0,
              delta: {
                type: 'signature_delta',
                signature: ANTHROPIC_REASONING_SIGNATURE,
              },
            },
            {
              type: 'content_block_stop',
              index: 0,
            },
            {
              type: 'content_block_start',
              index: 1,
              content_block: {
                type: 'tool_use',
                id: ANTHROPIC_TOOL_USE_ID,
                name: 'demo_lookup',
              },
            },
            {
              type: 'content_block_delta',
              index: 1,
              delta: {
                type: 'input_json_delta',
                partial_json: '{"query":"Spirit Agent anthropic"}',
              },
            },
            {
              type: 'content_block_stop',
              index: 1,
            },
            {
              type: 'message_delta',
              delta: {
                stop_reason: 'tool_use',
                stop_sequence: null,
              },
              usage: {
                output_tokens: 18,
              },
            },
            {
              type: 'message_stop',
            },
          ]
        : [
            {
              type: 'message_start',
              message: {
                id: 'msg_anthropic_stream_2',
                model: 'deepseek-v4-pro',
                usage: { input_tokens: 16 },
              },
            },
            {
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'text',
                text: '',
              },
            },
            {
              type: 'content_block_delta',
              index: 0,
              delta: {
                type: 'text_delta',
                text: 'AI_SDK_ANTHROPIC_STREAM_OK',
              },
            },
            {
              type: 'content_block_stop',
              index: 0,
            },
            {
              type: 'message_delta',
              delta: {
                stop_reason: 'end_turn',
                stop_sequence: null,
              },
              usage: {
                output_tokens: 8,
              },
            },
            {
              type: 'message_stop',
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
    throw new Error('无法获取本地 Anthropic smoke server 端口。');
  }

  const transport = new AiSdkAnthropicTransport();
  const state = startToolAgentState(
    buildToolAgentMessages({
      historyMessages: [],
      model: 'deepseek-v4-pro',
    }),
    'Call demo_lookup exactly once.',
  );

  const config = {
    transportKind: 'anthropic' as const,
    apiKey: 'test-key',
    model: 'deepseek-v4-pro',
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
    thinking: { type: 'enabled' as const, budgetTokens: 1024 },
  };

  const started = await transport.startToolAgentRoundStreaming(
    config,
    state,
    demoLookupToolDefinition(),
  );

  const firstEvents = await collectEvents(started.eventStream);
  const firstCompletion = await started.completion;

  printSmokeSection('ai-sdk anthropic streaming smoke step 1 events', firstEvents);
  printSmokeSection('ai-sdk anthropic streaming smoke step 1 completion', firstCompletion);

  if (!firstEvents.some((event) => isJsonObject(event) && event.kind === 'streaming-tool-preview')) {
    server.close();
    throw new Error('ai-sdk anthropic streaming smoke 未收到 streaming-tool-preview 事件。');
  }

  if (
    !firstEvents.some(
      (event) =>
        isJsonObject(event) &&
        event.kind === 'thinking-chunk' &&
        typeof event.text === 'string' &&
        event.text.includes(ANTHROPIC_REASONING_TEXT),
    )
  ) {
    server.close();
    throw new Error('ai-sdk anthropic streaming smoke 未收到预期的 thinking-chunk。');
  }

  if (firstCompletion.kind !== 'success' || firstCompletion.result.step.kind !== 'tool-calls') {
    server.close();
    throw new Error('ai-sdk anthropic streaming smoke step 1 未进入预期的 tool-calls。');
  }

  const firstAssistant = firstCompletion.result.state.messages.at(-1);
  if (!hasStoredReasoningSignature(firstAssistant, ANTHROPIC_REASONING_TEXT, ANTHROPIC_REASONING_SIGNATURE)) {
    server.close();
    throw new Error('ai-sdk anthropic streaming smoke 未在 assistant message 上保留 reasoning signature。');
  }

  const resumedState = appendToolResultMessage(
    firstCompletion.result.state,
    ANTHROPIC_TOOL_USE_ID,
    '{"query":"Spirit Agent anthropic","result":"anthropic bridge ok"}',
  );

  const secondStarted = await transport.startToolAgentRoundStreaming(
    config,
    resumedState,
    demoLookupToolDefinition(),
  );

  const secondEvents = await collectEvents(secondStarted.eventStream);
  const secondCompletion = await secondStarted.completion;
  server.close();

  printSmokeSection('ai-sdk anthropic streaming smoke step 2 events', secondEvents);
  printSmokeSection('ai-sdk anthropic streaming smoke step 2 completion', secondCompletion);

  if (secondCompletion.kind !== 'success' || secondCompletion.result.step.kind !== 'final-response-ready') {
    throw new Error('ai-sdk anthropic streaming smoke step 2 未进入预期的 final-response-ready。');
  }

  const assistantText = extractLastAssistantText(secondCompletion.result.state)?.trim();
  if (assistantText !== 'AI_SDK_ANTHROPIC_STREAM_OK') {
    throw new Error(
      `ai-sdk anthropic streaming smoke step 2 未拿到预期最终 assistant 文本。实际: ${assistantText ?? '<empty>'}`,
    );
  }

  const firstRequest = requestBodies[0];
  if (!isJsonObject(firstRequest) || !isJsonObject(firstRequest.thinking) || firstRequest.thinking.type !== 'enabled') {
    throw new Error('ai-sdk anthropic streaming smoke 未在首轮请求上发送 thinking=enabled。');
  }

  if (!requestIncludesReplayedThinking(requestBodies[1], ANTHROPIC_REASONING_TEXT, ANTHROPIC_REASONING_SIGNATURE)) {
    throw new Error('ai-sdk anthropic streaming smoke 未把带 signature 的 thinking block 回灌到第二轮请求。');
  }
}

async function collectEvents(
  stream: AsyncIterable<{ kind: string } & Record<string, unknown>>,
): Promise<JsonValue[]> {
  const events: JsonValue[] = [];
  for await (const event of stream) {
    events.push(event as unknown as JsonValue);
  }
  return events;
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<JsonValue> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonValue;
}

function hasStoredReasoningSignature(
  message: JsonValue | undefined,
  reasoningText: string,
  signature: string,
): boolean {
  if (!isJsonObject(message)) {
    return false;
  }

  const reasoningParts = Array.isArray(message.reasoning_parts)
    ? message.reasoning_parts
    : Array.isArray(message.reasoningParts)
      ? message.reasoningParts
      : [];

  return reasoningParts.some((part) => {
    if (!isJsonObject(part) || part.type !== 'reasoning' || part.text !== reasoningText) {
      return false;
    }

    const providerMetadata = isJsonObject(part.providerMetadata)
      ? part.providerMetadata
      : isJsonObject(part.providerOptions)
        ? part.providerOptions
        : isJsonObject(part.provider_options)
          ? part.provider_options
      : isJsonObject(part.provider_metadata)
        ? part.provider_metadata
        : undefined;
    return (
      providerMetadata !== undefined &&
      isJsonObject(providerMetadata.anthropic) &&
      providerMetadata.anthropic.signature === signature
    );
  });
}

function requestIncludesReplayedThinking(
  requestBody: JsonValue | undefined,
  reasoningText: string,
  signature: string,
): boolean {
  if (!isJsonObject(requestBody) || !Array.isArray(requestBody.messages)) {
    return false;
  }

  return requestBody.messages.some((message) => {
    if (!isJsonObject(message) || message.role !== 'assistant' || !Array.isArray(message.content)) {
      return false;
    }

    const hasThinking = message.content.some(
      (part) =>
        isJsonObject(part) &&
        part.type === 'thinking' &&
        part.thinking === reasoningText &&
        part.signature === signature,
    );
    const hasToolUse = message.content.some(
      (part) => isJsonObject(part) && part.type === 'tool_use' && part.id === ANTHROPIC_TOOL_USE_ID,
    );

    return hasThinking && hasToolUse;
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk anthropic streaming smoke failed: ${message}`);
  process.exitCode = 1;
});