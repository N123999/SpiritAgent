import raw from './model-provider-presets.json' with { type: 'json' };

/** 与 `config.json` / CLI `ModelProvider` 小写字符串对齐（须与 `pickerOrder` 一致）。 */
export type ModelProviderId = 'deepseek' | 'kimi' | 'minimax' | 'custom';

const CANONICAL_PICKER_ORDER: readonly ModelProviderId[] = [
  'deepseek',
  'kimi',
  'minimax',
  'custom',
];

function assertCanonicalPickerOrder(order: readonly string[]): asserts order is typeof CANONICAL_PICKER_ORDER {
  if (
    order.length !== CANONICAL_PICKER_ORDER.length ||
    order.some((id, index) => id !== CANONICAL_PICKER_ORDER[index])
  ) {
    throw new Error(
      'model-provider-presets.json: pickerOrder must be exactly ["deepseek","kimi","minimax","custom"]',
    );
  }
}

assertCanonicalPickerOrder(raw.pickerOrder);

function requireField(value: string | undefined, key: string): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(`model-provider-presets.json: missing or empty "${key}"`);
  }
  return value;
}

export const DEFAULT_CUSTOM_API_BASE: string = requireField(
  raw.defaultCustomApiBase,
  'defaultCustomApiBase',
);

const presetBases = raw.presetApiBaseByProvider;

const deepseekBase = requireField(presetBases.deepseek, 'presetApiBaseByProvider.deepseek');
const kimiBase = requireField(presetBases.kimi, 'presetApiBaseByProvider.kimi');
const minimaxBase = requireField(presetBases.minimax, 'presetApiBaseByProvider.minimax');

export const PROVIDER_PRESET_API_BASE = {
  deepseek: deepseekBase,
  kimi: kimiBase,
  minimax: minimaxBase,
} as const satisfies Record<Exclude<ModelProviderId, 'custom'>, string>;

const pickerLabels = raw.pickerLabels;

/** 设置页等：按固定顺序展示提供商选项。 */
export const PROVIDER_PICKER_ROWS: Array<{ id: ModelProviderId; label: string }> = raw.pickerOrder.map(
  (id) => {
    const label = pickerLabels[id as keyof typeof pickerLabels];
    return {
      id: id as ModelProviderId,
      label: requireField(label, `pickerLabels.${id}`),
    };
  },
);

/** 分组排序等与 `pickerOrder` 一致。 */
export const MODEL_PROVIDER_PICKER_ORDER: readonly ModelProviderId[] = CANONICAL_PICKER_ORDER;

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
    case 'custom': {
      const trimmed = customApiBaseTrimmed.trim();
      return trimmed.length > 0 ? trimmed : DEFAULT_CUSTOM_API_BASE;
    }
  }
}
