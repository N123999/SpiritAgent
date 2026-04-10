import { OpenAiTransport } from '../openai/transport.js';
import type { JsonValue, LlmMessage } from '../ports.js';

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