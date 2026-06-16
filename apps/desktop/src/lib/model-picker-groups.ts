import {
  MODEL_PROVIDER_PICKER_ORDER,
  PROVIDER_PICKER_ROWS,
} from "@spirit-agent/host-internal/model-provider-presets";
import { normalizeOpenAiApiBase } from "@spirit-agent/host-internal/openai-api-base";
import type {
  DesktopModelCatalogHint,
  DesktopModelProvider,
  DesktopTransportKind,
  ModelProfileSnapshot,
} from "@/types";

const PROVIDER_ORDER: DesktopModelProvider[] = [...MODEL_PROVIDER_PICKER_ORDER];

export function providerLabelMetadata(provider: DesktopModelProvider): { labelKey: string; fallbackLabel: string } {
  const row = PROVIDER_PICKER_ROWS.find((item) => item.id === provider);
  return row ? { labelKey: row.labelKey, fallbackLabel: row.fallbackLabel } : { labelKey: provider, fallbackLabel: provider };
}

function normalizeTransportKind(
  transportKind: DesktopTransportKind | undefined,
  provider?: DesktopModelProvider,
): DesktopTransportKind {
  if (transportKind) {
    return transportKind;
  }

  return provider === 'anthropic' ? 'anthropic' : 'openai-compatible';
}

function catalogOrderIndex(
  name: string,
  apiBase: string,
  transportKind: DesktopTransportKind,
  hints: DesktopModelCatalogHint[] | undefined,
): number {
  const normalizedBase = normalizeOpenAiApiBase(apiBase);
  const hint = hints?.find((h) =>
    normalizeOpenAiApiBase(h.apiBase) === normalizedBase
    && normalizeTransportKind(h.transportKind, h.provider) === transportKind,
  );
  if (!hint) {
    return 10_000;
  }
  const idx = hint.modelIds.indexOf(name);
  return idx === -1 ? 10_000 + 1 : idx;
}

export type ModelPickerGroup = {
  provider: DesktopModelProvider;
  labelKey: string;
  fallbackLabel: string;
  items: ModelProfileSnapshot[];
};

/**
 * 主界面模型下拉：按提供商分组；组内顺序优先对齐 `modelCatalogHints` 中的上游列表顺序。
 */
export function groupModelsForPicker(
  models: ModelProfileSnapshot[],
  catalogHints: DesktopModelCatalogHint[] | undefined,
): ModelPickerGroup[] {
  const buckets = new Map<DesktopModelProvider, ModelProfileSnapshot[]>();
  for (const m of models) {
    const p: DesktopModelProvider = m.provider ?? "custom";
    const list = buckets.get(p) ?? [];
    list.push(m);
    buckets.set(p, list);
  }

  const keys = [...buckets.keys()].sort((a, b) => {
    const ia = PROVIDER_ORDER.indexOf(a);
    const ib = PROVIDER_ORDER.indexOf(b);
    if (ia !== ib) {
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    }
    return a.localeCompare(b);
  });

  return keys.map((provider) => {
    const items = (buckets.get(provider) ?? []).slice().sort((a, b) => {
      const filteredHints = catalogHints?.filter((hint) => (hint.provider ?? 'custom') === provider);
      const aTransportKind = normalizeTransportKind(a.transportKind, a.provider);
      const bTransportKind = normalizeTransportKind(b.transportKind, b.provider);
      const oa = catalogOrderIndex(
        a.name,
        a.apiBase,
        aTransportKind,
        filteredHints,
      );
      const ob = catalogOrderIndex(
        b.name,
        b.apiBase,
        bTransportKind,
        filteredHints,
      );
      if (oa !== ob) {
        return oa - ob;
      }
      return a.name.localeCompare(b.name);
    });
    return {
      provider,
      ...providerLabelMetadata(provider),
      items,
    };
  });
}
