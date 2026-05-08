import { setTimeout as waitForDelay } from 'node:timers/promises';

import { AiSdkOpenAiCompatibleTransport } from '../../openai/ai-sdk-transport.js';
import {
  appendOpenAiToolResultMessage,
  extractLastOpenAiAssistantText,
  startOpenAiToolAgentState,
} from '../../openai/tool-agent-helpers.js';
import type { LlmMessage } from '../../ports.js';
import { createLlmMessageContentFromText } from '../../ports.js';
import { AgentRuntime, type RuntimeEvent } from '../../runtime.js';

import { DemoToolExecutor, type DemoToolRequest } from './demo-tool.js';

export function createAiSdkOpenAiSmokeTransport(): AiSdkOpenAiCompatibleTransport {
  return new AiSdkOpenAiCompatibleTransport();
}

export function createAiSdkOpenAiDemoRuntime(options: {
  config: {
    apiKey: string;
    model: string;
    baseUrl?: string;
  };
  onEvent?: (event: RuntimeEvent<DemoToolRequest>) => void;
}) {
  const smokeConfig = options.config;
  return new AgentRuntime({
    config: smokeConfig,
    llmTransport: createAiSdkOpenAiSmokeTransport(),
    toolExecutor: new DemoToolExecutor(),
    createToolAgentState: (messages, userInput) =>
      startOpenAiToolAgentState(
        messages,
        userInput,
        process.cwd(),
        [],
        [],
        [],
        smokeConfig.model,
      ),
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

export function buildCompactSmokeHistory(): LlmMessage[] {
  return [
    {
      role: 'system',
      content: createLlmMessageContentFromText('[TOOL_MEMORY]\nrequest: list_directory_files path=packages/agent-core\nresult_snippet:\npackage.json\nsrc/openai/ai-sdk-transport.ts'),
    },
    {
      role: 'user',
      content: createLlmMessageContentFromText('把这个 Rust agent 迁到 TypeScript，但先不要动 UI。'),
    },
    {
      role: 'assistant',
      content: createLlmMessageContentFromText('可以，先把底层 provider 和 tool runtime 迁走，Rust TUI 先做 host。'),
    },
    {
      role: 'user',
      content: createLlmMessageContentFromText('第一步先接 OpenAI SDK，并补一个真实 smoke。'),
    },
    {
      role: 'assistant',
      content: createLlmMessageContentFromText('已接入 OpenAI SDK，basic chat 与 tool call smoke 已跑通，接下来补 round-trip 和 compact smoke。'),
    },
    {
      role: 'system',
      content: createLlmMessageContentFromText('[TOOL_MEMORY]\nrequest: read_file path=packages/agent-core/src/openai/ai-sdk-transport.ts\nresult_snippet:\ncontains AiSdkOpenAiCompatibleTransport and compactHistoryManual'),
    },
    {
      role: 'user',
      content: createLlmMessageContentFromText('压缩时要保留迁移目标、SDK 接入状态、以及后续还要做 host bridge 这几个点。'),
    },
    {
      role: 'assistant',
      content: createLlmMessageContentFromText('收到，摘要里会保留目标、已验证链路、以及待做的 host/core bridge。'),
    },
  ];
}