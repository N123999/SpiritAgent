import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { JsonValue } from '../ports.js';
import { AiSdkOpenAiCompatibleTransport } from '../openai/ai-sdk-transport.js';
import type { OpenAiJsonSchemaCompletionRequest } from '../openai/json-schema.js';

import { printSmokeSection } from './ai-sdk-openai-shared.js';

async function main(): Promise<void> {
  const requestBodies: JsonValue[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    requestBodies.push(await readJsonBody(request));
    const body = requestBodies[requestBodies.length - 1];
    const message =
      isJsonObject(body) && body.model === 'deepseek-chat'
        ? 'AI_SDK_DEEPSEEK_JSON_OK'
        : 'AI_SDK_JSON_SCHEMA_OK';

    response.writeHead(200, {
      'content-type': 'application/json',
    });
    response.end(
      JSON.stringify({
        id: `chatcmpl-json-${requestBodies.length}`,
        object: 'chat.completion',
        created: 0,
        model: isJsonObject(body) && typeof body.model === 'string' ? body.model : 'unknown',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({ message }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
      }),
    );
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
  const request: OpenAiJsonSchemaCompletionRequest = {
    userPrompt: 'Return a JSON object with a commit message.',
    schemaName: 'structured_message',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        message: {
          type: 'string',
        },
      },
      required: ['message'],
    },
  };

  const openAiResult = await transport.createJsonSchemaCompletion<{ message: string }>(
    {
      apiKey: 'test-key',
      model: 'test-openai-compatible',
      baseUrl,
    },
    request,
  );
  const deepseekResult = await transport.createJsonSchemaCompletion<{ message: string }>(
    {
      apiKey: 'test-key',
      model: 'deepseek-chat',
      baseUrl,
      llmVendor: 'deepseek',
    },
    request,
  );
  server.close();

  printSmokeSection('ai-sdk openai json-schema smoke', openAiResult);
  printSmokeSection('ai-sdk deepseek json-schema smoke', deepseekResult);

  if (openAiResult.output.message !== 'AI_SDK_JSON_SCHEMA_OK') {
    throw new Error('ai-sdk openai json-schema smoke 未拿到预期的 OpenAI-compatible 结构化输出。');
  }
  if (deepseekResult.output.message !== 'AI_SDK_DEEPSEEK_JSON_OK') {
    throw new Error('ai-sdk deepseek json-schema smoke 未拿到预期的 DeepSeek 结构化输出。');
  }

  const openAiRequest = requestBodies[0];
  if (
    !isJsonObject(openAiRequest) ||
    !isJsonObject(openAiRequest.response_format) ||
    openAiRequest.response_format.type !== 'json_schema'
  ) {
    throw new Error('ai-sdk openai json-schema smoke 未在 OpenAI-compatible 请求上发送 json_schema response_format。');
  }

  const deepseekRequest = requestBodies[1];
  if (
    !isJsonObject(deepseekRequest) ||
    !isJsonObject(deepseekRequest.response_format) ||
    deepseekRequest.response_format.type !== 'json_object'
  ) {
    throw new Error('ai-sdk deepseek json-schema smoke 未在 DeepSeek 请求上发送 json_object response_format。');
  }
  if (!isJsonObject(deepseekRequest.thinking) || deepseekRequest.thinking.type !== 'enabled') {
    throw new Error('ai-sdk deepseek json-schema smoke 未在 DeepSeek 请求上发送 thinking=enabled。');
  }

  const openAiTrace = openAiResult.requestTrace[0];
  if (!isJsonObject(openAiTrace) || openAiTrace.kind !== 'openai_sdk_chat_completions') {
    throw new Error('ai-sdk openai json-schema smoke 未写入 OpenAI-compatible request trace。');
  }
  const deepseekTrace = deepseekResult.requestTrace[0];
  if (!isJsonObject(deepseekTrace) || deepseekTrace.kind !== 'deepseek_sdk_chat_completions') {
    throw new Error('ai-sdk deepseek json-schema smoke 未写入 DeepSeek request trace。');
  }
  const deepseekSystemMessage = extractFirstSystemMessage(deepseekTrace);
  if (!deepseekSystemMessage.includes('[JSON_SCHEMA]')) {
    throw new Error('ai-sdk deepseek json-schema smoke 未在 request trace 上保留额外 JSON schema system guidance。');
  }
}

function extractFirstSystemMessage(requestBody: JsonValue | undefined): string {
  if (!isJsonObject(requestBody) || !Array.isArray(requestBody.messages)) {
    return '';
  }

  const message = requestBody.messages.find(
    (entry) => isJsonObject(entry) && entry.role === 'system' && typeof entry.content === 'string',
  );
  return isJsonObject(message) && typeof message.content === 'string' ? message.content : '';
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<JsonValue> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonValue;
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk openai json-schema smoke failed: ${message}`);
  process.exitCode = 1;
});