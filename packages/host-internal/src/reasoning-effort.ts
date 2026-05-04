import type { ModelProviderId } from './model-provider-presets.js';

export type ModelReasoningEffort = 'default' | 'minimal' | 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelReasoningEffortContext {
  provider?: ModelProviderId;
  model?: string;
}

export const DEFAULT_MODEL_REASONING_EFFORT: ModelReasoningEffort = 'medium';

export const MODEL_REASONING_EFFORT_OPTIONS: Array<{
  value: ModelReasoningEffort;
  label: string;
}> = [
  { value: 'default', label: 'Default' },
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Xhigh' },
];

const MODEL_REASONING_EFFORT_LABELS: Record<ModelReasoningEffort, string> = {
  default: 'Default',
  minimal: 'Minimal',
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Xhigh',
  max: 'Max',
};

const DEEPSEEK_V4_REASONING_EFFORT_OPTIONS: Array<{
  value: ModelReasoningEffort;
  label: string;
}> = [
  { value: 'default', label: 'Default' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
];

const KIMI_REASONING_EFFORT_OPTIONS: Array<{
  value: ModelReasoningEffort;
  label: string;
}> = [
  { value: 'default', label: 'Default' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const DEEPSEEK_V4_REASONING_MODEL_IDS = new Set(['deepseek-v4-pro', 'deepseek-v4-flash']);

const MODEL_REASONING_EFFORT_SET = new Set<ModelReasoningEffort>(
  Object.keys(MODEL_REASONING_EFFORT_LABELS) as ModelReasoningEffort[],
);

export function normalizeModelReasoningEffort(value: unknown): ModelReasoningEffort | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return MODEL_REASONING_EFFORT_SET.has(trimmed as ModelReasoningEffort)
    ? (trimmed as ModelReasoningEffort)
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

  if (isKimiReasoningEffortModel(context)) {
    return 'default';
  }

  return DEFAULT_MODEL_REASONING_EFFORT;
}

export function modelReasoningEffortOptions(
  context?: ModelReasoningEffortContext,
): Array<{ value: ModelReasoningEffort; label: string }> {
  return isDeepSeekV4ReasoningEffortModel(context)
    ? DEEPSEEK_V4_REASONING_EFFORT_OPTIONS
    : isKimiReasoningEffortModel(context)
      ? KIMI_REASONING_EFFORT_OPTIONS
    : MODEL_REASONING_EFFORT_OPTIONS;
}

export function resolveModelReasoningEffortForContext(
  value: unknown,
  context?: ModelReasoningEffortContext,
): ModelReasoningEffort {
  return resolveCompatibleModelReasoningEffort(normalizeModelReasoningEffort(value), context);
}

export function modelReasoningEffortLabel(value: ModelReasoningEffort): string {
  return MODEL_REASONING_EFFORT_LABELS[value] ?? 'Medium';
}

export function isDeepSeekV4ReasoningEffortModel(
  context?: ModelReasoningEffortContext,
): boolean {
  return context?.provider === 'deepseek' &&
    DEEPSEEK_V4_REASONING_MODEL_IDS.has(normalizeModelId(context.model));
}

export function isKimiReasoningEffortModel(
  context?: ModelReasoningEffortContext,
): boolean {
  return context?.provider === 'kimi';
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
        return 'default';
      case 'default':
        return 'default';
    }
  }

  if (isKimiReasoningEffortModel(context)) {
    switch (normalized) {
      case 'none':
        return 'default';
      case 'xhigh':
        return 'high';
      default:
        return normalized;
    }
  }

  if (normalized === 'max') {
    return 'xhigh';
  }

  return normalized;
}