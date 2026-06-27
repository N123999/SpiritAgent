import { isStepCount } from 'ai';

import type { AiSdkUsageSource } from '../ai-sdk-usage.js';
import type { JsonValue, ToolCallRequest } from '../ports.js';
import { isJsonObject, type ToolAgentState } from '../tool-agent.js';
import { isResponsesBuiltInToolName } from './responses-built-in-tools.js';
import type { OpenResponsesTransportConfig } from './responses-compat.js';
import {
  resolveProviderWebSearchMode,
  type ProviderWebSearchMode,
} from './web-search-eligibility.js';

export const SDK_PROVIDER_WEB_SEARCH_STEP_LIMIT = 5;

export function shouldUseSdkProviderWebSearchMultiStep(
  config: OpenResponsesTransportConfig,
): boolean {
  const mode = resolveProviderWebSearchMode(config);
  return isSdkProviderWebSearchMode(mode);
}

/** Gateway v3 language-model 流式补丁：tool-result 追踪、续跑合成（非 OpenAI/xAI SDK 路径）。 */
export function shouldUseGatewaySdkProviderWebSearchStreamPatch(
  config: OpenResponsesTransportConfig,
): boolean {
  return resolveProviderWebSearchMode(config) === 'gateway-sdk-web-search';
}

function isSdkProviderWebSearchMode(mode: ProviderWebSearchMode | undefined): boolean {
  return mode === 'gateway-sdk-web-search'
    || mode === 'openai-sdk-web-search'
    || mode === 'xai-sdk-web-search';
}

export function buildSdkProviderWebSearchStopWhen(
  config: OpenResponsesTransportConfig,
): ReturnType<typeof isStepCount> | undefined {
  return shouldUseSdkProviderWebSearchMultiStep(config)
    ? isStepCount(SDK_PROVIDER_WEB_SEARCH_STEP_LIMIT)
    : undefined;
}

export function filterPendingHostToolCalls(
  calls: readonly ToolCallRequest[],
  executedProviderBuiltinToolCallIds: ReadonlySet<string>,
): ToolCallRequest[] {
  return calls.filter(
    (call) => !(
      isResponsesBuiltInToolName(call.name)
      && executedProviderBuiltinToolCallIds.has(call.id)
    ),
  );
}

export function collectExecutedProviderBuiltinToolCallIdsFromSteps(
  steps: ReadonlyArray<{
    toolResults?: ReadonlyArray<{ toolCallId: string; toolName: string }>;
    toolErrors?: ReadonlyArray<{ toolCallId: string; toolName: string }>;
  }>,
): Set<string> {
  const executedIds = new Set<string>();

  for (const step of steps) {
    for (const result of step.toolResults ?? []) {
      if (isResponsesBuiltInToolName(result.toolName)) {
        executedIds.add(result.toolCallId);
      }
    }
    for (const error of step.toolErrors ?? []) {
      if (isResponsesBuiltInToolName(error.toolName)) {
        executedIds.add(error.toolCallId);
      }
    }
  }

  return executedIds;
}

type MaybePromise<T> = T | PromiseLike<T>;

export type AiSdkStreamTextSource = AiSdkUsageSource & {
  text?: MaybePromise<string>;
  steps?: MaybePromise<ReadonlyArray<{ text: string }>>;
};

async function resolveMaybePromise<T>(value: MaybePromise<T> | undefined): Promise<T | undefined> {
  if (value === undefined) {
    return undefined;
  }
  return await value;
}

export async function resolveAiSdkStreamAssistantText(
  source: AiSdkStreamTextSource,
  streamedText: string,
): Promise<{ text: string; finalStepText: string; sdkStepCount: number }> {
  const steps = await resolveMaybePromise(source.steps);
  const stepTexts = (steps ?? [])
    .map((step) => step.text.trim())
    .filter((text) => text.length > 0);
  const finalStepText = stepTexts.at(-1) ?? '';
  const aggregateText = (await resolveMaybePromise(source.text))?.trim() ?? '';
  const allStepText = stepTexts.join('\n\n');
  const streamed = streamedText.trim();

  let resolved = streamed;
  for (const candidate of [aggregateText, allStepText, finalStepText]) {
    if (!candidate) {
      continue;
    }
    if (!resolved) {
      resolved = candidate;
      continue;
    }
    if (candidate.startsWith(resolved)) {
      resolved = candidate;
      continue;
    }
    if (resolved.startsWith(candidate)) {
      continue;
    }
    if (!resolved.includes(candidate)) {
      resolved = `${resolved}\n\n${candidate}`;
    }
  }

  return {
    text: resolved || streamedText,
    finalStepText,
    sdkStepCount: steps?.length ?? 0,
  };
}

export type AccumulatedProviderBuiltinToolResult = {
  toolCallId: string;
  toolName: string;
  argumentsJson: string;
  output: unknown;
};

export function formatProviderBuiltinToolResultContent(toolName: string, output: unknown): string {
  if (toolName === 'web_search') {
    return formatGatewayPerplexitySearchToolResult(output);
  }

  return typeof output === 'string' ? output : JSON.stringify(output, null, 2);
}

function formatGatewayPerplexitySearchToolResult(output: unknown): string {
  if (!isJsonObject(output as JsonValue)) {
    return `[web_search]\n${String(output)}`;
  }

  const record = output as Record<string, JsonValue>;
  if (typeof record.error === 'string') {
    const message = typeof record.message === 'string' ? record.message : record.error;
    return `[web_search error] ${message}`;
  }

  const results = Array.isArray(record.results) ? record.results : [];
  if (results.length === 0) {
    return '[web_search] No results returned.';
  }

  const lines = results.map((result, index) => {
    if (!isJsonObject(result as JsonValue)) {
      return `${index + 1}. ${JSON.stringify(result)}`;
    }

    const entry = result as Record<string, JsonValue>;
    const title = typeof entry.title === 'string' ? entry.title : 'Untitled';
    const url = typeof entry.url === 'string' ? entry.url : '';
    const snippet = typeof entry.snippet === 'string' ? entry.snippet : '';
    return `${index + 1}. ${title}\nurl: ${url}\nsnippet: ${snippet}`;
  });

  return `[web_search]\n${lines.join('\n\n')}`;
}

export function persistProviderBuiltinToolRoundToState(
  state: ToolAgentState,
  assistantMessage: JsonValue,
  providerBuiltinToolResults: ReadonlyMap<string, AccumulatedProviderBuiltinToolResult>,
  executedProviderBuiltinToolCallIds: ReadonlySet<string>,
): void {
  state.messages.push(assistantMessage);

  const orderedResults = [...providerBuiltinToolResults.values()]
    .filter((result) => executedProviderBuiltinToolCallIds.has(result.toolCallId))
    .sort((left, right) => left.toolCallId.localeCompare(right.toolCallId));

  for (const result of orderedResults) {
    state.messages.push({
      role: 'tool',
      tool_call_id: result.toolCallId,
      content: formatProviderBuiltinToolResultContent(result.toolName, result.output),
    });
  }
}

export function shouldResumeStreamingAfterProviderSearch(
  config: OpenResponsesTransportConfig,
  executedProviderBuiltinToolCallIds: ReadonlySet<string>,
  pendingHostCallCount: number,
  streamedText: string,
  resolved: { text: string; finalStepText: string; sdkStepCount: number },
): boolean {
  if (
    !shouldUseGatewaySdkProviderWebSearchStreamPatch(config)
    || executedProviderBuiltinToolCallIds.size === 0
    || pendingHostCallCount > 0
  ) {
    return false;
  }

  if (resolved.sdkStepCount >= 2 && resolved.finalStepText.trim().length > 0) {
    return false;
  }

  const streamed = streamedText.trim();
  const merged = resolved.text.trim();
  const finalStep = resolved.finalStepText.trim();

  if (!merged) {
    return true;
  }

  // SDK 单步 metadata 已含完整合成答案，而流式 delta 只覆盖了前言。
  if (finalStep.length > streamed.length && finalStep.startsWith(streamed)) {
    return false;
  }
  if (merged.length > streamed.length && merged.startsWith(streamed) && finalStep.length > 0) {
    return false;
  }

  return resolved.sdkStepCount < 2;
}
