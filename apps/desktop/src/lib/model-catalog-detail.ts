import { formatModelDisplayNameFromId } from '@spirit-agent/agent-core/model-display-name';

import type {
  DesktopModelCatalogHint,
  DesktopModelProvider,
  ModelProfileSnapshot,
  PreviewModelCatalogEntry,
  PreviewModelCatalogPricing,
} from '@/types';

const METADATA_PROVIDERS = new Set<DesktopModelProvider>(['vercel-ai-gateway', 'openrouter']);

/** 与 host-internal `normalizeOpenAiApiBase` 一致；勿从 host-internal 导入以免 renderer 拉入 node:fs。 */
function normalizeOpenAiApiBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function providerSupportsModelCatalogDetail(
  provider: DesktopModelProvider | undefined,
): boolean {
  return provider !== undefined && METADATA_PROVIDERS.has(provider);
}

export function modelCatalogHintKey(input: {
  provider?: DesktopModelProvider;
  transportKind?: ModelProfileSnapshot['transportKind'];
  apiBase: string;
}): string {
  const base = normalizeOpenAiApiBase(input.apiBase.trim() || '');
  return `${input.provider ?? 'custom'}::${input.transportKind ?? 'openai-compatible'}::${base}`;
}

function catalogEntryIndexKey(hintKey: string, modelId: string): string {
  return `${hintKey}::${modelId}`;
}

export function buildModelCatalogEntryIndex(
  hints: readonly DesktopModelCatalogHint[] | undefined,
): Map<string, PreviewModelCatalogEntry> {
  const index = new Map<string, PreviewModelCatalogEntry>();
  for (const hint of hints ?? []) {
    const hintKey = modelCatalogHintKey({
      provider: hint.provider,
      transportKind: hint.transportKind,
      apiBase: hint.apiBase,
    });
    for (const entry of hint.modelCatalog ?? []) {
      const id = entry.id.trim();
      if (!id) {
        continue;
      }
      index.set(catalogEntryIndexKey(hintKey, id), entry);
    }
  }
  return index;
}

export function findModelCatalogEntry(
  model: ModelProfileSnapshot,
  hints: readonly DesktopModelCatalogHint[] | undefined,
  entryIndex?: Map<string, PreviewModelCatalogEntry>,
): PreviewModelCatalogEntry | undefined {
  if (!providerSupportsModelCatalogDetail(model.provider)) {
    return undefined;
  }
  const index = entryIndex ?? buildModelCatalogEntryIndex(hints);
  const hintKey = modelCatalogHintKey({
    provider: model.provider,
    transportKind: model.transportKind,
    apiBase: model.apiBase,
  });
  return index.get(catalogEntryIndexKey(hintKey, model.name));
}

export function modelHasCatalogDetail(entry: PreviewModelCatalogEntry | undefined): boolean {
  if (!entry) {
    return false;
  }
  if (entry.displayName?.trim()) {
    return true;
  }
  if (entry.description?.trim()) {
    return true;
  }
  const pricing = entry.pricing;
  if (!pricing) {
    return false;
  }
  return Boolean(
    pricing.inputPerTokenUsd?.trim()
      || pricing.outputPerTokenUsd?.trim()
      || pricing.imagePerUnitUsd?.trim()
      || pricing.requestPerCallUsd?.trim(),
  );
}

export function buildModelCatalogDetailMap(
  models: readonly ModelProfileSnapshot[],
  hints: readonly DesktopModelCatalogHint[] | undefined,
): Map<string, PreviewModelCatalogEntry> {
  const entryIndex = buildModelCatalogEntryIndex(hints);
  const detailByModelName = new Map<string, PreviewModelCatalogEntry>();
  for (const model of models) {
    const catalogEntry = findModelCatalogEntry(model, hints, entryIndex);
    if (modelHasCatalogDetail(catalogEntry)) {
      detailByModelName.set(model.name, catalogEntry as PreviewModelCatalogEntry);
    }
  }

  return detailByModelName;
}

/** Gateway/OpenRouter：上游 `name` → catalog `displayName`；其余或未命中时回退 model.name（id）。 */
export function buildModelCatalogDisplayTitleMap(
  models: readonly ModelProfileSnapshot[],
  hints: readonly DesktopModelCatalogHint[] | undefined,
): Map<string, string> {
  const entryIndex = buildModelCatalogEntryIndex(hints);
  const titles = new Map<string, string>();
  for (const model of models) {
    const catalogEntry = providerSupportsModelCatalogDetail(model.provider)
      ? findModelCatalogEntry(model, hints, entryIndex)
      : undefined;
    titles.set(model.name, modelCatalogDisplayTitle(model, catalogEntry));
  }
  return titles;
}

export function modelDisplayTitleFromMap(
  modelName: string,
  displayTitleByModelName: Map<string, string>,
): string {
  return displayTitleByModelName.get(modelName) ?? modelName;
}

export function modelCatalogDisplayTitle(
  model: ModelProfileSnapshot,
  catalogEntry: PreviewModelCatalogEntry | undefined,
): string {
  const catalogDisplayName = catalogEntry?.displayName?.trim();
  if (catalogDisplayName && catalogDisplayName.length > 0) {
    return catalogDisplayName;
  }
  if (providerSupportsModelCatalogDetail(model.provider)) {
    return model.name;
  }
  return formatModelDisplayNameFromId(model.name);
}

export function modelSettingsRowAriaLabel(
  defaultActionLabel: string,
  modelId: string,
  displayTitle: string,
): string {
  if (displayTitle !== modelId) {
    return `${defaultActionLabel}：${displayTitle}（${modelId}）`;
  }
  return `${defaultActionLabel}：${modelId}`;
}

type PricingLabelKey =
  | 'settings.modelDetailPricingInput'
  | 'settings.modelDetailPricingOutput'
  | 'settings.modelDetailPricingImage'
  | 'settings.modelDetailPricingRequest';

export function formatModelCatalogPricingLines(
  pricing: PreviewModelCatalogPricing | undefined,
  t: (key: PricingLabelKey, options?: { value: string }) => string,
): string[] {
  if (!pricing) {
    return [];
  }

  const lines: string[] = [];
  const input = formatUsdPerMillionTokens(pricing.inputPerTokenUsd);
  if (input) {
    lines.push(t('settings.modelDetailPricingInput', { value: input }));
  }
  const output = formatUsdPerMillionTokens(pricing.outputPerTokenUsd);
  if (output) {
    lines.push(t('settings.modelDetailPricingOutput', { value: output }));
  }
  const image = formatUsdFlatRate(pricing.imagePerUnitUsd);
  if (image) {
    lines.push(t('settings.modelDetailPricingImage', { value: image }));
  }
  const request = formatUsdFlatRate(pricing.requestPerCallUsd);
  if (request) {
    lines.push(t('settings.modelDetailPricingRequest', { value: request }));
  }
  return lines;
}

function formatUsdPerMillionTokens(value: string | undefined): string | undefined {
  const amount = parseUsdAmount(value);
  if (amount === undefined) {
    return undefined;
  }
  const perMillion = amount * 1_000_000;
  return formatUsd(perMillion);
}

function formatUsdFlatRate(value: string | undefined): string | undefined {
  const amount = parseUsdAmount(value);
  if (amount === undefined) {
    return undefined;
  }
  return formatUsd(amount);
}

function parseUsdAmount(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function formatUsd(amount: number): string {
  if (amount === 0) {
    return '$0';
  }
  const abs = Math.abs(amount);
  if (abs >= 1) {
    return `$${amount.toFixed(2)}`;
  }
  if (abs >= 0.01) {
    return `$${amount.toFixed(2)}`;
  }
  if (abs >= 0.0001) {
    return `$${amount.toFixed(4)}`;
  }
  return `$${amount.toExponential(2)}`;
}
