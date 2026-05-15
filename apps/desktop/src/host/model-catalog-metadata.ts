import type { ProviderListedModelEntry } from '@spirit-agent/host-internal';

import type {
  DesktopModelProvider,
  DesktopModelReasoningEffort,
  DesktopTransportKind,
  PreviewModelCatalogEntry,
} from '../types.js';

export function usesAnthropicModelCatalogMetadata(input: {
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
}): boolean {
  return input.transportKind === 'anthropic' || input.provider === 'anthropic';
}

export function previewModelCatalogForTransport(input: {
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  listedModels: readonly ProviderListedModelEntry[];
}): PreviewModelCatalogEntry[] | undefined {
  if (!usesAnthropicModelCatalogMetadata(input)) {
    return undefined;
  }

  return input.listedModels.map((entry) => ({
    id: entry.id,
    capabilities: entry.supportsVision === true ? ['chat', 'vision'] : ['chat'],
    ...(entry.supportedReasoningEfforts !== undefined
      ? { supportedReasoningEfforts: normalizePreviewSupportedReasoningEfforts(entry.supportedReasoningEfforts) }
      : {}),
  }));
}

export function previewCatalogMapForTransport(input: {
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  modelCatalog?: readonly PreviewModelCatalogEntry[];
}): Map<string, PreviewModelCatalogEntry> {
  if (!usesAnthropicModelCatalogMetadata(input) || !Array.isArray(input.modelCatalog)) {
    return new Map();
  }

  const normalized: Array<[string, PreviewModelCatalogEntry]> = [];
  for (const entry of input.modelCatalog) {
    const id = entry.id.trim();
    if (!id) {
      continue;
    }
    normalized.push([
      id,
      {
        id,
        ...(entry.capabilities ? { capabilities: entry.capabilities } : {}),
        ...(entry.supportedReasoningEfforts !== undefined
          ? { supportedReasoningEfforts: normalizePreviewSupportedReasoningEfforts(entry.supportedReasoningEfforts) }
          : {}),
      },
    ]);
  }

  return new Map(normalized);
}

function normalizePreviewSupportedReasoningEfforts(
  values: readonly DesktopModelReasoningEffort[],
): DesktopModelReasoningEffort[] {
  const seen = new Set<string>();
  const normalized: DesktopModelReasoningEffort[] = [];
  for (const value of values) {
    const effort = value.trim().toLowerCase();
    if (!effort || effort === 'default' || seen.has(effort)) {
      continue;
    }
    seen.add(effort);
    normalized.push(effort);
  }
  return normalized;
}