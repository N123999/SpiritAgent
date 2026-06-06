import { normalizeOpenAiApiBase } from '@spirit-agent/host-internal';

import { DEFAULT_API_BASE } from '../host/storage.js';
import type {
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

export function parseModelContextLength(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }

  return value;
}

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
