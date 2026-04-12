import { once } from 'node:events';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { JsonValue } from '../ports.js';
import {
  OpenAiTransport,
  appendOpenAiToolResultMessage,
  startOpenAiToolAgentState,
  type OpenAiActiveSkill,
  type OpenAiEnabledRule,
  type OpenAiEnabledSkillCatalogEntry,
} from '../openai/transport.js';

import { demoLookupToolDefinition, printSmokeSection } from './openai-shared.js';

async function main(): Promise<void> {
  const capturedBodies: JsonValue[] = [];
  let requestCount = 0;

  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    const payload = JSON.parse(await readBody(request)) as JsonValue;
    capturedBodies.push(payload);
    requestCount += 1;

    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
    });

    if (requestCount === 1) {
      response.end(JSON.stringify({
        id: 'chatcmpl-minimax-1',
        object: 'chat.completion',
        created: 0,
        model: 'MiniMax-M2.7',
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-demo',
                  type: 'function',
                  function: {
                    name: 'demo_lookup',
                    arguments: '{"query":"Spirit Agent migration"}',
                  },
                },
              ],
            },
          },
        ],
      }));
      return;
    }

    response.end(JSON.stringify({
      id: 'chatcmpl-minimax-2',
      object: 'chat.completion',
      created: 0,
      model: 'MiniMax-M2.7',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'ROUNDTRIP_OK',
          },
        },
      ],
    }));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('无法获取本地 smoke server 端口。');
  }

  const config = {
    apiKey: 'test-key',
    model: 'MiniMax-M2.7',
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
  };
  const transport = new OpenAiTransport();
  const enabledRules: OpenAiEnabledRule[] = [
    {
      id: '//?/C:/Users/pc/SpiritAgent/AGENTS.md',
      scope: 'workspace',
      title: 'Workspace Rules',
      path: 'C:\\Users\\pc\\SpiritAgent\\AGENTS.md',
      content: '# Workspace Rules\n- Keep responses concise.',
    },
  ];
  const enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[] = [
    {
      id: 'workspace:code-review',
      scope: 'workspace',
      name: 'code-review',
      description: 'Review diffs when the user asks for code review.',
      path: 'C:\\Users\\pc\\SpiritAgent\\.spirit\\skills\\code-review\\SKILL.md',
    },
  ];
  const activeSkills: OpenAiActiveSkill[] = [
    {
      id: 'workspace:code-review',
      scope: 'workspace',
      name: 'code-review',
      description: 'Review diffs when the user asks for code review.',
      path: 'C:\\Users\\pc\\SpiritAgent\\.spirit\\skills\\code-review\\SKILL.md',
      content: '# Code Review\n- Focus on regressions.',
      truncated: false,
      resources: [
        {
          kind: 'references',
          path: 'references/checklist.md',
        },
      ],
      resourcesTruncated: false,
    },
  ];

  const firstState = startOpenAiToolAgentState(
    [],
    'First call demo_lookup exactly once.',
    process.cwd(),
    enabledRules,
    enabledSkillCatalog,
    activeSkills,
  );
  const tools = demoLookupToolDefinition();
  const firstRound = await transport.startToolAgentRound(config, firstState, tools);
  if (firstRound.kind !== 'success' || firstRound.result.step.kind !== 'tool-calls') {
    server.close();
    throw new Error('request shape smoke step 1 未进入 tool-calls。');
  }

  const firstCall = firstRound.result.step.calls.at(0);
  if (!firstCall) {
    server.close();
    throw new Error('request shape smoke step 1 缺少 tool call。');
  }

  const resumedState = appendOpenAiToolResultMessage(
    firstRound.result.state,
    firstCall.id,
    '{"query":"Spirit Agent migration","result":"transport bridge ok"}',
  );

  const secondRound = await transport.startToolAgentRound(config, resumedState, tools);
  server.close();

  if (secondRound.kind !== 'success' || secondRound.result.step.kind !== 'final-response-ready') {
    throw new Error('request shape smoke step 2 未完成最终回复。');
  }

  printSmokeSection('minimax request shape smoke bodies', capturedBodies);

  const firstBody = capturedBodies[0];
  const secondBody = capturedBodies[1];
  if (!isJsonObject(firstBody) || !Array.isArray(firstBody.messages)) {
    throw new Error('request shape smoke step 1 未捕获到 messages。');
  }
  if (!isJsonObject(secondBody) || !Array.isArray(secondBody.messages)) {
    throw new Error('request shape smoke step 2 未捕获到 messages。');
  }

  const firstSystemMessages = firstBody.messages.filter(
    (message) => isJsonObject(message) && message.role === 'system',
  );
  if (firstSystemMessages.length !== 1) {
    throw new Error('request shape smoke 期望 MiniMax 请求只包含一条 system message。');
  }

  const firstSystemMessage = firstSystemMessages[0];
  if (!isJsonObject(firstSystemMessage)) {
    throw new Error('request shape smoke 无法读取合并后的 system message。');
  }

  const firstSystemContent = firstSystemMessage.content;
  if (
    typeof firstSystemContent !== 'string' ||
    !firstSystemContent.includes('You are Spirit Agent.') ||
    !firstSystemContent.includes('[SPIRIT_RULES]') ||
    !firstSystemContent.includes('[SPIRIT_SKILLS_CATALOG]') ||
    !firstSystemContent.includes('[SPIRIT_ACTIVE_SKILLS]')
  ) {
    throw new Error('request shape smoke 未将主 system prompt、rules 与 skills 段落合并。');
  }

  const assistantToolMessage = secondBody.messages.find(
    (message) =>
      isJsonObject(message) &&
      message.role === 'assistant' &&
      Array.isArray(message.tool_calls),
  );
  if (!isJsonObject(assistantToolMessage)) {
    throw new Error('request shape smoke step 2 未包含 assistant tool-call message。');
  }
  if ('reasoning_content' in assistantToolMessage) {
    throw new Error('request shape smoke 不应为 MiniMax 的 tool-call 历史注入 synthetic reasoning_content。');
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`openai request shape smoke failed: ${message}`);
  process.exitCode = 1;
});