import type { ModelProviderId, ProviderModelTransportKind } from '@spirit-agent/host-internal';
import {
  listProviderConnectSiteOptions,
  providerConnectSiteRequiresWorkspaceId,
  providerSupportsSiteSelection,
  resolveProviderConnectApiBase,
} from '@spirit-agent/host-internal';

import type { SpiritModelProfile } from '../credentials/types.js';

const DEFAULT_API_BASE = 'https://api.openai.com/v1';

export function resolveSetupTransportKind(
  provider: ModelProviderId,
  requested?: ProviderModelTransportKind,
): ProviderModelTransportKind {
  if (requested) {
    if (
      (provider === 'google' || provider === 'google-vertex-ai')
      && (requested === 'open-responses' || requested === 'anthropic')
    ) {
      return 'openai-compatible';
    }
    if (provider === 'azure') {
      return 'open-responses';
    }
    return requested;
  }

  if (provider === 'anthropic') {
    return 'anthropic';
  }
  if (provider === 'amazon-bedrock') {
    return 'bedrock';
  }
  if (provider === 'azure') {
    return 'open-responses';
  }
  return 'openai-compatible';
}

export function resolveProfileApiBase(profile: {
  provider?: ModelProviderId;
  transportKind?: ProviderModelTransportKind;
  apiBase?: string;
  providerSite?: string;
  alibabaWorkspaceId?: string;
  awsRegion?: string;
  azureResourceName?: string;
  vertexProject?: string;
  vertexLocation?: string;
}): string {
  if (profile.provider === 'amazon-bedrock') {
    const region = profile.awsRegion?.trim();
    if (region) {
      return resolveProviderConnectApiBase('amazon-bedrock', 'bedrock');
    }
  }

  if (profile.provider === 'google-vertex-ai') {
    const project = profile.vertexProject?.trim();
    const location = profile.vertexLocation?.trim();
    if (project && location) {
      return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}`;
    }
    const trimmed = profile.apiBase?.trim();
    if (trimmed) {
      return trimmed;
    }
    return '';
  }

  if (profile.provider === 'azure') {
    const resourceName = profile.azureResourceName?.trim();
    if (resourceName) {
      return `https://${resourceName}.openai.azure.com/openai/v1`;
    }
    const trimmed = profile.apiBase?.trim();
    if (trimmed) {
      return trimmed;
    }
    throw new Error('Azure model is missing azureResourceName.');
  }

  if (profile.provider && profile.provider !== 'custom') {
    const transportKind = resolveSetupTransportKind(profile.provider, profile.transportKind);
    return resolveProviderConnectApiBase(profile.provider, transportKind, {
      ...(profile.providerSite ? { site: profile.providerSite } : {}),
      ...(profile.alibabaWorkspaceId?.trim()
        ? { workspaceId: profile.alibabaWorkspaceId.trim() }
        : {}),
    });
  }

  const trimmed = profile.apiBase?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_API_BASE;
}

export function validateModelName(modelName: string): string | undefined {
  const trimmed = modelName.trim();
  if (!trimmed) {
    return 'Model name is required.';
  }
  return undefined;
}

export function validateApiKeyRequired(provider: ModelProviderId, apiKey: string): string | undefined {
  if (provider === 'amazon-bedrock' || provider === 'google-vertex-ai' || provider === 'custom') {
    return undefined;
  }
  if (!apiKey.trim()) {
    return 'API key is required for this provider.';
  }
  return undefined;
}

export function validateBedrockCredentials(input: {
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  awsRegion?: string;
}): string | undefined {
  if (!input.awsRegion?.trim()) {
    return 'AWS region is required for Amazon Bedrock.';
  }
  const hasApiKey = Boolean(input.apiKey?.trim());
  const hasIam = Boolean(input.accessKeyId?.trim() && input.secretAccessKey?.trim());
  if (!hasApiKey && !hasIam) {
    return 'Provide either a Bedrock API key or IAM access key credentials.';
  }
  return undefined;
}

export function validateVertexCredentials(input: {
  apiKey?: string;
  clientEmail?: string;
  privateKey?: string;
  vertexProject?: string;
  vertexLocation?: string;
}): string | undefined {
  if (!input.vertexProject?.trim() || !input.vertexLocation?.trim()) {
    return 'GCP project ID and location are required for Google Vertex AI.';
  }
  const hasApiKey = Boolean(input.apiKey?.trim());
  const hasSa = Boolean(input.clientEmail?.trim() && input.privateKey?.trim());
  if (!hasApiKey && !hasSa) {
    return 'Provide either a Vertex API key or a service account email and private key.';
  }
  return undefined;
}

export function validateAzureSetup(input: {
  azureResourceName?: string;
  apiKey?: string;
  modelName?: string;
}): string | undefined {
  if (!input.azureResourceName?.trim()) {
    return 'Azure resource name is required.';
  }
  if (!input.apiKey?.trim()) {
    return 'Azure API key is required.';
  }
  if (!input.modelName?.trim()) {
    return 'Azure deployment name is required.';
  }
  return undefined;
}

export function validateCustomSetup(input: { apiBase?: string; apiKey?: string; modelName?: string }): string | undefined {
  if (!input.apiBase?.trim()) {
    return 'API base URL is required for custom providers.';
  }
  if (!input.apiKey?.trim()) {
    return 'API key is required for custom providers.';
  }
  if (!input.modelName?.trim()) {
    return 'Model name is required.';
  }
  return undefined;
}

export function buildSetupProfile(input: {
  provider: ModelProviderId;
  modelName: string;
  transportKind?: ProviderModelTransportKind;
  providerSite?: string;
  alibabaWorkspaceId?: string;
  awsRegion?: string;
  azureResourceName?: string;
  vertexProject?: string;
  vertexLocation?: string;
  apiBaseOverride?: string;
}): SpiritModelProfile {
  const transportKind = resolveSetupTransportKind(input.provider, input.transportKind);
  const profile: SpiritModelProfile = {
    name: input.modelName.trim(),
    apiBase: input.apiBaseOverride?.trim() || '',
    reasoningEffort: 'medium',
    capabilities: ['chat', 'image'],
    provider: input.provider === 'custom' ? 'custom' : input.provider,
    transportKind,
  };
  if (input.providerSite) {
    profile.providerSite = input.providerSite;
  }
  if (input.alibabaWorkspaceId?.trim()) {
    profile.alibabaWorkspaceId = input.alibabaWorkspaceId.trim();
  }
  if (input.awsRegion?.trim()) {
    profile.awsRegion = input.awsRegion.trim();
  }
  if (input.azureResourceName?.trim()) {
    profile.azureResourceName = input.azureResourceName.trim();
  }
  if (input.vertexProject?.trim()) {
    profile.vertexProject = input.vertexProject.trim();
  }
  if (input.vertexLocation?.trim()) {
    profile.vertexLocation = input.vertexLocation.trim();
  }
  if (input.apiBaseOverride?.trim()) {
    profile.apiBase = input.apiBaseOverride.trim();
  } else {
    profile.apiBase = resolveProfileApiBase(profile);
  }
  return profile;
}

export function providerNeedsSiteSelection(provider: ModelProviderId): boolean {
  return providerSupportsSiteSelection(provider);
}

export function listSiteOptions(provider: ModelProviderId): Array<{ value: string; name: string }> {
  return listProviderConnectSiteOptions(provider).map((site) => ({
    value: site.id,
    name: site.fallbackLabel,
  }));
}

export function siteNeedsWorkspaceId(provider: ModelProviderId, siteId: string): boolean {
  return providerConnectSiteRequiresWorkspaceId(provider, siteId);
}
