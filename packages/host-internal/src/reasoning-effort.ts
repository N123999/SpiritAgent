export type ModelReasoningEffort = 'default' | 'none' | 'low' | 'medium' | 'high' | 'xhigh';

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

const MODEL_REASONING_EFFORT_SET = new Set<ModelReasoningEffort>(
  MODEL_REASONING_EFFORT_OPTIONS.map((option) => option.value),
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
  return normalizeModelReasoningEffort(value) ?? DEFAULT_MODEL_REASONING_EFFORT;
}

export function modelReasoningEffortLabel(value: ModelReasoningEffort): string {
  return MODEL_REASONING_EFFORT_OPTIONS.find((option) => option.value === value)?.label ?? 'Medium';
}