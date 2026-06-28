import { defaultModelReasoningEffort, type ModelReasoningEffort } from '@spirit-agent/core/reasoning-effort';
import { normalizeOpenAiApiBase } from '@spirit-agent/host-internal/openai-api-base';

import type {
  DesktopModelCapability,
  DesktopModelProvider,
  DesktopModelReasoningEffort,
  DesktopProviderConnectSiteId,
  DesktopTransportKind,
  ModelProfileSnapshot,
  PreviewModelCatalogEntry,
} from '../types.js';
import {
  providerSupportsModelCatalogListing,
  previewCatalogMapForTransport,
} from './model-catalog-metadata.js';
import {
  loadPreviewModelsForTransport,
  reasoningProviderForTransport,
  resolveDesktopTransportKind,
  supportsImageGeneration,
  supportsVideoGeneration,
  type LoadedPreviewModelsResult,
} from './model-config.js';
import {
  hasBedrockRuntimeCredentials,
  hasGoogleVertexRuntimeCredentials,
  modelExistsInProviderScope,
  modelProviderKeyScope,
  applyModelsRemovalToConfig,
} from './provider-api-key.js';
import {
  DEFAULT_API_BASE,
  normalizeModelCapabilities,
  normalizeSupportedReasoningEfforts,
  readBedrockProviderCredentialsFromKeyring,
  readGoogleVertexProviderCredentialsFromKeyring,
  resolveApiKeyForConfigModel,
  type DesktopConfigFile,
} from './storage.js';

export function modelCatalogScopeKey(model: Pick<ModelProfileSnapshot, 'provider' | 'transportKind' | 'apiBase'>): string {
  const base = model.apiBase.trim() || DEFAULT_API_BASE;
  const transportKind = resolveDesktopTransportKind(model);
  return `${model.provider ?? 'custom'}::${transportKind}::${normalizeOpenAiApiBase(base)}`;
}

export function collectModelCatalogRefreshTargets(
  models: readonly ModelProfileSnapshot[],
): ModelProfileSnapshot[] {
  const seen = new Set<string>();
  const targets: ModelProfileSnapshot[] = [];
  for (const model of models) {
    if (!providerSupportsModelCatalogListing(model)) {
      continue;
    }
    const key = modelCatalogScopeKey(model);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push(model);
  }
  return targets;
}

export async function forceRefreshModelCatalogForProfile(
  config: Pick<DesktopConfigFile, 'models'>,
  profile: ModelProfileSnapshot,
): Promise<LoadedPreviewModelsResult | undefined> {
  const provider = profile.provider;
  if (!provider || !providerSupportsModelCatalogListing(profile)) {
    return undefined;
  }

  const transportKind = resolveDesktopTransportKind(profile);
  const apiBase = profile.apiBase.trim() || DEFAULT_API_BASE;
  const apiKey = await resolveApiKeyForConfigModel(config, profile.name);

  if (transportKind === 'bedrock') {
    const bedrockCredentials = readBedrockProviderCredentialsFromKeyring(modelProviderKeyScope(provider));
    if (
      !profile.awsRegion?.trim()
      || !hasBedrockRuntimeCredentials({
        apiKey,
        accessKeyId: bedrockCredentials.accessKeyId,
        secretAccessKey: bedrockCredentials.secretAccessKey,
      })
    ) {
      return undefined;
    }
    return loadPreviewModelsForTransport({
      provider,
      transportKind,
      apiBase,
      apiKey: apiKey?.trim() ?? bedrockCredentials.apiKey?.trim() ?? '',
      awsRegion: profile.awsRegion,
      accessKeyId: bedrockCredentials.accessKeyId,
      secretAccessKey: bedrockCredentials.secretAccessKey,
      forceRefresh: true,
    });
  }

  if (provider === 'google-vertex-ai') {
    const vertexCredentials = readGoogleVertexProviderCredentialsFromKeyring('google-vertex-ai');
    if (
      !hasGoogleVertexRuntimeCredentials({
        apiKey,
        clientEmail: vertexCredentials.clientEmail,
        privateKey: vertexCredentials.privateKey,
        vertexProject: profile.vertexProject,
        vertexLocation: profile.vertexLocation,
      })
    ) {
      return undefined;
    }
    return loadPreviewModelsForTransport({
      provider,
      transportKind,
      apiBase,
      apiKey: apiKey?.trim() ?? vertexCredentials.apiKey?.trim() ?? '',
      ...(profile.vertexProject ? { vertexProject: profile.vertexProject } : {}),
      ...(profile.vertexLocation ? { vertexLocation: profile.vertexLocation } : {}),
      ...(vertexCredentials.clientEmail ? { vertexClientEmail: vertexCredentials.clientEmail } : {}),
      ...(vertexCredentials.privateKey ? { vertexPrivateKey: vertexCredentials.privateKey } : {}),
      forceRefresh: true,
    });
  }

  if (!apiKey?.trim()) {
    return undefined;
  }

  return loadPreviewModelsForTransport({
    provider,
    transportKind,
    apiBase,
    apiKey: apiKey.trim(),
    forceRefresh: true,
  });
}

type StartupMergedProfile = {
  name: string;
  apiBase: string;
  reasoningEffort: ModelReasoningEffort;
  supportedReasoningEfforts?: DesktopModelReasoningEffort[];
  capabilities?: DesktopModelCapability[];
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  awsRegion?: string;
  providerSite?: DesktopProviderConnectSiteId;
  alibabaWorkspaceId?: string;
  vertexProject?: string;
  vertexLocation?: string;
};

export function mergeNewCatalogModelsIntoConfig(
  config: DesktopConfigFile,
  profile: ModelProfileSnapshot,
  result: LoadedPreviewModelsResult,
): number {
  const provider = profile.provider;
  if (!provider) {
    return 0;
  }

  const transportKind = resolveDesktopTransportKind(profile);
  const apiBase = profile.apiBase.trim() || DEFAULT_API_BASE;
  const catalogEntries = previewCatalogMapForTransport({
    provider,
    transportKind,
    modelCatalog: result.modelCatalog,
  });

  const toAdd: StartupMergedProfile[] = [];
  for (const name of result.modelIds) {
    const trimmed = name.trim();
    if (!trimmed || modelExistsInProviderScope(config.models, trimmed, provider)) {
      continue;
    }
    const catalogEntry = catalogEntries.get(trimmed);
    const merged: StartupMergedProfile = {
      name: trimmed,
      apiBase,
      reasoningEffort: defaultModelReasoningEffort({
        ...(reasoningProviderForTransport(provider, transportKind)
          ? { provider: reasoningProviderForTransport(provider, transportKind) }
          : {}),
        model: trimmed,
        ...(catalogEntry?.supportedReasoningEfforts !== undefined
          ? { supportedEfforts: catalogEntry.supportedReasoningEfforts }
          : {}),
      }),
    };
    if (catalogEntry?.supportedReasoningEfforts !== undefined) {
      merged.supportedReasoningEfforts = catalogEntry.supportedReasoningEfforts;
    }
    if (catalogEntry?.capabilities) {
      merged.capabilities = catalogEntry.capabilities;
    }
    merged.provider = provider;
    if (transportKind === 'anthropic' || transportKind === 'open-responses' || transportKind === 'bedrock') {
      merged.transportKind = transportKind;
    }
    if (provider === 'amazon-bedrock' && profile.awsRegion?.trim()) {
      merged.awsRegion = profile.awsRegion.trim();
    }
    if (profile.providerSite) {
      merged.providerSite = profile.providerSite;
    }
    if (provider === 'alibaba' && profile.alibabaWorkspaceId?.trim()) {
      merged.alibabaWorkspaceId = profile.alibabaWorkspaceId.trim();
    }
    if (provider === 'google-vertex-ai') {
      if (profile.vertexProject?.trim()) {
        merged.vertexProject = profile.vertexProject.trim();
      }
      if (profile.vertexLocation?.trim()) {
        merged.vertexLocation = profile.vertexLocation.trim();
      }
    }
    toAdd.push(merged);
  }

  if (toAdd.length === 0) {
    return 0;
  }

  for (const merged of toAdd) {
    config.models.push(merged);
  }

  if (!config.imageGenerationModel) {
    const imageGenerationProfile = toAdd.find((entry) => supportsImageGeneration(entry));
    if (imageGenerationProfile) {
      config.imageGenerationModel = imageGenerationProfile.name;
    }
  }
  if (!config.videoGenerationModel) {
    const videoGenerationProfile = toAdd.find((entry) => supportsVideoGeneration(entry));
    if (videoGenerationProfile) {
      config.videoGenerationModel = videoGenerationProfile.name;
    }
  }

  return toAdd.length;
}

function modelMatchesCatalogRefreshScope(
  model: ModelProfileSnapshot,
  provider: DesktopModelProvider,
  transportKind: DesktopTransportKind,
  apiBase: string,
): boolean {
  if (model.provider !== provider) {
    return false;
  }
  if (resolveDesktopTransportKind(model) !== transportKind) {
    return false;
  }
  const modelBase = model.apiBase.trim() || DEFAULT_API_BASE;
  return normalizeOpenAiApiBase(modelBase) === normalizeOpenAiApiBase(apiBase);
}

function normalizedCapabilitiesEqual(
  left: readonly DesktopModelCapability[] | undefined,
  right: readonly DesktopModelCapability[] | undefined,
): boolean {
  const normalizedLeft = normalizeModelCapabilities(left);
  const normalizedRight = normalizeModelCapabilities(right);
  if (normalizedLeft === undefined && normalizedRight === undefined) {
    return true;
  }
  if (!normalizedLeft || !normalizedRight || normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((capability, index) => capability === normalizedRight[index]);
}

function normalizedReasoningEffortsEqual(
  left: readonly DesktopModelReasoningEffort[] | undefined,
  right: readonly DesktopModelReasoningEffort[] | undefined,
): boolean {
  const normalizedLeft = normalizeSupportedReasoningEfforts(left);
  const normalizedRight = normalizeSupportedReasoningEfforts(right);
  if (normalizedLeft === undefined && normalizedRight === undefined) {
    return true;
  }
  if (!normalizedLeft || !normalizedRight || normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((effort, index) => effort === normalizedRight[index]);
}

function parseCatalogContextLength(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.trunc(value);
}

/** Apply catalog-derived profile fields; returns whether the stored model changed. */
export function applyCatalogEntryToStoredModel(
  model: ModelProfileSnapshot,
  catalogEntry: PreviewModelCatalogEntry,
): boolean {
  let changed = false;

  if (catalogEntry.capabilities?.length) {
    const nextCapabilities = normalizeModelCapabilities(catalogEntry.capabilities);
    if (nextCapabilities && !normalizedCapabilitiesEqual(model.capabilities, nextCapabilities)) {
      model.capabilities = nextCapabilities;
      changed = true;
    }
  }

  if (catalogEntry.supportedReasoningEfforts !== undefined) {
    const nextReasoningEfforts = normalizeSupportedReasoningEfforts(catalogEntry.supportedReasoningEfforts);
    if (!normalizedReasoningEffortsEqual(model.supportedReasoningEfforts, nextReasoningEfforts)) {
      if (nextReasoningEfforts && nextReasoningEfforts.length > 0) {
        model.supportedReasoningEfforts = nextReasoningEfforts;
      } else {
        delete model.supportedReasoningEfforts;
      }
      changed = true;
    }
  }

  if (model.contextLength === undefined) {
    const nextContextLength = parseCatalogContextLength(catalogEntry.contextLength);
    if (nextContextLength !== undefined) {
      model.contextLength = nextContextLength;
      changed = true;
    }
  }

  return changed;
}

/** 将目录 catalog 条目回写到同作用域内已入库模型（capabilities / supportedReasoningEfforts 等）。 */
export function syncExistingModelsFromCatalog(
  config: DesktopConfigFile,
  profile: ModelProfileSnapshot,
  result: LoadedPreviewModelsResult,
): number {
  const provider = profile.provider;
  if (!provider) {
    return 0;
  }

  const transportKind = resolveDesktopTransportKind(profile);
  const apiBase = profile.apiBase.trim() || DEFAULT_API_BASE;
  const catalogEntries = previewCatalogMapForTransport({
    provider,
    transportKind,
    modelCatalog: result.modelCatalog,
  });
  if (catalogEntries.size === 0) {
    return 0;
  }

  let updated = 0;
  for (const model of config.models) {
    if (!modelMatchesCatalogRefreshScope(model, provider, transportKind, apiBase)) {
      continue;
    }
    const catalogEntry = catalogEntries.get(model.name);
    if (!catalogEntry) {
      continue;
    }
    if (applyCatalogEntryToStoredModel(model, catalogEntry)) {
      updated += 1;
    }
  }
  return updated;
}

/** 移除同作用域内已不在上游目录中的已入库模型。 */
export function removeDelistedModelsFromCatalog(
  config: DesktopConfigFile,
  profile: ModelProfileSnapshot,
  result: LoadedPreviewModelsResult,
): readonly string[] {
  const provider = profile.provider;
  if (!provider) {
    return [];
  }
  const catalogIds = new Set(
    result.modelIds.map((id) => id.trim()).filter((id) => id.length > 0),
  );
  if (catalogIds.size === 0) {
    return [];
  }

  const transportKind = resolveDesktopTransportKind(profile);
  const apiBase = profile.apiBase.trim() || DEFAULT_API_BASE;
  const targetsToRemove: Array<{ name: string; provider?: typeof provider }> = [];
  for (const model of config.models) {
    if (!modelMatchesCatalogRefreshScope(model, provider, transportKind, apiBase)) {
      continue;
    }
    if (!catalogIds.has(model.name)) {
      targetsToRemove.push({ name: model.name, provider: model.provider });
    }
  }
  if (targetsToRemove.length === 0) {
    return [];
  }
  applyModelsRemovalToConfig(config, targetsToRemove);
  return targetsToRemove.map((target) => target.name);
}

export async function refreshConfiguredModelCatalogsOnStartup(
  config: DesktopConfigFile,
): Promise<{
  attempted: number;
  refreshed: number;
  skipped: number;
  merged: number;
  synced: number;
  pruned: number;
  prunedModelNames: readonly string[];
}> {
  const targets = collectModelCatalogRefreshTargets(config.models);
  let refreshed = 0;
  let skipped = 0;
  let merged = 0;
  let synced = 0;
  const prunedModelNames: string[] = [];

  for (const profile of targets) {
    try {
      const result = await forceRefreshModelCatalogForProfile(config, profile);
      if (result) {
        refreshed += 1;
        merged += mergeNewCatalogModelsIntoConfig(config, profile, result);
        prunedModelNames.push(...removeDelistedModelsFromCatalog(config, profile, result));
        synced += syncExistingModelsFromCatalog(config, profile, result);
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }

  return {
    attempted: targets.length,
    refreshed,
    skipped,
    merged,
    synced,
    pruned: prunedModelNames.length,
    prunedModelNames,
  };
}
