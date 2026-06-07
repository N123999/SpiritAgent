import { normalizeOpenAiApiBase } from '@spirit-agent/host-internal/openai-models';

import { parseModelContextLength } from './model-context-length.js';
import { DEFAULT_API_BASE } from '../host/storage.js';
import type {
  ConversationContextUsageSnapshot,
  DesktopModelCatalogHint,
  DesktopModelProvider,
  DesktopTransportKind,
} from '../types.js';

export interface ContextUsageModelProfile {
  name: string;
  apiBase: string;
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  contextLength?: number;
}

export {
  parseModelContextLength,
} from './model-context-length.js';

const CONTEXT_USAGE_PROVIDERS = new Set<DesktopModelProvider>([
  'openrouter',
  'vercel-ai-gateway',
]);

export function supportsContextUsageProvider(provider: DesktopModelProvider | undefined): boolean {
  return provider !== undefined && CONTEXT_USAGE_PROVIDERS.has(provider);
}

export function resolveModelContextLength(
  activeModel: ContextUsageModelProfile | undefined,
  catalogHints: DesktopModelCatalogHint[] | undefined,
): number | undefined {
  if (!activeModel) {
    return undefined;
  }

  const profileLength = parseModelContextLength(activeModel.contextLength);
  if (profileLength !== undefined) {
    return profileLength;
  }

  if (!supportsContextUsageProvider(activeModel.provider)) {
    return undefined;
  }

  const modelName = activeModel.name.trim();
  if (!modelName) {
    return undefined;
  }

  const apiBase = activeModel.apiBase.trim() || DEFAULT_API_BASE;
  const transportKind = activeModel.transportKind
    ?? (activeModel.provider === 'anthropic' ? 'anthropic' : 'openai-compatible');
  const hint = catalogHints?.find((entry) => {
    if (entry.provider !== activeModel.provider) {
      return false;
    }
    if (entry.transportKind !== undefined && entry.transportKind !== transportKind) {
      return false;
    }
    return normalizeOpenAiApiBase(entry.apiBase) === normalizeOpenAiApiBase(apiBase);
  });

  const catalogEntry = hint?.modelCatalog?.find((entry) => entry.id === modelName);
  const contextLength = catalogEntry?.contextLength;
  if (typeof contextLength !== 'number' || !Number.isFinite(contextLength) || contextLength <= 0) {
    return undefined;
  }

  return Math.trunc(contextLength);
}

export function buildContextUsagePercent(inputTokens: number, contextLength: number): number {
  if (contextLength <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((inputTokens / contextLength) * 100)));
}

export function normalizeContextUsageSnapshot(
  value: unknown,
): ConversationContextUsageSnapshot | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const rawInputTokens = typeof record.inputTokens === 'number' && Number.isFinite(record.inputTokens)
    ? Math.trunc(record.inputTokens)
    : undefined;
  const contextLength = typeof record.contextLength === 'number' && Number.isFinite(record.contextLength)
    ? Math.max(0, Math.trunc(record.contextLength))
    : undefined;
  if (
    rawInputTokens === undefined
    || rawInputTokens < 0
    || contextLength === undefined
    || contextLength <= 0
  ) {
    return undefined;
  }

  const inputTokens = rawInputTokens;

  const percent = typeof record.percent === 'number' && Number.isFinite(record.percent)
    ? Math.max(0, Math.min(100, Math.round(record.percent)))
    : buildContextUsagePercent(inputTokens, contextLength);
  return { inputTokens, contextLength, percent };
}
