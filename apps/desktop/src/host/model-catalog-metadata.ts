import { formatModelDisplayNameFromId } from '@spirit-agent/core/model-display-name';
import type { ProviderListedModelEntry } from '@spirit-agent/host-internal';

import type {
  DesktopModelCapability,
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

function providerUsesUpstreamModelDisplayName(provider: DesktopModelProvider | undefined): boolean {
  return provider === 'vercel-ai-gateway' || provider === 'openrouter';
}

export function usesProviderListedModelCatalogMetadata(input: {
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
}): boolean {
  if (input.provider === 'moonshot-ai') {
    return true;
  }
  if (
    input.provider === 'vercel-ai-gateway'
    || input.provider === 'openrouter'
    || input.provider === 'volcengine'
  ) {
    return true;
  }
  return usesAnthropicModelCatalogMetadata(input);
}

export function previewModelCatalogForTransport(input: {
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  listedModels: readonly ProviderListedModelEntry[];
}): PreviewModelCatalogEntry[] | undefined {
  if (!usesProviderListedModelCatalogMetadata(input)) {
    return undefined;
  }

  return input.listedModels.map((entry) => ({
    id: entry.id,
    capabilities: previewCapabilitiesFromListedEntry(entry),
    ...resolvePreviewCatalogDisplayName(input.provider, entry),
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.pricing !== undefined ? { pricing: { ...entry.pricing } } : {}),
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
  if (!usesProviderListedModelCatalogMetadata(input) || !Array.isArray(input.modelCatalog)) {
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
        ...resolvePreviewCatalogDisplayName(input.provider, {
          id,
          displayName: entry.displayName,
        }),
        ...(entry.description !== undefined ? { description: entry.description } : {}),
        ...(entry.pricing !== undefined ? { pricing: { ...entry.pricing } } : {}),
        ...(entry.capabilities ? { capabilities: entry.capabilities } : {}),
        ...(entry.supportedReasoningEfforts !== undefined
          ? { supportedReasoningEfforts: normalizePreviewSupportedReasoningEfforts(entry.supportedReasoningEfforts) }
          : {}),
      },
    ]);
  }

  return new Map(normalized);
}

function resolvePreviewCatalogDisplayName(
  provider: DesktopModelProvider | undefined,
  entry: Pick<ProviderListedModelEntry, 'id' | 'displayName'>,
): { displayName?: string } {
  const upstreamDisplayName = entry.displayName?.trim();
  if (upstreamDisplayName) {
    return { displayName: upstreamDisplayName };
  }
  if (providerUsesUpstreamModelDisplayName(provider)) {
    return {};
  }
  return { displayName: formatModelDisplayNameFromId(entry.id) };
}

function previewCapabilitiesFromListedEntry(
  entry: ProviderListedModelEntry,
): DesktopModelCapability[] {
  if (entry.supportsImageGeneration === true) {
    return ['imageGeneration'];
  }

  if (entry.supportsVideoGeneration === true) {
    return ['chat', 'videoGeneration'];
  }

  const capabilities: DesktopModelCapability[] = ['chat'];
  if (entry.supportsImageInput === true) {
    capabilities.push('image');
  }
  if (entry.supportsVideoInput === true) {
    capabilities.push('video');
  }
  return capabilities;
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
