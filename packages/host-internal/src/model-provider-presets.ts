import rawImport from './model-provider-presets.json' with { type: 'json' };

/** 与 `config.json` / CLI `ModelProvider` 小写字符串对齐（须与 `pickerOrder` 一致）。 */
export type ModelProviderId = 'deepseek' | 'kimi' | 'minimax' | 'alibaba' | 'anthropic' | 'custom';
export type PresetModelProviderId = Exclude<ModelProviderId, 'custom'>;

const CANONICAL_PICKER_ORDER: readonly ModelProviderId[] = [
  'deepseek',
  'kimi',
  'minimax',
  'alibaba',
  'anthropic',
  'custom',
];

const MODEL_PROVIDER_ID_SET: ReadonlySet<ModelProviderId> = new Set(CANONICAL_PICKER_ORDER);
const PRESET_PROVIDER_PICKER_ORDER = CANONICAL_PICKER_ORDER.filter(
  (id): id is PresetModelProviderId => id !== 'custom',
);

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertCanonicalPickerOrder(order: readonly string[]): asserts order is typeof CANONICAL_PICKER_ORDER {
  if (
    order.length !== CANONICAL_PICKER_ORDER.length ||
    order.some((id, index) => id !== CANONICAL_PICKER_ORDER[index])
  ) {
    throw new Error(
      'model-provider-presets.json: pickerOrder must be exactly ["deepseek","kimi","minimax","alibaba","anthropic","custom"]',
    );
  }
}

interface ParsedModelProviderPresets {
  defaultCustomApiBase: string;
  presetApiBaseByProvider: Record<'deepseek' | 'kimi' | 'minimax' | 'alibaba' | 'anthropic', string>;
  pickerOrder: readonly ModelProviderId[];
  pickerLabels: Record<string, string>;
}

function requireStringField(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`model-provider-presets.json: missing or invalid string field "${key}"`);
  }
  return value;
}

function parseModelProviderPresetsJson(data: unknown): ParsedModelProviderPresets {
  if (!isJsonRecord(data)) {
    throw new Error('model-provider-presets.json: root must be a JSON object');
  }

  const pickerOrderRaw = data.pickerOrder;
  if (!Array.isArray(pickerOrderRaw)) {
    throw new Error('model-provider-presets.json: pickerOrder must be an array');
  }
  if (!pickerOrderRaw.every((id): id is string => typeof id === 'string')) {
    throw new Error('model-provider-presets.json: pickerOrder must be an array of strings');
  }
  assertCanonicalPickerOrder(pickerOrderRaw);
  const pickerOrder = pickerOrderRaw as readonly ModelProviderId[];

  const presetRaw = data.presetApiBaseByProvider;
  if (!isJsonRecord(presetRaw)) {
    throw new Error('model-provider-presets.json: presetApiBaseByProvider must be an object');
  }
  const presetApiBaseByProvider = {
    deepseek: requireStringField(presetRaw, 'deepseek'),
    kimi: requireStringField(presetRaw, 'kimi'),
    minimax: requireStringField(presetRaw, 'minimax'),
    alibaba: requireStringField(presetRaw, 'alibaba'),
    anthropic: requireStringField(presetRaw, 'anthropic'),
  };

  const labelsRaw = data.pickerLabels;
  if (!isJsonRecord(labelsRaw)) {
    throw new Error('model-provider-presets.json: pickerLabels must be an object');
  }
  const pickerLabels: Record<string, string> = {};
  for (const id of pickerOrder) {
    const label = labelsRaw[id];
    if (typeof label !== 'string' || label.trim() === '') {
      throw new Error(`model-provider-presets.json: pickerLabels.${id} must be a non-empty string`);
    }
    pickerLabels[id] = label;
  }

  const defaultCustomApiBase = requireStringField(data, 'defaultCustomApiBase');

  return {
    defaultCustomApiBase,
    presetApiBaseByProvider,
    pickerOrder,
    pickerLabels,
  };
}

const raw = parseModelProviderPresetsJson(rawImport as unknown);

export const DEFAULT_CUSTOM_API_BASE: string = raw.defaultCustomApiBase;

const deepseekBase = raw.presetApiBaseByProvider.deepseek;
const kimiBase = raw.presetApiBaseByProvider.kimi;
const minimaxBase = raw.presetApiBaseByProvider.minimax;
const alibabaBase = raw.presetApiBaseByProvider.alibaba;
const anthropicBase = raw.presetApiBaseByProvider.anthropic;

export const PROVIDER_PRESET_API_BASE = {
  deepseek: deepseekBase,
  kimi: kimiBase,
  minimax: minimaxBase,
  alibaba: alibabaBase,
  anthropic: anthropicBase,
} as const satisfies Record<Exclude<ModelProviderId, 'custom'>, string>;

const pickerLabels = raw.pickerLabels;

/** 设置页等：按固定顺序展示提供商选项。 */
export const PROVIDER_PICKER_ROWS: Array<{ id: ModelProviderId; label: string }> = raw.pickerOrder.map(
  (id) => ({ id, label: pickerLabels[id]! }),
);

/** 分组排序等与 `pickerOrder` 一致。 */
export const MODEL_PROVIDER_PICKER_ORDER: readonly ModelProviderId[] = CANONICAL_PICKER_ORDER;
export const PRESET_MODEL_PROVIDER_PICKER_ORDER: readonly PresetModelProviderId[] = PRESET_PROVIDER_PICKER_ORDER;

export function isModelProviderId(value: unknown): value is ModelProviderId {
  return typeof value === 'string' && MODEL_PROVIDER_ID_SET.has(value as ModelProviderId);
}

export function parseModelProviderId(value: unknown): ModelProviderId | undefined {
  return isModelProviderId(value) ? value : undefined;
}

export function isPresetModelProviderId(value: unknown): value is PresetModelProviderId {
  return typeof value === 'string' && value !== 'custom' && MODEL_PROVIDER_ID_SET.has(value as ModelProviderId);
}

export function parsePresetModelProviderId(value: unknown): PresetModelProviderId | undefined {
  return isPresetModelProviderId(value) ? value : undefined;
}

export function partitionModelsByProvider<Model extends { provider?: ModelProviderId }>(
  models: readonly Model[],
  provider: ModelProviderId,
): { matched: Model[]; unmatched: Model[] } {
  const matched: Model[] = [];
  const unmatched: Model[] = [];

  for (const model of models) {
    if (model.provider === provider) {
      matched.push(model);
    } else {
      unmatched.push(model);
    }
  }

  return { matched, unmatched };
}

export function resolveConnectApiBase(
  provider: ModelProviderId,
  customApiBaseTrimmed: string,
): string {
  switch (provider) {
    case 'deepseek':
      return PROVIDER_PRESET_API_BASE.deepseek;
    case 'kimi':
      return PROVIDER_PRESET_API_BASE.kimi;
    case 'minimax':
      return PROVIDER_PRESET_API_BASE.minimax;
    case 'alibaba':
      return PROVIDER_PRESET_API_BASE.alibaba;
    case 'anthropic':
      return PROVIDER_PRESET_API_BASE.anthropic;
    case 'custom': {
      const trimmed = customApiBaseTrimmed.trim();
      return trimmed.length > 0 ? trimmed : DEFAULT_CUSTOM_API_BASE;
    }
  }
}
