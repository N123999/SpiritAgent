import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { JsonValue } from '../../ports.js';
import { AiSdkOpenAiCompatibleTransport } from '../../openai/ai-sdk-transport.js';
import { AiSdkOpenResponsesTransport } from '../../open-responses/ai-sdk-transport.js';
import {
  extractLastOpenAiAssistantText,
  startOpenAiToolAgentState,
} from '../../openai/tool-agent-helpers.js';

import { printSmokeSection } from '../shared/index.js';
import {
  buildOpenResponsesFinalTextBody,
} from './open-responses-mock.js';

async function main(): Promise<void> {
  await runAlibabaChatSmoke();
  await runAlibabaResponsesSmoke();
}

async function runAlibabaChatSmoke(): Promise<void> {
  let capturedBody: Record<string, unknown> | undefined;
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || !request.url?.includes('/chat/completions')) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    capturedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 0,
      model: 'qwen3-max',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'ALIBABA_CHAT_OK' },
        finish_reason: 'stop',
      }],
    }));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('无法获取本地 smoke server 端口。');
  }

  const transport = new AiSdkOpenAiCompatibleTransport();
  const config = {
    transportKind: 'openai-compatible' as const,
    apiKey: 'test-key',
    model: 'qwen3-max',
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
    llmVendor: 'alibaba' as const,
  };

  const state = startOpenAiToolAgentState(
    [],
    'Reply with exactly ALIBABA_CHAT_OK.',
    process.cwd(),
    [],
    [],
    [],
    config.model,
  );
  const round = await transport.startToolAgentRound(config, state, []);
  server.close();

  printSmokeSection('alibaba chat smoke', round);
  if (round.kind !== 'success' || round.result.step.kind !== 'final-response-ready') {
    throw new Error('alibaba chat smoke 未进入 final-response-ready。');
  }

  const extraBody = capturedBody?.extra_body as Record<string, unknown> | undefined;
  if (extraBody?.enable_search !== true) {
    throw new Error('alibaba chat smoke 请求体未包含 enable_search。');
  }

  const trace = round.result.requestTrace[0];
  if (!isJsonObject(trace) || trace.kind !== 'alibaba_sdk_chat_completions') {
    throw new Error('alibaba chat smoke 未写入 alibaba_sdk_chat_completions trace。');
  }
  if (!isJsonObject(trace.extra_body as JsonValue)) {
    throw new Error('alibaba chat smoke trace 缺少 extra_body。');
  }
}

async function runAlibabaResponsesSmoke(): Promise<void> {
  let capturedBody: Record<string, unknown> | undefined;
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || !request.url?.includes('/responses')) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    capturedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(buildOpenResponsesFinalTextBody('qwen3-max', 'ALIBABA_RESPONSES_OK')));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('无法获取本地 smoke server 端口。');
  }

  const transport = new AiSdkOpenResponsesTransport();
  const config = {
    transportKind: 'open-responses' as const,
    apiKey: 'test-key',
    model: 'qwen3-max',
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
    llmVendor: 'alibaba' as const,
  };

  const state = startOpenAiToolAgentState(
    [],
    'Reply with exactly ALIBABA_RESPONSES_OK.',
    process.cwd(),
    [],
    [],
    [],
    config.model,
  );
  const round = await transport.startToolAgentRound(config, state, []);
  server.close();

  printSmokeSection('alibaba responses smoke', round);
  if (round.kind !== 'success' || round.result.step.kind !== 'final-response-ready') {
    throw new Error('alibaba responses smoke 未进入 final-response-ready。');
  }

  const tools = capturedBody?.tools as Array<{ type?: string }> | undefined;
  for (const type of ['web_search', 'web_extractor', 'code_interpreter'] as const) {
    if (!tools?.some((tool) => tool.type === type)) {
      throw new Error(`alibaba responses smoke 请求体缺少 ${type}。`);
    }
  }

  const assistantText = extractLastOpenAiAssistantText(round.result.state)?.trim();
  if (assistantText !== 'ALIBABA_RESPONSES_OK') {
    throw new Error(`alibaba responses smoke 未拿到预期文本: ${assistantText ?? '<empty>'}`);
  }

  const trace = round.result.requestTrace[0];
  if (!isJsonObject(trace) || trace.kind !== 'alibaba_open_responses') {
    throw new Error('alibaba responses smoke 未写入 alibaba_open_responses trace。');
  }
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk alibaba native tools smoke failed: ${message}`);
  process.exitCode = 1;
});
