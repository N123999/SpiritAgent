import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { AiSdkOpenResponsesTransport } from '../../open-responses/ai-sdk-transport.js';
import { startOpenAiToolAgentState } from '../../openai/tool-agent-helpers.js';
import { buildGatewayV3ApplyPatchToolCallResponse } from './open-responses-mock.js';
import { printSmokeSection } from '../shared/index.js';

async function main(): Promise<void> {
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || !request.url?.includes('/language-model')) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const hasApplyPatchTool = tools.some((tool: {
      type?: string;
      name?: string;
      function?: { name?: string };
    }) => (
      tool?.type === 'apply_patch'
      || (tool?.type === 'function' && tool?.name === 'apply_patch')
      || (tool?.type === 'function' && tool?.function?.name === 'apply_patch')
    ));
    if (!hasApplyPatchTool) {
      response.statusCode = 400;
      response.end('missing apply_patch tool');
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(buildGatewayV3ApplyPatchToolCallResponse()));
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
    model: 'openai/gpt-5.4',
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
    llmVendor: 'vercel-ai-gateway' as const,
    responsesProvider: 'open-responses-compatible' as const,
    store: false,
  };

  const initialState = startOpenAiToolAgentState(
    [],
    'Apply a patch to create demo.txt',
    process.cwd(),
    [],
    [],
    [],
    config.model,
  );

  const firstRound = await transport.startToolAgentRound(config, initialState, []);
  printSmokeSection('ai-sdk gateway apply_patch smoke', firstRound);
  server.close();

  if (firstRound.kind !== 'success' || firstRound.result.step.kind !== 'tool-calls') {
    throw new Error('ai-sdk gateway apply_patch smoke 未进入 tool-calls。');
  }

  const call = firstRound.result.step.calls[0];
  if (!call || call.name !== 'apply_patch') {
    throw new Error('ai-sdk gateway apply_patch smoke 未收到 apply_patch 工具调用。');
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk gateway apply_patch smoke failed: ${message}`);
  process.exitCode = 1;
});
