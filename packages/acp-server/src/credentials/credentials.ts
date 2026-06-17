import type { ModelProviderId } from '@spirit-agent/host-internal';

import { keyringStore } from './keyring-store.js';
import {
  KEYRING_GLOBAL_ACCOUNT,
  KEYRING_SERVICE,
  modelKeyAccount,
  modelProviderKeyScope,
  providerAccessKeyIdAccount,
  providerKeyAccount,
  providerSecretAccessKeyAccount,
  providerVertexClientEmailAccount,
  providerVertexPrivateKeyAccount,
} from './provider-accounts.js';
import {
  loadActiveModelProfile,
  loadSpiritConfig,
  saveSpiritConfig,
} from './spirit-config.js';
import type {
  BedrockSetupCredentials,
  GoogleVertexSetupCredentials,
  ProviderSetupResult,
  SpiritConfigFile,
  SpiritModelProfile,
} from './types.js';

export { loadActiveModelProfile, loadSpiritConfig, saveSpiritConfig };
export type { ProviderSetupResult, SpiritConfigFile, SpiritModelProfile };

function readProviderKey(providerId: string): string | undefined {
  const value = keyringStore().getPassword(KEYRING_SERVICE, providerKeyAccount(providerId));
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function readModelKey(modelName: string): string | undefined {
  const value = keyringStore().getPassword(KEYRING_SERVICE, modelKeyAccount(modelName));
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function readGlobalKey(): string | undefined {
  const value = keyringStore().getPassword(KEYRING_SERVICE, KEYRING_GLOBAL_ACCOUNT);
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function readBedrockCredentials(providerId: ModelProviderId): BedrockSetupCredentials {
  const credentials: BedrockSetupCredentials = {};
  const apiKey = readProviderKey(providerId);
  if (apiKey) {
    credentials.apiKey = apiKey;
  }
  const accessKeyId = keyringStore()
    .getPassword(KEYRING_SERVICE, providerAccessKeyIdAccount(providerId))
    ?.trim();
  if (accessKeyId) {
    credentials.accessKeyId = accessKeyId;
  }
  const secretAccessKey = keyringStore()
    .getPassword(KEYRING_SERVICE, providerSecretAccessKeyAccount(providerId))
    ?.trim();
  if (secretAccessKey) {
    credentials.secretAccessKey = secretAccessKey;
  }
  return credentials;
}

export function readGoogleVertexCredentials(
  providerId: ModelProviderId,
): GoogleVertexSetupCredentials {
  const credentials: GoogleVertexSetupCredentials = {};
  const apiKey = readProviderKey(providerId);
  if (apiKey) {
    credentials.apiKey = apiKey;
  }
  const clientEmail = keyringStore()
    .getPassword(KEYRING_SERVICE, providerVertexClientEmailAccount(providerId))
    ?.trim();
  if (clientEmail) {
    credentials.clientEmail = clientEmail;
  }
  const privateKey = keyringStore()
    .getPassword(KEYRING_SERVICE, providerVertexPrivateKeyAccount(providerId))
    ?.trim();
  if (privateKey) {
    credentials.privateKey = privateKey;
  }
  return credentials;
}

function hasBedrockRuntimeCredentials(credentials: BedrockSetupCredentials): boolean {
  if (credentials.apiKey?.trim()) {
    return true;
  }
  return Boolean(credentials.accessKeyId?.trim() && credentials.secretAccessKey?.trim());
}

function hasGoogleVertexRuntimeCredentials(input: {
  apiKey?: string;
  clientEmail?: string;
  privateKey?: string;
  vertexProject?: string;
  vertexLocation?: string;
}): boolean {
  if (input.apiKey?.trim()) {
    return true;
  }
  if (input.clientEmail?.trim() && input.privateKey?.trim()) {
    return Boolean(input.vertexProject?.trim() && input.vertexLocation?.trim());
  }
  return Boolean(input.vertexProject?.trim() && input.vertexLocation?.trim());
}

function hasProviderSecret(providerId: ModelProviderId, profile: SpiritModelProfile): boolean {
  if (readProviderKey(providerId)) {
    return true;
  }
  if (providerId === 'amazon-bedrock') {
    return hasBedrockRuntimeCredentials(readBedrockCredentials('amazon-bedrock'));
  }
  if (providerId === 'google-vertex-ai') {
    const credentials = readGoogleVertexCredentials('google-vertex-ai');
    const vertexInput: {
      apiKey?: string;
      clientEmail?: string;
      privateKey?: string;
      vertexProject?: string;
      vertexLocation?: string;
    } = {};
    if (credentials.apiKey) {
      vertexInput.apiKey = credentials.apiKey;
    }
    if (credentials.clientEmail) {
      vertexInput.clientEmail = credentials.clientEmail;
    }
    if (credentials.privateKey) {
      vertexInput.privateKey = credentials.privateKey;
    }
    if (profile.vertexProject) {
      vertexInput.vertexProject = profile.vertexProject;
    }
    if (profile.vertexLocation) {
      vertexInput.vertexLocation = profile.vertexLocation;
    }
    return hasGoogleVertexRuntimeCredentials(vertexInput);
  }
  return false;
}

export function resolveStoredApiKeyForProfile(profile: SpiritModelProfile): string | undefined {
  const scope = modelProviderKeyScope(profile.provider);
  const providerKey = readProviderKey(scope);
  if (providerKey) {
    return providerKey;
  }
  const modelKey = readModelKey(profile.name);
  if (modelKey) {
    return modelKey;
  }
  return readGlobalKey();
}

export function hasResolvableCredentials(spiritDataDir: string): boolean {
  const profile = loadActiveModelProfile(spiritDataDir);
  if (!profile) {
    return false;
  }
  const scope = modelProviderKeyScope(profile.provider);
  if (hasProviderSecret(scope, profile)) {
    return true;
  }
  return Boolean(resolveStoredApiKeyForProfile(profile));
}

function saveProviderApiKey(providerId: ModelProviderId, apiKey: string | undefined): void {
  const store = keyringStore();
  const account = providerKeyAccount(providerId);
  if (apiKey?.trim()) {
    store.setPassword(KEYRING_SERVICE, account, apiKey.trim());
    return;
  }
  store.deletePassword(KEYRING_SERVICE, account);
}

function saveBedrockCredentials(
  providerId: ModelProviderId,
  credentials: BedrockSetupCredentials,
): void {
  saveProviderApiKey(providerId, credentials.apiKey);
  const store = keyringStore();
  const accessKeyId = credentials.accessKeyId?.trim();
  if (accessKeyId) {
    store.setPassword(KEYRING_SERVICE, providerAccessKeyIdAccount(providerId), accessKeyId);
  } else {
    store.deletePassword(KEYRING_SERVICE, providerAccessKeyIdAccount(providerId));
  }
  const secretAccessKey = credentials.secretAccessKey?.trim();
  if (secretAccessKey) {
    store.setPassword(KEYRING_SERVICE, providerSecretAccessKeyAccount(providerId), secretAccessKey);
  } else {
    store.deletePassword(KEYRING_SERVICE, providerSecretAccessKeyAccount(providerId));
  }
}

function saveGoogleVertexCredentials(
  providerId: ModelProviderId,
  credentials: GoogleVertexSetupCredentials,
): void {
  saveProviderApiKey(providerId, credentials.apiKey);
  const store = keyringStore();
  const clientEmail = credentials.clientEmail?.trim();
  if (clientEmail) {
    store.setPassword(KEYRING_SERVICE, providerVertexClientEmailAccount(providerId), clientEmail);
  } else {
    store.deletePassword(KEYRING_SERVICE, providerVertexClientEmailAccount(providerId));
  }
  const privateKey = credentials.privateKey?.trim();
  if (privateKey) {
    store.setPassword(KEYRING_SERVICE, providerVertexPrivateKeyAccount(providerId), privateKey);
  } else {
    store.deletePassword(KEYRING_SERVICE, providerVertexPrivateKeyAccount(providerId));
  }
}

export async function saveProviderSetup(
  spiritDataDir: string,
  setup: ProviderSetupResult,
): Promise<void> {
  const scope = setup.providerScope;
  if (scope === 'amazon-bedrock' && setup.bedrock) {
    saveBedrockCredentials(scope, setup.bedrock);
  } else if (scope === 'google-vertex-ai' && setup.vertex) {
    saveGoogleVertexCredentials(scope, setup.vertex);
  } else if (setup.apiKey?.trim()) {
    saveProviderApiKey(scope, setup.apiKey);
  }

  const existing = loadSpiritConfig(spiritDataDir);
  const models = existing?.models.filter((model) => model.name !== setup.profile.name) ?? [];
  models.push(setup.profile);

  const config: SpiritConfigFile = {
    ...(existing ?? { models: [], activeModel: '' }),
    models,
    activeModel: setup.profile.name,
  };
  await saveSpiritConfig(spiritDataDir, config);
}
