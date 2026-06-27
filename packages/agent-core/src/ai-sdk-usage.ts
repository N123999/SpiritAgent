import type { LlmTokenUsage } from './ports.js';

type MaybePromise<T> = T | PromiseLike<T>;

export interface AiSdkUsageSource {
  usage?: MaybePromise<unknown>;
  /** @deprecated AI SDK 7：与 `usage` 同义，优先读 `usage`。 */
  totalUsage?: MaybePromise<unknown>;
}

function readNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.trunc(value);
}

function readNestedTokenDetail(
  record: Record<string, unknown>,
  detailsKey: 'inputTokenDetails' | 'outputTokenDetails',
  field: string,
): number | undefined {
  const details = record[detailsKey];
  if (typeof details !== 'object' || details === null) {
    return undefined;
  }
  return readNonNegativeInt((details as Record<string, unknown>)[field]);
}

function normalizeLanguageModelUsage(value: unknown): LlmTokenUsage | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const inputTokens =
    readNonNegativeInt(record.inputTokens)
    ?? readNonNegativeInt(record.input_tokens)
    ?? readNonNegativeInt(record.promptTokens)
    ?? readNonNegativeInt(record.prompt_tokens);
  const outputTokens =
    readNonNegativeInt(record.outputTokens)
    ?? readNonNegativeInt(record.output_tokens)
    ?? readNonNegativeInt(record.completionTokens)
    ?? readNonNegativeInt(record.completion_tokens);
  const totalTokens =
    readNonNegativeInt(record.totalTokens)
    ?? readNonNegativeInt(record.total_tokens)
    ?? (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);

  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  const usage: LlmTokenUsage = {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    totalTokens: totalTokens ?? (inputTokens ?? 0) + (outputTokens ?? 0),
  };

  const reasoningTokens =
    readNestedTokenDetail(record, 'outputTokenDetails', 'reasoningTokens')
    ?? readNonNegativeInt(record.reasoningTokens)
    ?? readNonNegativeInt(record.reasoning_tokens);
  if (reasoningTokens !== undefined) {
    usage.reasoningTokens = reasoningTokens;
  }

  const cachedInputTokens =
    readNestedTokenDetail(record, 'inputTokenDetails', 'cacheReadTokens')
    ?? readNonNegativeInt(record.cachedInputTokens)
    ?? readNonNegativeInt(record.cached_input_tokens);
  if (cachedInputTokens !== undefined) {
    usage.cachedInputTokens = cachedInputTokens;
  }

  return usage;
}

async function resolveMaybePromise<T>(value: MaybePromise<T> | undefined): Promise<T | undefined> {
  if (value === undefined) {
    return undefined;
  }
  return await value;
}

export async function readAiSdkUsage(source: AiSdkUsageSource): Promise<LlmTokenUsage | undefined> {
  const usage = await resolveMaybePromise(source.usage);
  const normalizedUsage = normalizeLanguageModelUsage(usage);
  if (normalizedUsage) {
    return normalizedUsage;
  }

  const totalUsage = await resolveMaybePromise(source.totalUsage);
  return normalizeLanguageModelUsage(totalUsage);
}
