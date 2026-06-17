import type { ModelProviderId } from '@spirit-agent/host-internal';

export const KEYRING_SERVICE = 'SpiritAgent';
export const KEYRING_GLOBAL_ACCOUNT = 'openai_api_key';

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

export function modelKeyAccount(modelName: string): string {
  return `model::${modelName}`;
}

/** Config profiles without `provider` use custom-scoped keys. */
export function modelProviderKeyScope(provider?: ModelProviderId): ModelProviderId {
  return provider ?? 'custom';
}
