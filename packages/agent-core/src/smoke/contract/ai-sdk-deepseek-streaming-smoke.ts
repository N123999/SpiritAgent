import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { JsonValue } from '../../ports.js';
import { createLlmMessageContentFromTextAndImages } from '../../ports.js';
import { AiSdkOpenAiCompatibleTransport } from '../../openai/ai-sdk-transport.js';
import { resolveOpenAiModelCompatibilityProfile } from '../../openai/openai-compat.js';
import {
  appendOpenAiToolResultMessage,
  continueOpenAiToolAgentState,
  extractLastOpenAiAssistantText,
  startOpenAiToolAgentState,
} from '../../openai/tool-agent-helpers.js';

import { demoLookupToolDefinition, printSmokeSection } from '../shared/index.js';

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

  await runDeepSeekVisionCapabilitySmoke();
  verifyKnownModelCapabilityTable();
}

async function runDeepSeekVisionCapabilitySmoke(): Promise<void> {
  const requestBodies: JsonValue[] = [];
  const warnings: JsonValue[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    requestBodies.push(await readJsonBody(request));
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-deepseek-vision-capability',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'deepseek-v4-pro',
      choices: [
        {
          index: 0,
          delta: { content: 'AI_SDK_DEEPSEEK_VISION_FILTER_OK' },
          finish_reason: null,
        },
      ],
    })}\n\n`);
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-deepseek-vision-capability',
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
    })}\n\n`);
    response.write('data: [DONE]\n\n');
    response.end();
  });

  const tempDir = await mkdtemp(join(tmpdir(), 'spirit-deepseek-vision-capability-'));
  const imagePath = join(tempDir, 'vision-test.png');
  await writeFile(
    imagePath,
    Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000188f53d5d0000000049454e44ae426082',
      'hex',
    ),
  );

  const warningHost = globalThis as typeof globalThis & {
    AI_SDK_LOG_WARNINGS: false | DeepSeekSmokeWarningLogger | undefined;
  };
  const previousWarningLogger = warningHost.AI_SDK_LOG_WARNINGS;
  warningHost.AI_SDK_LOG_WARNINGS = ((options: DeepSeekSmokeWarningOptions) => {
    warnings.push(options as unknown as JsonValue);
  }) as typeof warningHost.AI_SDK_LOG_WARNINGS;

  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('无法获取 DeepSeek vision capability smoke server 端口。');
    }

    const transport = new AiSdkOpenAiCompatibleTransport();
    const state = continueOpenAiToolAgentState(
      [
        {
          role: 'user',
          content: createLlmMessageContentFromTextAndImages('请看图。', [imagePath]),
        },
      ],
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
        baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
        llmVendor: 'deepseek',
      },
      state,
      demoLookupToolDefinition(),
    );

    const events = await collectEvents(started.eventStream);
    const completion = await started.completion;

    printSmokeSection('ai-sdk deepseek vision capability smoke request bodies', requestBodies);
    printSmokeSection('ai-sdk deepseek vision capability smoke events', events);
    printSmokeSection('ai-sdk deepseek vision capability smoke completion', completion);

    if (completion.kind !== 'success' || completion.result.step.kind !== 'final-response-ready') {
      throw new Error('DeepSeek vision capability smoke 未进入预期 final-response-ready。');
    }

    const assistantText = extractLastOpenAiAssistantText(completion.result.state)?.trim();
    if (assistantText !== 'AI_SDK_DEEPSEEK_VISION_FILTER_OK') {
      throw new Error(`DeepSeek vision capability smoke 最终 assistant 文本异常: ${assistantText ?? '<empty>'}`);
    }

    if (warnings.length > 0) {
      throw new Error('DeepSeek vision capability smoke 仍然收到了 AI SDK warning，说明前置裁剪未生效。');
    }

    const requestBody = requestBodies[0];
    const userMessage = findLastUserMessage(requestBody);
    if (!isJsonObject(userMessage)) {
      throw new Error('DeepSeek vision capability smoke 未找到 user message。');
    }

    if (Array.isArray(userMessage.content)) {
      const hasNonTextPart = userMessage.content.some(
        (part) => isJsonObject(part) && part.type !== 'text',
      );
      if (hasNonTextPart) {
        throw new Error('DeepSeek vision capability smoke 仍向 provider 发送了非文本 user part。');
      }
    }
  } finally {
    warningHost.AI_SDK_LOG_WARNINGS = previousWarningLogger;
    server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

interface DeepSeekSmokeWarningOptions {
  warnings: unknown[];
  provider: string;
  model: string;
}

type DeepSeekSmokeWarningLogger = (options: DeepSeekSmokeWarningOptions) => void;

function verifyKnownModelCapabilityTable(): void {
  const deepSeek = resolveOpenAiModelCompatibilityProfile({
    llmVendor: 'deepseek',
    model: 'deepseek-v4-pro',
  });
  if (!deepSeek.hasExplicitCapabilities || deepSeek.capabilities.imageInput) {
    throw new Error('DeepSeek capabilities 表异常：应显式声明且不支持 imageInput。');
  }

  const moonshotWithoutCatalog = resolveOpenAiModelCompatibilityProfile({
    llmVendor: 'moonshot-ai',
    model: 'kimi-k2.5',
  });
  const moonshotWithImageInput = resolveOpenAiModelCompatibilityProfile({
    llmVendor: 'moonshot-ai',
    model: 'kimi-k2.5',
    modelCapabilities: { imageInput: true },
  });

  if (!moonshotWithoutCatalog.hasExplicitCapabilities || moonshotWithoutCatalog.capabilities.imageInput) {
    throw new Error('Moonshot capabilities 表异常：无 catalog 时不应推断 imageInput。');
  }
  if (!moonshotWithImageInput.capabilities.imageInput) {
    throw new Error('Moonshot capabilities 表异常：显式 modelCapabilities 应保留 imageInput。');
  }

  const explicitCustom = resolveOpenAiModelCompatibilityProfile({
    llmVendor: 'custom',
    model: 'custom-image-model',
    modelCapabilities: { chat: true, imageInput: true, imageGeneration: true },
  });
  if (
    !explicitCustom.hasExplicitCapabilities ||
    !explicitCustom.capabilities.imageInput ||
    !explicitCustom.capabilities.imageGeneration
  ) {
    throw new Error('显式 modelCapabilities 未覆盖 provider/model 推断。');
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

function findLastUserMessage(requestBody: JsonValue | undefined): JsonValue | undefined {
  if (!isJsonObject(requestBody) || !Array.isArray(requestBody.messages)) {
    return undefined;
  }

  return [...requestBody.messages]
    .reverse()
    .find((message) => isJsonObject(message) && message.role === 'user');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk deepseek streaming smoke failed: ${message}`);
  process.exitCode = 1;
});
