import { PROVIDER_PICKER_ROWS } from "@/host/provider-presets";
import type {
  DesktopModelCatalogHint,
  DesktopModelProvider,
  ModelProfileSnapshot,
} from "@/types";

const PROVIDER_ORDER: DesktopModelProvider[] = ["deepseek", "kimi", "minimax", "custom"];

function providerLabel(provider: DesktopModelProvider): string {
  return PROVIDER_PICKER_ROWS.find((row) => row.id === provider)?.label ?? provider;
}

function catalogOrderIndex(name: string, apiBase: string, hints: DesktopModelCatalogHint[] | undefined): number {
  const hint = hints?.find((h) => h.apiBase === apiBase);
  if (!hint) {
    return 10_000;
  }
  const idx = hint.modelIds.indexOf(name);
  return idx === -1 ? 10_000 + 1 : idx;
}

export type ModelPickerGroup = {
  provider: DesktopModelProvider;
  label: string;
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
      const oa = catalogOrderIndex(a.name, a.apiBase, catalogHints);
      const ob = catalogOrderIndex(b.name, b.apiBase, catalogHints);
      if (oa !== ob) {
        return oa - ob;
      }
      return a.name.localeCompare(b.name);
    });
    return {
      provider,
      label: providerLabel(provider),
      items,
    };
  });
}
