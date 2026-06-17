import type { AnthropicTransportConfig } from './anthropic/anthropic-compat.js';
import type { LlmTransportKind } from './llm-provider-shared.js';
import type { OpenAiTransportConfig } from './openai/openai-compat.js';

export type ModelReasoningProvider =
  | 'deepseek'
  | 'xai'
  | 'moonshot-ai'
  | 'z-ai'
  | 'zhipu-ai'
  | 'minimax'
  | 'xiaomi'
  | 'alibaba'
  | 'anthropic'
  | 'vercel-ai-gateway'
  | 'openrouter'
  | 'openai'
  | 'google'
  | 'google-vertex-ai'
  | 'volcengine'
  | 'azure'
  | 'amazon-bedrock'
  | 'custom';

export type ModelReasoningEffort = string;

export type ModelReasoningTransportKind = LlmTransportKind;

export type OpenAiCompatibleReasoningEffort =
  | 'default'
  | 'none'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

export type DeepSeekV4ReasoningEffort = 'default' | 'high' | 'max';

export type MoonshotReasoningEffort = 'default' | 'minimal' | 'low' | 'medium' | 'high';

export type XaiReasoningEffort = 'default' | 'none' | 'low' | 'medium' | 'high';

export type GoogleReasoningEffort = 'default' | 'none' | 'low' | 'medium' | 'high';

export type AnthropicReasoningEffort = 'default' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelReasoningEffortOption<T extends string = string> {
  value: T;
  label: string;
}

export interface ModelReasoningEffortContext {
  provider?: ModelReasoningProvider;
  model?: string;
  transportKind?: ModelReasoningTransportKind;
  supportedEfforts?: readonly ModelReasoningEffort[];
}

export const DEFAULT_MODEL_REASONING_EFFORT: OpenAiCompatibleReasoningEffort = 'medium';

export const OPENAI_COMPATIBLE_REASONING_EFFORT_OPTIONS: ReadonlyArray<
  ModelReasoningEffortOption<OpenAiCompatibleReasoningEffort>
> = [
  { value: 'default', label: 'Default' },
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Xhigh' },
];

export const DEEPSEEK_V4_REASONING_EFFORT_OPTIONS: ReadonlyArray<
  ModelReasoningEffortOption<DeepSeekV4ReasoningEffort>
> = [
  { value: 'default', label: 'Default' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
];

export const MOONSHOT_REASONING_EFFORT_OPTIONS: ReadonlyArray<
  ModelReasoningEffortOption<MoonshotReasoningEffort>
> = [
  { value: 'default', label: 'Default' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const XAI_REASONING_EFFORT_OPTIONS: ReadonlyArray<
  ModelReasoningEffortOption<XaiReasoningEffort>
> = [
  { value: 'default', label: 'Default' },
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const GOOGLE_REASONING_EFFORT_OPTIONS: ReadonlyArray<
  ModelReasoningEffortOption<GoogleReasoningEffort>
> = [
  { value: 'default', label: 'Default' },
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const ANTHROPIC_REASONING_EFFORT_OPTIONS: ReadonlyArray<
  ModelReasoningEffortOption<AnthropicReasoningEffort>
> = [
  { value: 'default', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Xhigh' },
  { value: 'max', label: 'Max' },
];

const DEEPSEEK_V4_REASONING_MODEL_IDS = new Set(['deepseek-v4-pro', 'deepseek-v4-flash']);

const ALL_REASONING_EFFORT_OPTIONS = dedupeReasoningEffortOptions([
  ...OPENAI_COMPATIBLE_REASONING_EFFORT_OPTIONS,
  ...DEEPSEEK_V4_REASONING_EFFORT_OPTIONS,
  ...MOONSHOT_REASONING_EFFORT_OPTIONS,
  ...XAI_REASONING_EFFORT_OPTIONS,
  ...GOOGLE_REASONING_EFFORT_OPTIONS,
  ...ANTHROPIC_REASONING_EFFORT_OPTIONS,
]);

const ALL_REASONING_EFFORT_VALUES = new Set<string>(
  ALL_REASONING_EFFORT_OPTIONS.map((option) => option.value),
);

const OPENAI_COMPATIBLE_REASONING_EFFORT_VALUES = new Set<string>(
  OPENAI_COMPATIBLE_REASONING_EFFORT_OPTIONS.map((option) => option.value),
);

const DEEPSEEK_V4_REASONING_EFFORT_VALUES = new Set<string>(
  DEEPSEEK_V4_REASONING_EFFORT_OPTIONS.map((option) => option.value),
);

const MOONSHOT_REASONING_EFFORT_VALUES = new Set<string>(
  MOONSHOT_REASONING_EFFORT_OPTIONS.map((option) => option.value),
);

const XAI_REASONING_EFFORT_VALUES = new Set<string>(
  XAI_REASONING_EFFORT_OPTIONS.map((option) => option.value),
);

const GOOGLE_REASONING_EFFORT_VALUES = new Set<string>(
  GOOGLE_REASONING_EFFORT_OPTIONS.map((option) => option.value),
);

const ANTHROPIC_REASONING_EFFORT_VALUES = new Set<string>(
  ANTHROPIC_REASONING_EFFORT_OPTIONS.map((option) => option.value),
);

export function normalizeModelReasoningEffort(value: unknown): ModelReasoningEffort | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return ALL_REASONING_EFFORT_VALUES.has(trimmed)
    ? trimmed
    : undefined;
}

export function resolveModelReasoningEffort(value: unknown): ModelReasoningEffort {
  return resolveCompatibleModelReasoningEffort(
    normalizeModelReasoningEffort(value),
    undefined,
  );
}

export function defaultModelReasoningEffort(
  context?: ModelReasoningEffortContext,
): ModelReasoningEffort {
  if (isDeepSeekV4ReasoningEffortModel(context)) {
    return 'default';
  }

  if (isMoonshotReasoningEffortModel(context)) {
    return 'default';
  }

  if (isXaiReasoningEffortModel(context)) {
    return 'default';
  }

  if (isGoogleReasoningEffortModel(context)) {
    return 'default';
  }

  if (isAnthropicReasoningEffortModel(context)) {
    return 'default';
  }

  return DEFAULT_MODEL_REASONING_EFFORT;
}

export function modelReasoningEffortOptions(
  context?: ModelReasoningEffortContext,
): ReadonlyArray<ModelReasoningEffortOption<ModelReasoningEffort>> {
  if (isDeepSeekV4ReasoningEffortModel(context)) {
    return DEEPSEEK_V4_REASONING_EFFORT_OPTIONS;
  }

  if (isMoonshotReasoningEffortModel(context)) {
    if (context?.supportedEfforts !== undefined) {
      return moonshotReasoningEffortOptionsForSupportedEfforts(context.supportedEfforts);
    }
    return MOONSHOT_REASONING_EFFORT_OPTIONS;
  }

  if (isXaiReasoningEffortModel(context)) {
    return XAI_REASONING_EFFORT_OPTIONS;
  }

  if (isGoogleReasoningEffortModel(context)) {
    return GOOGLE_REASONING_EFFORT_OPTIONS;
  }

  if (isAnthropicReasoningEffortModel(context)) {
    if (context?.supportedEfforts !== undefined) {
      return anthropicReasoningEffortOptionsForSupportedEfforts(context.supportedEfforts);
    }
    return ANTHROPIC_REASONING_EFFORT_OPTIONS;
  }

  return OPENAI_COMPATIBLE_REASONING_EFFORT_OPTIONS;
}

export function resolveModelReasoningEffortForContext(
  value: unknown,
  context?: ModelReasoningEffortContext,
): ModelReasoningEffort {
  return resolveCompatibleModelReasoningEffort(normalizeModelReasoningEffort(value), context);
}

export function resolveOpenAiTransportReasoningEffortForContext(
  value: unknown,
  context?: ModelReasoningEffortContext,
): OpenAiTransportConfig['reasoningEffort'] | undefined {
  const normalized = resolveModelReasoningEffortForContext(value, {
    ...context,
    transportKind: 'openai-compatible',
  });

  switch (normalized) {
    case 'default':
      return undefined;
    case 'none':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'minimal':
    case 'max':
      return normalized;
    default:
      return undefined;
  }
}

export function resolveAnthropicTransportReasoningEffortForContext(
  value: unknown,
  context?: ModelReasoningEffortContext,
): AnthropicTransportConfig['effort'] | undefined {
  const normalized = resolveModelReasoningEffortForContext(value, {
    ...context,
    transportKind: 'anthropic',
  });

  switch (normalized) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return normalized;
    default:
      return undefined;
  }
}

export function modelReasoningEffortLabel(value: ModelReasoningEffort): string {
  return ALL_REASONING_EFFORT_OPTIONS.find((option) => option.value === value)?.label ?? 'Medium';
}

export function isDeepSeekV4ReasoningEffortModel(
  context?: ModelReasoningEffortContext,
): boolean {
  return context?.provider === 'deepseek' &&
    DEEPSEEK_V4_REASONING_MODEL_IDS.has(normalizeModelId(context.model));
}

export function isMoonshotReasoningEffortModel(
  context?: ModelReasoningEffortContext,
): boolean {
  return context?.provider === 'moonshot-ai';
}

export function isXaiReasoningEffortModel(
  context?: ModelReasoningEffortContext,
): boolean {
  return context?.provider === 'xai';
}

export function isGoogleReasoningEffortModel(
  context?: ModelReasoningEffortContext,
): boolean {
  return context?.provider === 'google' || context?.provider === 'google-vertex-ai';
}

export function isAnthropicReasoningEffortModel(
  context?: ModelReasoningEffortContext,
): boolean {
  return context?.transportKind === 'anthropic' || context?.provider === 'anthropic';
}

function normalizeModelId(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function resolveCompatibleModelReasoningEffort(
  value: ModelReasoningEffort | undefined,
  context?: ModelReasoningEffortContext,
): ModelReasoningEffort {
  const normalized = value ?? defaultModelReasoningEffort(context);

  if (isDeepSeekV4ReasoningEffortModel(context)) {
    switch (normalized) {
      case 'low':
      case 'medium':
      case 'high':
        return 'high';
      case 'xhigh':
      case 'max':
        return 'max';
      case 'none':
      case 'minimal':
        return 'default';
      case 'default':
        return 'default';
      default:
        return DEEPSEEK_V4_REASONING_EFFORT_VALUES.has(normalized)
          ? normalized
          : 'default';
    }
  }

  if (isMoonshotReasoningEffortModel(context)) {
    const supportedEfforts = normalizeSupportedReasoningEfforts(context?.supportedEfforts);
    switch (normalized) {
      case 'none':
        return 'default';
      case 'xhigh':
      case 'max':
        return 'high';
      default:
        return moonshotReasoningEffortValueForContext(normalized, supportedEfforts) ?? 'default';
    }
  }

  if (isXaiReasoningEffortModel(context)) {
    switch (normalized) {
      case 'minimal':
        return 'low';
      case 'xhigh':
      case 'max':
        return 'high';
      default:
        return XAI_REASONING_EFFORT_VALUES.has(normalized) ? normalized : 'default';
    }
  }

  if (isGoogleReasoningEffortModel(context)) {
    switch (normalized) {
      case 'minimal':
        return 'low';
      case 'xhigh':
      case 'max':
        return 'high';
      default:
        return GOOGLE_REASONING_EFFORT_VALUES.has(normalized) ? normalized : 'default';
    }
  }

  if (isAnthropicReasoningEffortModel(context)) {
    const supportedEfforts = normalizeSupportedReasoningEfforts(context?.supportedEfforts);
    switch (normalized) {
      case 'none':
      case 'minimal':
        return 'default';
      default:
        return anthropicReasoningEffortValueForContext(normalized, supportedEfforts) ?? 'default';
    }
  }

  if (normalized === 'minimal') {
    return 'default';
  }

  if (normalized === 'max') {
    return 'xhigh';
  }

  return OPENAI_COMPATIBLE_REASONING_EFFORT_VALUES.has(normalized)
    ? normalized
    : DEFAULT_MODEL_REASONING_EFFORT;
}

function dedupeReasoningEffortOptions(
  options: ReadonlyArray<ModelReasoningEffortOption<string>>,
): ModelReasoningEffortOption<string>[] {
  const seen = new Set<string>();
  const deduped: ModelReasoningEffortOption<string>[] = [];

  for (const option of options) {
    if (seen.has(option.value)) {
      continue;
    }
    seen.add(option.value);
    deduped.push(option);
  }

  return deduped;
}

function anthropicReasoningEffortValueForContext(
  normalized: ModelReasoningEffort,
  supportedEfforts?: ReadonlySet<string>,
): ModelReasoningEffort | undefined {
  if (!ANTHROPIC_REASONING_EFFORT_VALUES.has(normalized)) {
    return undefined;
  }
  if (!supportedEfforts) {
    return normalized;
  }
  return normalized === 'default' || supportedEfforts.has(normalized)
    ? normalized
    : undefined;
}

function anthropicReasoningEffortOptionsForSupportedEfforts(
  supportedEfforts: readonly ModelReasoningEffort[],
): ReadonlyArray<ModelReasoningEffortOption<ModelReasoningEffort>> {
  const supported = normalizeSupportedReasoningEfforts(supportedEfforts) ?? new Set<string>();
  return ANTHROPIC_REASONING_EFFORT_OPTIONS.filter(
    (option) => option.value === 'default' || supported.has(option.value),
  );
}

function moonshotReasoningEffortValueForContext(
  normalized: ModelReasoningEffort,
  supportedEfforts?: ReadonlySet<string>,
): ModelReasoningEffort | undefined {
  if (!MOONSHOT_REASONING_EFFORT_VALUES.has(normalized)) {
    return undefined;
  }
  if (!supportedEfforts) {
    return normalized;
  }
  return normalized === 'default' || supportedEfforts.has(normalized)
    ? normalized
    : undefined;
}

function moonshotReasoningEffortOptionsForSupportedEfforts(
  supportedEfforts: readonly ModelReasoningEffort[],
): ReadonlyArray<ModelReasoningEffortOption<ModelReasoningEffort>> {
  const supported = normalizeSupportedReasoningEfforts(supportedEfforts) ?? new Set<string>();
  return MOONSHOT_REASONING_EFFORT_OPTIONS.filter(
    (option) => option.value === 'default' || supported.has(option.value),
  );
}

function normalizeSupportedReasoningEfforts(
  values: readonly ModelReasoningEffort[] | undefined,
): ReadonlySet<string> | undefined {
  if (!values) {
    return undefined;
  }
  const normalized = new Set<string>();
  for (const value of values) {
    const effort = normalizeModelReasoningEffort(value);
    if (!effort || effort === 'default') {
      continue;
    }
    normalized.add(effort);
  }
  return normalized;
}