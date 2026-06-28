import type { DesktopModelProvider } from '../types.js';

/** Keyring account for a provider-scoped API key (`SpiritAgent` / `provider::{id}`). */
export function providerKeyAccount(providerId: string): string {
  return `provider::${providerId}`;
}

export function providerAccessKeyIdAccount(providerId: string): string {
  return `provider::${providerId}::access-key-id`;
}

export function providerSecretAccessKeyAccount(providerId: string): string {
  return `provider::${providerId}::secret-access-key`;
}

export function providerVertexClientEmailAccount(providerId: string): string {
  return `provider::${providerId}::client-email`;
}

export function providerVertexPrivateKeyAccount(providerId: string): string {
  return `provider::${providerId}::private-key`;
}

export interface BedrockProviderCredentials {
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

export function hasBedrockRuntimeCredentials(credentials: BedrockProviderCredentials): boolean {
  if (credentials.apiKey?.trim()) {
    return true;
  }
  return hasBedrockIamCredentials(credentials);
}

export function hasBedrockIamCredentials(
  credentials: Pick<BedrockProviderCredentials, 'accessKeyId' | 'secretAccessKey'>,
): boolean {
  return Boolean(credentials.accessKeyId?.trim() && credentials.secretAccessKey?.trim());
}

export interface GoogleVertexProviderCredentials {
  apiKey?: string;
  clientEmail?: string;
  privateKey?: string;
}

export function hasGoogleVertexServiceAccountCredentials(
  credentials: Pick<GoogleVertexProviderCredentials, 'clientEmail' | 'privateKey'>,
): boolean {
  return Boolean(credentials.clientEmail?.trim() && credentials.privateKey?.trim());
}

export function hasGoogleVertexRuntimeCredentials(input: {
  apiKey?: string;
  clientEmail?: string;
  privateKey?: string;
  vertexProject?: string;
  vertexLocation?: string;
}): boolean {
  if (input.apiKey?.trim()) {
    return true;
  }
  if (hasGoogleVertexServiceAccountCredentials(input)) {
    return Boolean(input.vertexProject?.trim() && input.vertexLocation?.trim());
  }
  return Boolean(input.vertexProject?.trim() && input.vertexLocation?.trim());
}

/** Config profiles without `provider` are treated as custom-scoped keys. */
export function modelProviderKeyScope(provider?: DesktopModelProvider): DesktopModelProvider {
  return provider ?? 'custom';
}

export interface ModelKeyPresenceProfile {
  name: string;
  provider?: DesktopModelProvider;
  vertexProject?: string;
  vertexLocation?: string;
}

export type ExistingModelForProviderAdd = ModelKeyPresenceProfile;

/** True when the same model id is already configured under this provider scope. */
export function modelExistsInProviderScope(
  existingModels: readonly ExistingModelForProviderAdd[],
  name: string,
  provider?: DesktopModelProvider,
): boolean {
  const scope = modelProviderKeyScope(provider);
  return existingModels.some(
    (model) => model.name === name && modelProviderKeyScope(model.provider) === scope,
  );
}

/** After removing models, keep active if still valid; else first remaining or empty. */
export function resolveActiveModelAfterRemoval(
  currentActive: string,
  remainingModels: readonly Pick<ModelKeyPresenceProfile, 'name'>[],
  removedNames: readonly string[],
): string {
  if (!removedNames.some((name) => name === currentActive)) {
    return currentActive;
  }
  return remainingModels[0]?.name ?? '';
}

type ModelRemovalConfigTarget = {
  models: Array<{ name: string; provider?: DesktopModelProvider }>;
  activeModel: string;
  imageGenerationModel?: string;
  videoGenerationModel?: string;
  lightweightChatModel?: string;
};

export type ModelRemovalTarget = {
  name: string;
  provider?: DesktopModelProvider;
};

function modelMatchesRemovalTarget(
  model: { name: string; provider?: DesktopModelProvider },
  target: ModelRemovalTarget,
): boolean {
  if (model.name !== target.name) {
    return false;
  }
  if (target.provider === undefined) {
    return true;
  }
  return modelProviderKeyScope(model.provider) === modelProviderKeyScope(target.provider);
}

function clearDefaultSlotIfNoRemainingModel(
  config: ModelRemovalConfigTarget,
  slot: 'imageGenerationModel' | 'videoGenerationModel' | 'lightweightChatModel',
): void {
  const value = config[slot];
  if (value && !config.models.some((model) => model.name === value)) {
    delete config[slot];
  }
}

/** Remove models from config and clear dependent default slots (same semantics as settings delete). */
export function applyModelsRemovalToConfig(
  config: ModelRemovalConfigTarget,
  targetsToRemove: readonly ModelRemovalTarget[],
): number {
  if (targetsToRemove.length === 0) {
    return 0;
  }
  const before = config.models.length;
  config.models = config.models.filter(
    (model) => !targetsToRemove.some((target) => modelMatchesRemovalTarget(model, target)),
  );
  const removed = before - config.models.length;

  if (!config.models.some((model) => model.name === config.activeModel)) {
    config.activeModel = config.models[0]?.name ?? '';
  }
  clearDefaultSlotIfNoRemainingModel(config, 'imageGenerationModel');
  clearDefaultSlotIfNoRemainingModel(config, 'videoGenerationModel');
  clearDefaultSlotIfNoRemainingModel(config, 'lightweightChatModel');
  return removed;
}

/** Model ids from `modelIds` that are not already present under the target provider scope. */
export function filterNewProviderModelIds(
  existingModels: readonly ExistingModelForProviderAdd[],
  modelIds: readonly string[],
  provider?: DesktopModelProvider,
): string[] {
  return modelIds.filter((name) => !modelExistsInProviderScope(existingModels, name, provider));
}

/**
 * Per-model keyring presence: provider-level entry OR legacy per-model entry.
 * Does not include env vars or global fallback (snapshot `keyConfigured` semantics).
 */
export function buildModelSecretKeyPresence(
  profiles: ModelKeyPresenceProfile[],
  hasProviderKey: (providerId: string, profile: ModelKeyPresenceProfile) => boolean,
  hasModelKey: (modelName: string) => boolean,
): Record<string, boolean> {
  const providerCache = new Map<string, boolean>();
  const out: Record<string, boolean> = {};
  for (const profile of profiles) {
    const scope = modelProviderKeyScope(profile.provider);
    const cacheKey = profile.provider === 'google-vertex-ai'
      ? `${scope}::${profile.vertexProject?.trim() ?? ''}::${profile.vertexLocation?.trim() ?? ''}`
      : scope;
    let providerPresent = providerCache.get(cacheKey);
    if (providerPresent === undefined) {
      providerPresent = hasProviderKey(scope, profile);
      providerCache.set(cacheKey, providerPresent);
    }
    out[profile.name] = providerPresent ? true : hasModelKey(profile.name);
  }
  return out;
}
