import rawImport from './model-provider-presets.json' with { type: 'json' };

/** 与 `config.json` / CLI `ModelProvider` 小写字符串对齐（须与 `pickerOrder` 一致）。 */
export type ModelProviderId =
  | 'deepseek'
  | 'xai'
  | 'moonshot-ai'
  | 'kimi-code'
  | 'z-ai'
  | 'zhipu-ai'
  | 'minimax'
  | 'xiaomi'
  | 'siliconflow'
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
export type PresetModelProviderId = Exclude<ModelProviderId, 'custom'>;

/** 与 Desktop `DesktopTransportKind` / openai-models `ProviderModelTransportKind` 对齐。 */
export type ProviderModelTransportKind =
  | 'openai-compatible'
  | 'open-responses'
  | 'anthropic'
  | 'bedrock';

const PROVIDER_MODEL_TRANSPORT_KINDS: readonly ProviderModelTransportKind[] = [
  'openai-compatible',
  'open-responses',
  'anthropic',
  'bedrock',
];

const CANONICAL_PICKER_ORDER: readonly ModelProviderId[] = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'vercel-ai-gateway',
  'deepseek',
  'openrouter',
  'moonshot-ai',
  'kimi-code',
  'z-ai',
  'zhipu-ai',
  'alibaba',
  'minimax',
  'xiaomi',
  'siliconflow',
  'volcengine',
  'azure',
  'amazon-bedrock',
  'google-vertex-ai',
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
      'model-provider-presets.json: pickerOrder must be exactly ["openai","anthropic","google","xai","vercel-ai-gateway","deepseek","openrouter","moonshot-ai","kimi-code","z-ai","zhipu-ai","alibaba","minimax","xiaomi","siliconflow","volcengine","azure","amazon-bedrock","google-vertex-ai","custom"]',
    );
  }
}

type PresetApiBaseByTransport = Partial<
  Record<PresetModelProviderId, Partial<Record<ProviderModelTransportKind, string>>>
>;

/** 连接向导站点 id（如 SiliconFlow 的 cn / intl）。 */
export type ProviderConnectSiteId = string;

export interface ProviderConnectSiteDefinition {
  labelKey: string;
  fallbackLabel: string;
  apiBase: string;
  requiresWorkspaceId?: boolean;
}

export interface ProviderConnectSiteOption {
  id: ProviderConnectSiteId;
  labelKey: string;
  fallbackLabel: string;
  requiresWorkspaceId?: boolean;
}

export interface ProviderSiteSelectionConfig {
  defaultSite: ProviderConnectSiteId;
  sites: Record<ProviderConnectSiteId, ProviderConnectSiteDefinition>;
}

type ProviderSiteSelectionByProvider = Partial<
  Record<PresetModelProviderId, ProviderSiteSelectionConfig>
>;

export type AlibabaBillingMode = 'token-plan';

export interface AlibabaTokenPlanConfig {
  compatibleApiBase: string;
  docUrl: string;
}

export interface ResolveProviderConnectApiBaseOptions {
  site?: ProviderConnectSiteId;
  workspaceId?: string;
  customApiBaseTrimmed?: string;
  /** Alibaba Token Plan：固定 cn-beijing 端点，忽略 site/workspace。 */
  billingMode?: AlibabaBillingMode;
}

export interface ProviderPickerLabel {
  labelKey: string;
  fallbackLabel: string;
}

export interface ProviderPickerRow extends ProviderPickerLabel {
  id: ModelProviderId;
}

interface ParsedModelProviderPresets {
  defaultCustomApiBase: string;
  presetApiBaseByProvider: Record<
    | 'deepseek'
    | 'xai'
    | 'moonshot-ai'
    | 'kimi-code'
    | 'z-ai'
    | 'zhipu-ai'
    | 'minimax'
    | 'xiaomi'
    | 'siliconflow'
    | 'alibaba'
    | 'anthropic'
    | 'vercel-ai-gateway'
    | 'openrouter'
    | 'openai'
    | 'google'
    | 'google-vertex-ai'
    | 'volcengine'
    | 'azure'
    | 'amazon-bedrock',
    string
  >;
  presetApiBaseByTransport: PresetApiBaseByTransport;
  providerSiteSelection: ProviderSiteSelectionByProvider;
  alibabaTokenPlan: AlibabaTokenPlanConfig;
  pickerOrder: readonly ModelProviderId[];
  pickerLabels: Record<ModelProviderId, ProviderPickerLabel>;
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

export function parseProviderSiteSelection(data: unknown): ProviderSiteSelectionByProvider {
  if (data === undefined) {
    return {};
  }
  if (!isJsonRecord(data)) {
    throw new Error('model-provider-presets.json: providerSiteSelection must be an object');
  }

  const result: ProviderSiteSelectionByProvider = {};

  for (const [providerKey, selectionRaw] of Object.entries(data)) {
    if (!isPresetModelProviderId(providerKey)) {
      throw new Error(
        `model-provider-presets.json: providerSiteSelection.${providerKey} is not a preset provider id`,
      );
    }
    if (!isJsonRecord(selectionRaw)) {
      throw new Error(
        `model-provider-presets.json: providerSiteSelection.${providerKey} must be an object`,
      );
    }

    const defaultSite = requireStringField(selectionRaw, 'defaultSite');
    const sitesRaw = selectionRaw.sites;
    if (!isJsonRecord(sitesRaw) || Object.keys(sitesRaw).length === 0) {
      throw new Error(
        `model-provider-presets.json: providerSiteSelection.${providerKey}.sites must be a non-empty object`,
      );
    }

    const sites: Record<ProviderConnectSiteId, ProviderConnectSiteDefinition> = {};
    for (const [siteId, siteRaw] of Object.entries(sitesRaw)) {
      if (!isJsonRecord(siteRaw)) {
        throw new Error(
          `model-provider-presets.json: providerSiteSelection.${providerKey}.sites.${siteId} must be an object`,
        );
      }
      sites[siteId] = {
        labelKey: requireStringField(siteRaw, 'labelKey'),
        fallbackLabel: requireStringField(siteRaw, 'fallbackLabel'),
        apiBase: requireStringField(siteRaw, 'apiBase'),
        ...(siteRaw.requiresWorkspaceId === true ? { requiresWorkspaceId: true } : {}),
      };
    }

    if (!(defaultSite in sites)) {
      throw new Error(
        `model-provider-presets.json: providerSiteSelection.${providerKey}.defaultSite must exist in sites`,
      );
    }

    result[providerKey] = { defaultSite, sites };
  }

  return result;
}

function parseAlibabaTokenPlanConfig(data: unknown): AlibabaTokenPlanConfig {
  if (!isJsonRecord(data)) {
    throw new Error('model-provider-presets.json: alibabaTokenPlan must be an object');
  }
  return {
    compatibleApiBase: requireStringField(data, 'compatibleApiBase'),
    docUrl: requireStringField(data, 'docUrl'),
  };
}

function parsePickerLabel(data: unknown, id: ModelProviderId): ProviderPickerLabel {
  if (!isJsonRecord(data)) {
    throw new Error(`model-provider-presets.json: pickerLabels.${id} must be an object`);
  }
  const labelKey = requireStringField(data, 'labelKey');
  const fallbackLabel = requireStringField(data, 'fallbackLabel');
  return { labelKey, fallbackLabel };
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
    'kimi-code': requireStringField(presetRaw, 'kimi-code'),
    'z-ai': requireStringField(presetRaw, 'z-ai'),
    'zhipu-ai': requireStringField(presetRaw, 'zhipu-ai'),
    minimax: requireStringField(presetRaw, 'minimax'),
    xiaomi: requireStringField(presetRaw, 'xiaomi'),
    siliconflow: requireStringField(presetRaw, 'siliconflow'),
    alibaba: requireStringField(presetRaw, 'alibaba'),
    anthropic: requireStringField(presetRaw, 'anthropic'),
    'vercel-ai-gateway': requireStringField(presetRaw, 'vercel-ai-gateway'),
    openrouter: requireStringField(presetRaw, 'openrouter'),
    openai: requireStringField(presetRaw, 'openai'),
    google: requireStringField(presetRaw, 'google'),
    'google-vertex-ai': requireStringField(presetRaw, 'google-vertex-ai'),
    volcengine: requireStringField(presetRaw, 'volcengine'),
    azure: requireStringField(presetRaw, 'azure'),
    'amazon-bedrock': requireStringField(presetRaw, 'amazon-bedrock'),
  };

  const labelsRaw = data.pickerLabels;
  if (!isJsonRecord(labelsRaw)) {
    throw new Error('model-provider-presets.json: pickerLabels must be an object');
  }
  const pickerLabels: Partial<Record<ModelProviderId, ProviderPickerLabel>> = {};
  for (const id of pickerOrder) {
    const label = labelsRaw[id];
    pickerLabels[id] = parsePickerLabel(label, id);
  }

  const defaultCustomApiBase = requireStringField(data, 'defaultCustomApiBase');

  const presetApiBaseByTransportRaw = data.presetApiBaseByTransport;
  const presetApiBaseByTransport =
    presetApiBaseByTransportRaw === undefined
      ? {}
      : parsePresetApiBaseByTransport(presetApiBaseByTransportRaw);

  const providerSiteSelection = parseProviderSiteSelection(data.providerSiteSelection);
  const alibabaTokenPlan = parseAlibabaTokenPlanConfig(data.alibabaTokenPlan);

  return {
    defaultCustomApiBase,
    presetApiBaseByProvider,
    presetApiBaseByTransport,
    providerSiteSelection,
    alibabaTokenPlan,
    pickerOrder,
    pickerLabels: pickerLabels as Record<ModelProviderId, ProviderPickerLabel>,
  };
}

const raw = parseModelProviderPresetsJson(rawImport as unknown);

export const ALIBABA_TOKEN_PLAN_COMPATIBLE_API_BASE: string = raw.alibabaTokenPlan.compatibleApiBase;
export const ALIBABA_TOKEN_PLAN_DOC_URL: string = raw.alibabaTokenPlan.docUrl;

export const DEFAULT_CUSTOM_API_BASE: string = raw.defaultCustomApiBase;

const deepseekBase = raw.presetApiBaseByProvider.deepseek;
const xaiBase = raw.presetApiBaseByProvider.xai;
const moonshotAiBase = raw.presetApiBaseByProvider['moonshot-ai'];
const kimiCodeBase = raw.presetApiBaseByProvider['kimi-code'];
const zAiBase = raw.presetApiBaseByProvider['z-ai'];
const zhipuAiBase = raw.presetApiBaseByProvider['zhipu-ai'];
const minimaxBase = raw.presetApiBaseByProvider.minimax;
const xiaomiBase = raw.presetApiBaseByProvider.xiaomi;
const siliconflowBase = raw.presetApiBaseByProvider.siliconflow;
const alibabaBase = raw.presetApiBaseByProvider.alibaba;
const anthropicBase = raw.presetApiBaseByProvider.anthropic;
const vercelAiGatewayBase = raw.presetApiBaseByProvider['vercel-ai-gateway'];
const openrouterBase = raw.presetApiBaseByProvider.openrouter;
const openaiBase = raw.presetApiBaseByProvider.openai;
const googleBase = raw.presetApiBaseByProvider.google;
const googleVertexAiBase = raw.presetApiBaseByProvider['google-vertex-ai'];
const volcengineBase = raw.presetApiBaseByProvider.volcengine;
const azureBase = raw.presetApiBaseByProvider.azure;
const amazonBedrockBase = raw.presetApiBaseByProvider['amazon-bedrock'];

export const PROVIDER_PRESET_API_BASE = {
  deepseek: deepseekBase,
  xai: xaiBase,
  'moonshot-ai': moonshotAiBase,
  'kimi-code': kimiCodeBase,
  'z-ai': zAiBase,
  'zhipu-ai': zhipuAiBase,
  minimax: minimaxBase,
  xiaomi: xiaomiBase,
  siliconflow: siliconflowBase,
  alibaba: alibabaBase,
  anthropic: anthropicBase,
  'vercel-ai-gateway': vercelAiGatewayBase,
  openrouter: openrouterBase,
  openai: openaiBase,
  google: googleBase,
  'google-vertex-ai': googleVertexAiBase,
  volcengine: volcengineBase,
  azure: azureBase,
  'amazon-bedrock': amazonBedrockBase,
} as const satisfies Record<Exclude<ModelProviderId, 'custom'>, string>;

const pickerLabels = raw.pickerLabels;

/** 设置页等：按固定顺序展示提供商选项。 */
export const PROVIDER_PICKER_ROWS: ProviderPickerRow[] = raw.pickerOrder.map(
  (id) => ({ id, ...pickerLabels[id] }),
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

function normalizeResolveProviderConnectApiBaseOptions(
  options?: ResolveProviderConnectApiBaseOptions | string,
): ResolveProviderConnectApiBaseOptions {
  if (typeof options === 'string') {
    return { customApiBaseTrimmed: options };
  }
  return options ?? {};
}

export function providerSupportsSiteSelection(provider: ModelProviderId): boolean {
  if (provider === 'custom') {
    return false;
  }
  return raw.providerSiteSelection[provider] !== undefined;
}

export function defaultProviderConnectSite(
  provider: ModelProviderId,
): ProviderConnectSiteId | undefined {
  if (provider === 'custom') {
    return undefined;
  }
  return raw.providerSiteSelection[provider]?.defaultSite;
}

export function listProviderConnectSiteOptions(
  provider: ModelProviderId,
): ProviderConnectSiteOption[] {
  if (provider === 'custom') {
    return [];
  }
  const selection = raw.providerSiteSelection[provider];
  if (!selection) {
    return [];
  }
  return Object.entries(selection.sites).map(([id, site]) => ({
    id,
    labelKey: site.labelKey,
    fallbackLabel: site.fallbackLabel,
    ...(site.requiresWorkspaceId ? { requiresWorkspaceId: true } : {}),
  }));
}

const PROVIDER_SITE_WORKSPACE_ID_PLACEHOLDER = '{workspaceId}';

function siteDefinitionRequiresWorkspaceId(site: ProviderConnectSiteDefinition): boolean {
  return (
    site.requiresWorkspaceId === true
    || site.apiBase.includes(PROVIDER_SITE_WORKSPACE_ID_PLACEHOLDER)
  );
}

export function providerConnectSiteRequiresWorkspaceId(
  provider: ModelProviderId,
  site: ProviderConnectSiteId,
): boolean {
  if (provider === 'custom') {
    return false;
  }
  const selection = raw.providerSiteSelection[provider];
  const siteDef = selection?.sites[site];
  return siteDef !== undefined && siteDefinitionRequiresWorkspaceId(siteDef);
}

function applyWorkspaceIdToProviderSiteApiBase(apiBase: string, workspaceId: string): string {
  return apiBase.replaceAll(PROVIDER_SITE_WORKSPACE_ID_PLACEHOLDER, workspaceId.trim());
}

export function resolveProviderConnectSiteApiBase(
  provider: ModelProviderId,
  site: ProviderConnectSiteId,
  workspaceId?: string,
): string | undefined {
  if (provider === 'custom') {
    return undefined;
  }
  const selection = raw.providerSiteSelection[provider];
  if (!selection) {
    return undefined;
  }
  const siteDef = selection.sites[site];
  if (!siteDef) {
    return undefined;
  }
  if (siteDefinitionRequiresWorkspaceId(siteDef)) {
    const trimmedWorkspaceId = workspaceId?.trim();
    if (!trimmedWorkspaceId) {
      throw new Error(`Provider site "${site}" requires a workspace ID.`);
    }
    return applyWorkspaceIdToProviderSiteApiBase(siteDef.apiBase, trimmedWorkspaceId);
  }
  return siteDef.apiBase;
}

export function isProviderConnectSiteId(
  provider: ModelProviderId,
  site: unknown,
): site is ProviderConnectSiteId {
  if (typeof site !== 'string' || site.trim() === '') {
    return false;
  }
  if (provider === 'custom') {
    return false;
  }
  const selection = raw.providerSiteSelection[provider];
  return selection !== undefined && site in selection.sites;
}

function resolveTransportApiBaseForProviderSite(
  provider: PresetModelProviderId,
  transportKind: ProviderModelTransportKind,
  siteBase: string,
): string | undefined {
  const transportBases = raw.presetApiBaseByTransport[provider];
  if (!transportBases) {
    return undefined;
  }

  const transportBase = transportBases[transportKind];
  if (!transportBase) {
    return undefined;
  }

  if (transportKind === 'openai-compatible') {
    return siteBase;
  }

  try {
    const siteUrl = new URL(siteBase);
    const transportUrl = new URL(transportBase);
    if (siteUrl.origin === transportUrl.origin) {
      return transportBase;
    }
    return `${siteUrl.origin}${transportUrl.pathname}`;
  } catch {
    return undefined;
  }
}

/** Alibaba Token Plan：固定 cn-beijing compatible base，按 transport 推导 Anthropic / Open Responses。 */
export function resolveAlibabaTokenPlanConnectApiBase(
  transportKind: ProviderModelTransportKind,
): string {
  const siteBase = ALIBABA_TOKEN_PLAN_COMPATIBLE_API_BASE;
  const transportAdjusted = resolveTransportApiBaseForProviderSite('alibaba', transportKind, siteBase);
  return transportAdjusted ?? siteBase;
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
    case 'kimi-code':
      return PROVIDER_PRESET_API_BASE['kimi-code'];
    case 'z-ai':
      return PROVIDER_PRESET_API_BASE['z-ai'];
    case 'zhipu-ai':
      return PROVIDER_PRESET_API_BASE['zhipu-ai'];
    case 'minimax':
      return PROVIDER_PRESET_API_BASE.minimax;
    case 'xiaomi':
      return PROVIDER_PRESET_API_BASE.xiaomi;
    case 'siliconflow':
      return PROVIDER_PRESET_API_BASE.siliconflow;
    case 'alibaba':
      return PROVIDER_PRESET_API_BASE.alibaba;
    case 'anthropic':
      return PROVIDER_PRESET_API_BASE.anthropic;
    case 'vercel-ai-gateway':
      return PROVIDER_PRESET_API_BASE['vercel-ai-gateway'];
    case 'openrouter':
      return PROVIDER_PRESET_API_BASE.openrouter;
    case 'openai':
      return PROVIDER_PRESET_API_BASE.openai;
    case 'google':
      return PROVIDER_PRESET_API_BASE.google;
    case 'google-vertex-ai':
      return PROVIDER_PRESET_API_BASE['google-vertex-ai'];
    case 'volcengine':
      return PROVIDER_PRESET_API_BASE.volcengine;
    case 'azure':
      return PROVIDER_PRESET_API_BASE.azure;
    case 'amazon-bedrock':
      return PROVIDER_PRESET_API_BASE['amazon-bedrock'];
    case 'custom': {
      return customApiBaseTrimmed.trim();
    }
  }
}

/**
 * 连接向导：按预设提供商与 API 类型解析默认端点（用户未填写端点覆盖时）。
 */
export function resolveProviderConnectApiBase(
  provider: ModelProviderId,
  transportKind: ProviderModelTransportKind,
  options?: ResolveProviderConnectApiBaseOptions | string,
): string {
  const { site, workspaceId, customApiBaseTrimmed = '', billingMode } =
    normalizeResolveProviderConnectApiBaseOptions(options);

  if (provider === 'custom') {
    return customApiBaseTrimmed.trim();
  }

  if (provider === 'alibaba' && billingMode === 'token-plan') {
    return resolveAlibabaTokenPlanConnectApiBase(transportKind);
  }

  const siteBase = site ? resolveProviderConnectSiteApiBase(provider, site, workspaceId) : undefined;
  if (siteBase) {
    const transportAdjusted = resolveTransportApiBaseForProviderSite(
      provider as PresetModelProviderId,
      transportKind,
      siteBase,
    );
    return transportAdjusted ?? siteBase;
  }

  if (provider === 'openai') {
    return PROVIDER_PRESET_API_BASE.openai;
  }

  const transportBases = raw.presetApiBaseByTransport[provider as PresetModelProviderId];
  const transportBase = transportBases?.[transportKind];
  if (transportBase) {
    return transportBase;
  }

  return resolveConnectApiBase(provider, customApiBaseTrimmed);
}
