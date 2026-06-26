import { defaultModelReasoningEffort, type ModelReasoningEffort } from '@spirit-agent/core/reasoning-effort';
import { normalizeOpenAiApiBase } from '@spirit-agent/host-internal/openai-api-base';

import type {
  DesktopModelCapability,
  DesktopModelProvider,
  DesktopModelReasoningEffort,
  DesktopProviderConnectSiteId,
  DesktopTransportKind,
  ModelProfileSnapshot,
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
} from './provider-api-key.js';
import {
  DEFAULT_API_BASE,
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

/** 将目录中新标注的 image/video 能力补写到仅存 chat 的已入库模型（如 MiniMax-M3）。 */
export function syncExistingModelCapabilitiesFromCatalog(
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
    if (!catalogEntry?.capabilities?.length) {
      continue;
    }
    const stored = model.capabilities;
    const onlyChat = stored?.length === 1 && stored[0] === 'chat';
    const catalogHasMultimodalInput = catalogEntry.capabilities.some(
      (capability) => capability === 'image' || capability === 'video',
    );
    if (!onlyChat || !catalogHasMultimodalInput) {
      continue;
    }
    model.capabilities = catalogEntry.capabilities;
    updated += 1;
  }
  return updated;
}

export async function refreshConfiguredModelCatalogsOnStartup(
  config: DesktopConfigFile,
): Promise<{ attempted: number; refreshed: number; skipped: number; merged: number; synced: number }> {
  const targets = collectModelCatalogRefreshTargets(config.models);
  let refreshed = 0;
  let skipped = 0;
  let merged = 0;
  let synced = 0;

  for (const profile of targets) {
    try {
      const result = await forceRefreshModelCatalogForProfile(config, profile);
      if (result) {
        refreshed += 1;
        merged += mergeNewCatalogModelsIntoConfig(config, profile, result);
        synced += syncExistingModelCapabilitiesFromCatalog(config, profile, result);
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }

  return { attempted: targets.length, refreshed, skipped, merged, synced };
}
