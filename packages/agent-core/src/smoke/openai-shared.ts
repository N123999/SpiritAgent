import { setTimeout as waitForDelay } from 'node:timers/promises';

import { OpenAiTransport } from '../openai/transport.js';
import {
  appendOpenAiToolResultMessage,
  extractLastOpenAiAssistantText,
  startOpenAiToolAgentState,
} from '../openai/transport.js';
import type {
  AuthorizationDecision,
  JsonValue,
  LlmMessage,
  McpStatusSnapshot,
  ToolExecutor,
} from '../ports.js';
import { AgentRuntime, type RuntimeEvent } from '../runtime.js';

export interface DemoToolRequest {
  name: string;
  argumentsJson: string;
  parsedArguments: JsonValue;
}

export function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? (fallback ? process.env[fallback] : undefined);
  if (!value || !value.trim()) {
    throw new Error(`缺少环境变量 ${name}${fallback ? ` 或 ${fallback}` : ''}`);
  }
  return value;
}

export function createOpenAiSmokeConfig(): {
  apiKey: string;
  model: string;
  baseUrl?: string;
} {
  const apiKey = requireEnv('OPENAI_API_KEY', 'SPIRIT_API_KEY');
  const model = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
  const baseUrl = process.env.OPENAI_BASE_URL ?? process.env.SPIRIT_API_BASE;

  return {
    apiKey,
    model,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

export function createOpenAiSmokeTransport(): OpenAiTransport {
  return new OpenAiTransport();
}

export function createOpenAiDemoRuntime(options: {
  onEvent?: (event: RuntimeEvent<DemoToolRequest>) => void;
} = {}) {
  return new AgentRuntime({
    config: createOpenAiSmokeConfig(),
    llmTransport: createOpenAiSmokeTransport(),
    toolExecutor: new DemoToolExecutor(),
    createToolAgentState: startOpenAiToolAgentState,
    appendToolResultMessage: appendOpenAiToolResultMessage,
    extractAssistantText: extractLastOpenAiAssistantText,
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
  });
}

export async function pollRuntimeUntilIdle<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: AgentRuntime<Config, State, ToolRequest, TrustTarget>,
  timeoutMs = 60_000,
  pollIntervalMs = 50,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (runtime.isBusy() && Date.now() < deadline) {
    await waitForDelay(pollIntervalMs);
    await runtime.poll();
  }

  return !runtime.isBusy();
}

export function printSmokeSection(title: string, payload: unknown): void {
  console.log(`=== ${title} ===`);
  console.log(JSON.stringify(payload, null, 2));
}

export function demoLookupToolDefinition(): JsonValue[] {
  return [
    {
      type: 'function',
      function: {
        name: 'demo_lookup',
        description: 'Demo tool used to verify OpenAI tool-calling integration.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Lookup query.',
            },
          },
          required: ['query'],
          additionalProperties: false,
        },
      },
    },
  ];
}

export function buildCompactSmokeHistory(): LlmMessage[] {
  return [
    {
      role: 'system',
      content: '[TOOL_MEMORY]\nrequest: list_directory_files path=packages/agent-core\nresult_snippet:\npackage.json\nsrc/openai/transport.ts',
      imagePaths: [],
    },
    {
      role: 'user',
      content: '把这个 Rust agent 迁到 TypeScript，但先不要动 UI。',
      imagePaths: [],
    },
    {
      role: 'assistant',
      content: '可以，先把底层 provider 和 tool runtime 迁走，Rust TUI 先做 host。',
      imagePaths: [],
    },
    {
      role: 'user',
      content: '第一步先接 OpenAI SDK，并补一个真实 smoke。',
      imagePaths: [],
    },
    {
      role: 'assistant',
      content: '已接入 OpenAI SDK，basic chat 与 tool call smoke 已跑通，接下来补 round-trip 和 compact smoke。',
      imagePaths: [],
    },
    {
      role: 'system',
      content: '[TOOL_MEMORY]\nrequest: read_file path=packages/agent-core/src/openai/transport.ts\nresult_snippet:\ncontains OpenAiTransport and compactHistoryManual',
      imagePaths: [],
    },
    {
      role: 'user',
      content: '压缩时要保留迁移目标、SDK 接入状态、以及后续还要做 host bridge 这几个点。',
      imagePaths: [],
    },
    {
      role: 'assistant',
      content: '收到，摘要里会保留目标、已验证链路、以及待做的 host/core bridge。',
      imagePaths: [],
    },
  ];
}

export class DemoToolExecutor implements ToolExecutor<DemoToolRequest> {
  toolDefinitionsJson(): JsonValue {
    return demoLookupToolDefinition();
  }

  async parseCommand(_message: string): Promise<DemoToolRequest> {
    throw new Error('DemoToolExecutor.parseCommand 未实现。');
  }

  async requestFromFunctionCall(
    name: string,
    argumentsJson: string,
  ): Promise<DemoToolRequest> {
    return {
      name,
      argumentsJson,
      parsedArguments: JSON.parse(argumentsJson) as JsonValue,
    };
  }

  async authorize(
    _request: DemoToolRequest,
  ): Promise<AuthorizationDecision> {
    return { kind: 'allowed' };
  }

  async trust(_target: string): Promise<void> {}

  async execute(request: DemoToolRequest): Promise<string> {
    if (request.name !== 'demo_lookup') {
      throw new Error(`未知 demo 工具: ${request.name}`);
    }

    const query =
      isJsonObject(request.parsedArguments) && typeof request.parsedArguments.query === 'string'
        ? request.parsedArguments.query
        : 'unknown';

    return JSON.stringify({
      query,
      result: 'transport bridge ok',
    });
  }

  startMcpBackgroundRefresh(): void {}

  mcpStatusSnapshot(): McpStatusSnapshot {
    return {
      revision: 0,
      state: 'idle',
      configuredServers: 0,
      loadedServers: 0,
      cachedTools: 0,
    };
  }

  async addMcpServer(_name: string, _config: JsonValue): Promise<string> {
    throw new Error('DemoToolExecutor.addMcpServer 未实现。');
  }

  async listMcpServers(): Promise<never[]> {
    return [];
  }

  async inspectMcpServer(_name: string): Promise<never> {
    throw new Error('DemoToolExecutor.inspectMcpServer 未实现。');
  }

  async listMcpTools(_name: string): Promise<never[]> {
    return [];
  }

  async listMcpResources(_name: string): Promise<never[]> {
    return [];
  }

  async readMcpResource(_name: string, _uri: string): Promise<JsonValue> {
    throw new Error('DemoToolExecutor.readMcpResource 未实现。');
  }

  async listCachedMcpPrompts(_name: string): Promise<never[]> {
    return [];
  }

  async listMcpPrompts(_name: string): Promise<never[]> {
    return [];
  }

  async getMcpPrompt(
    _name: string,
    _prompt: string,
    _argsJson?: string,
  ): Promise<JsonValue> {
    throw new Error('DemoToolExecutor.getMcpPrompt 未实现。');
  }
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}