import rawImport from './model-provider-presets.json' with { type: 'json' };

/** 与 `config.json` / CLI `ModelProvider` 小写字符串对齐（须与 `pickerOrder` 一致）。 */
export type ModelProviderId =
  | 'deepseek'
  | 'xai'
  | 'moonshot-ai'
  | 'minimax'
  | 'alibaba'
  | 'anthropic'
  | 'vercel-ai-gateway'
  | 'openai'
  | 'custom';
export type PresetModelProviderId = Exclude<ModelProviderId, 'custom'>;

/** 与 Desktop `DesktopTransportKind` / openai-models `ProviderModelTransportKind` 对齐。 */
export type ProviderModelTransportKind = 'openai-compatible' | 'open-responses' | 'anthropic';

const PROVIDER_MODEL_TRANSPORT_KINDS: readonly ProviderModelTransportKind[] = [
  'openai-compatible',
  'open-responses',
  'anthropic',
];

const CANONICAL_PICKER_ORDER: readonly ModelProviderId[] = [
  'openai',
  'xai',
  'anthropic',
  'deepseek',
  'vercel-ai-gateway',
  'moonshot-ai',
  'alibaba',
  'minimax',
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
      'model-provider-presets.json: pickerOrder must be exactly ["openai","xai","anthropic","deepseek","vercel-ai-gateway","moonshot-ai","alibaba","minimax","custom"]',
    );
  }
}

type PresetApiBaseByTransport = Partial<
  Record<PresetModelProviderId, Partial<Record<ProviderModelTransportKind, string>>>
>;

interface ParsedModelProviderPresets {
  defaultCustomApiBase: string;
  presetApiBaseByProvider: Record<
    'deepseek' | 'xai' | 'moonshot-ai' | 'minimax' | 'alibaba' | 'anthropic' | 'vercel-ai-gateway' | 'openai',
    string
  >;
  presetApiBaseByTransport: PresetApiBaseByTransport;
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

function isProviderModelTransportKind(value: unknown): value is ProviderModelTransportKind {
  return (
    typeof value === 'string' &&
    (PROVIDER_MODEL_TRANSPORT_KINDS as readonly string[]).includes(value)
  );
}

function parsePresetApiBaseByTransport(data: unknown): PresetApiBaseByTransport {
  if (!isJsonRecord(data)) {
    return {};
  }

  const result: PresetApiBaseByTransport = {};

  for (const [providerKey, transportMapRaw] of Object.entries(data)) {
    if (!isPresetModelProviderId(providerKey)) {
      throw new Error(
        `model-provider-presets.json: presetApiBaseByTransport.${providerKey} is not a preset provider id`,
      );
    }
    if (!isJsonRecord(transportMapRaw)) {
      throw new Error(
        `model-provider-presets.json: presetApiBaseByTransport.${providerKey} must be an object`,
      );
    }

    const transportMap: Partial<Record<ProviderModelTransportKind, string>> = {};
    for (const [transportKey, baseUrl] of Object.entries(transportMapRaw)) {
      if (!isProviderModelTransportKind(transportKey)) {
        throw new Error(
          `model-provider-presets.json: presetApiBaseByTransport.${providerKey}.${transportKey} is not a valid transport kind`,
        );
      }
      if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
        throw new Error(
          `model-provider-presets.json: presetApiBaseByTransport.${providerKey}.${transportKey} must be a non-empty string`,
        );
      }
      transportMap[transportKey] = baseUrl;
    }

    result[providerKey] = transportMap;
  }

  return result;
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
    xai: requireStringField(presetRaw, 'xai'),
    'moonshot-ai': requireStringField(presetRaw, 'moonshot-ai'),
    minimax: requireStringField(presetRaw, 'minimax'),
    alibaba: requireStringField(presetRaw, 'alibaba'),
    anthropic: requireStringField(presetRaw, 'anthropic'),
    'vercel-ai-gateway': requireStringField(presetRaw, 'vercel-ai-gateway'),
    openai: requireStringField(presetRaw, 'openai'),
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

  const presetApiBaseByTransportRaw = data.presetApiBaseByTransport;
  const presetApiBaseByTransport =
    presetApiBaseByTransportRaw === undefined
      ? {}
      : parsePresetApiBaseByTransport(presetApiBaseByTransportRaw);

  return {
    defaultCustomApiBase,
    presetApiBaseByProvider,
    presetApiBaseByTransport,
    pickerOrder,
    pickerLabels,
  };
}

const raw = parseModelProviderPresetsJson(rawImport as unknown);

export const DEFAULT_CUSTOM_API_BASE: string = raw.defaultCustomApiBase;

const deepseekBase = raw.presetApiBaseByProvider.deepseek;
const xaiBase = raw.presetApiBaseByProvider.xai;
const moonshotAiBase = raw.presetApiBaseByProvider['moonshot-ai'];
const minimaxBase = raw.presetApiBaseByProvider.minimax;
const alibabaBase = raw.presetApiBaseByProvider.alibaba;
const anthropicBase = raw.presetApiBaseByProvider.anthropic;
const vercelAiGatewayBase = raw.presetApiBaseByProvider['vercel-ai-gateway'];
const openaiBase = raw.presetApiBaseByProvider.openai;

export const PROVIDER_PRESET_API_BASE = {
  deepseek: deepseekBase,
  xai: xaiBase,
  'moonshot-ai': moonshotAiBase,
  minimax: minimaxBase,
  alibaba: alibabaBase,
  anthropic: anthropicBase,
  'vercel-ai-gateway': vercelAiGatewayBase,
  openai: openaiBase,
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
    case 'xai':
      return PROVIDER_PRESET_API_BASE.xai;
    case 'moonshot-ai':
      return PROVIDER_PRESET_API_BASE['moonshot-ai'];
    case 'minimax':
      return PROVIDER_PRESET_API_BASE.minimax;
    case 'alibaba':
      return PROVIDER_PRESET_API_BASE.alibaba;
    case 'anthropic':
      return PROVIDER_PRESET_API_BASE.anthropic;
    case 'vercel-ai-gateway':
      return PROVIDER_PRESET_API_BASE['vercel-ai-gateway'];
    case 'openai':
      return PROVIDER_PRESET_API_BASE.openai;
    case 'custom': {
      const trimmed = customApiBaseTrimmed.trim();
      return trimmed.length > 0 ? trimmed : DEFAULT_CUSTOM_API_BASE;
    }
  }
}

/**
 * 连接向导：按预设提供商与 API 类型解析默认端点（用户未填写端点覆盖时）。
 */
export function resolveProviderConnectApiBase(
  provider: ModelProviderId,
  transportKind: ProviderModelTransportKind,
  customApiBaseTrimmed = '',
): string {
  const trimmedOverride = customApiBaseTrimmed.trim();
  if (trimmedOverride.length > 0) {
    return trimmedOverride;
  }

  if (provider === 'openai') {
    return PROVIDER_PRESET_API_BASE.openai;
  }

  if (provider === 'custom') {
    return DEFAULT_CUSTOM_API_BASE;
  }

  const transportBases = raw.presetApiBaseByTransport[provider as PresetModelProviderId];
  const transportBase = transportBases?.[transportKind];
  if (transportBase) {
    return transportBase;
  }

  return resolveConnectApiBase(provider, '');
}
