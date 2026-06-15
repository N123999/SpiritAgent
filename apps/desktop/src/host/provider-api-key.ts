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

export interface BedrockProviderCredentials {
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export function hasBedrockRuntimeCredentials(credentials: BedrockProviderCredentials): boolean {
  if (credentials.apiKey?.trim()) {
    return true;
  }
  return Boolean(credentials.accessKeyId?.trim() && credentials.secretAccessKey?.trim());
}

/** Config profiles without `provider` are treated as custom-scoped keys. */
export function modelProviderKeyScope(provider?: DesktopModelProvider): DesktopModelProvider {
  return provider ?? 'custom';
}

export interface ModelKeyPresenceProfile {
  name: string;
  provider?: DesktopModelProvider;
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
  hasProviderKey: (providerId: string) => boolean,
  hasModelKey: (modelName: string) => boolean,
): Record<string, boolean> {
  const providerCache = new Map<string, boolean>();
  const out: Record<string, boolean> = {};
  for (const { name, provider } of profiles) {
    const scope = modelProviderKeyScope(provider);
    let providerPresent = providerCache.get(scope);
    if (providerPresent === undefined) {
      providerPresent = hasProviderKey(scope);
      providerCache.set(scope, providerPresent);
    }
    out[name] = providerPresent ? true : hasModelKey(name);
  }
  return out;
}
