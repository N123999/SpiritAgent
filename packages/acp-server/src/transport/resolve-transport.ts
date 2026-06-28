import {
  resolveOpenResponsesReasoningSummary,
  type AnthropicTransportConfig,
  type LlmModelCapabilities,
  type LlmTransportConfig,
  type OpenResponsesSdkProvider,
} from '@spirit-agent/core';
import {
  resolveAnthropicTransportReasoningEffortForContext,
  resolveOpenAiTransportReasoningEffortForContext,
} from '@spirit-agent/core/reasoning-effort';
import {
  bedrockMantleApiBaseFromRegion,
  isBedrockMantleOpenAiModel,
  type ModelProviderId,
} from '@spirit-agent/host-internal';

import {
  loadActiveModelProfile,
  readBedrockCredentials,
  readGoogleVertexCredentials,
  resolveStoredApiKeyForProfile,
} from '../credentials/index.js';
import type { SpiritModelCapability, SpiritModelProfile } from '../credentials/types.js';
import { resolveProfileApiBase, resolveSetupTransportKind } from '../setup/provider-wizard.js';
import type { AcpServerConfig } from '../types.js';

function modelCapabilitiesFromConfig(
  capabilities: readonly SpiritModelCapability[],
): LlmModelCapabilities {
  return {
    ...(capabilities.includes('chat') ? { chat: true } : {}),
    ...(capabilities.includes('image') ? { imageInput: true } : {}),
    ...(capabilities.includes('video') ? { videoInput: true } : {}),
    ...(capabilities.includes('imageGeneration') ? { imageGeneration: true } : {}),
  };
}

function openAiCompatibleVendorFromProvider(
  provider?: ModelProviderId,
): Exclude<ModelProviderId, 'anthropic' | 'amazon-bedrock'> | undefined {
  return provider && provider !== 'anthropic' && provider !== 'amazon-bedrock'
    ? provider
    : undefined;
}

function normalizeAnthropicSupportedEfforts(
  efforts?: readonly string[],
): AnthropicTransportConfig['supportedEfforts'] {
  if (efforts === undefined) {
    return undefined;
  }
  return efforts.filter((effort): effort is NonNullable<AnthropicTransportConfig['supportedEfforts']>[number] => (
    effort === 'low'
    || effort === 'medium'
    || effort === 'high'
    || effort === 'xhigh'
    || effort === 'max'
  ));
}

function buildTransportFromProfile(
  profile: SpiritModelProfile,
  apiKey: string,
  workspaceRoot: string,
): LlmTransportConfig {
  const baseUrl = resolveProfileApiBase(profile);
  const transportKind = resolveSetupTransportKind(profile.provider ?? 'custom', profile.transportKind);
  const model = profile.name;

  if (
    profile.provider === 'amazon-bedrock'
    && isBedrockMantleOpenAiModel(model)
  ) {
    const region = profile.awsRegion?.trim();
    if (!region) {
      throw new Error('Amazon Bedrock model is missing AWS region configuration.');
    }
    const bedrockCredentials = readBedrockCredentials('amazon-bedrock');
    const resolvedApiKey = apiKey.trim() || bedrockCredentials.apiKey?.trim() || '';
    const accessKeyId = bedrockCredentials.accessKeyId?.trim();
    const secretAccessKey = bedrockCredentials.secretAccessKey?.trim();
    if (!resolvedApiKey && !(accessKeyId && secretAccessKey)) {
      throw new Error('Amazon Bedrock Mantle requires a Bearer API key or IAM credentials.');
    }
    const normalizedReasoningEffort = resolveOpenAiTransportReasoningEffortForContext(
      profile.reasoningEffort,
      {
        provider: 'openai',
        transportKind: 'open-responses',
        model,
      },
    );
    const mantleBaseUrl = bedrockMantleApiBaseFromRegion(region);
    const reasoningSummary = resolveOpenResponsesReasoningSummary({
      llmVendor: 'openai',
      model,
      baseUrl: mantleBaseUrl,
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
    });

    return {
      transportKind: 'open-responses',
      apiKey: resolvedApiKey,
      model,
      baseUrl: mantleBaseUrl,
      workspaceRoot,
      spiritAgentMode: 'agent',
      responsesProvider: 'openai',
      llmVendor: 'openai',
      ...(profile.capabilities
        ? { modelCapabilities: modelCapabilitiesFromConfig(profile.capabilities) }
        : {}),
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
      ...(reasoningSummary ? { reasoningSummary } : {}),
      ...(!resolvedApiKey && accessKeyId && secretAccessKey
        ? {
            bedrockMantleIam: {
              region,
              accessKeyId,
              secretAccessKey,
            },
          }
        : {}),
    };
  }

  if (transportKind === 'open-responses') {
    const llmVendor = openAiCompatibleVendorFromProvider(profile.provider);
    const normalizedReasoningEffort = resolveOpenAiTransportReasoningEffortForContext(
      profile.reasoningEffort,
      {
        ...(profile.provider ? { provider: profile.provider } : {}),
        transportKind: 'open-responses',
        model,
      },
    );
    const responsesProvider: OpenResponsesSdkProvider | undefined =
      profile.provider === 'openai'
        ? 'openai'
        : profile.provider === 'xai'
          ? 'xai'
          : profile.provider === 'vercel-ai-gateway' || profile.provider === 'openrouter'
            ? undefined
            : 'open-responses-compatible';
    const reasoningSummary = resolveOpenResponsesReasoningSummary({
      ...(llmVendor ? { llmVendor } : {}),
      model,
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
    });

    return {
      transportKind: 'open-responses',
      apiKey,
      model,
      baseUrl,
      workspaceRoot,
      spiritAgentMode: 'agent',
      ...(responsesProvider ? { responsesProvider } : {}),
      ...(llmVendor ? { llmVendor } : {}),
      ...(profile.capabilities
        ? { modelCapabilities: modelCapabilitiesFromConfig(profile.capabilities) }
        : {}),
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
      ...(reasoningSummary ? { reasoningSummary } : {}),
    };
  }

  if (transportKind === 'anthropic') {
    const supportedAnthropicEfforts = normalizeAnthropicSupportedEfforts(profile.supportedReasoningEfforts);
    const anthropicEffort = resolveAnthropicTransportReasoningEffortForContext(
      profile.reasoningEffort,
      {
        ...(profile.provider ? { provider: profile.provider } : {}),
        ...(profile.transportKind ? { transportKind: profile.transportKind } : {}),
        model,
      },
    );
    return {
      transportKind: 'anthropic',
      apiKey,
      model,
      baseUrl,
      workspaceRoot,
      ...(profile.capabilities
        ? { modelCapabilities: modelCapabilitiesFromConfig(profile.capabilities) }
        : {}),
      ...(supportedAnthropicEfforts !== undefined
        ? { supportedEfforts: supportedAnthropicEfforts }
        : {}),
      ...(anthropicEffort ? { effort: anthropicEffort } : {}),
    };
  }

  if (transportKind === 'bedrock') {
    const region = profile.awsRegion?.trim();
    if (!region) {
      throw new Error('Amazon Bedrock model is missing AWS region configuration.');
    }
    const bedrockCredentials = readBedrockCredentials('amazon-bedrock');
    const resolvedApiKey = apiKey.trim() || bedrockCredentials.apiKey?.trim() || '';
    const accessKeyId = bedrockCredentials.accessKeyId?.trim();
    const secretAccessKey = bedrockCredentials.secretAccessKey?.trim();
    const normalizedReasoningEffort = resolveOpenAiTransportReasoningEffortForContext(
      profile.reasoningEffort,
      {
        ...(profile.provider ? { provider: profile.provider } : {}),
        transportKind: 'bedrock',
        model,
      },
    );
    return {
      transportKind: 'bedrock',
      model,
      region,
      ...(resolvedApiKey ? { apiKey: resolvedApiKey } : {}),
      ...(accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : {}),
      baseUrl,
      workspaceRoot,
      ...(profile.capabilities
        ? { modelCapabilities: modelCapabilitiesFromConfig(profile.capabilities) }
        : {}),
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
    };
  }

  const llmVendor = openAiCompatibleVendorFromProvider(profile.provider);
  const normalizedReasoningEffort = resolveOpenAiTransportReasoningEffortForContext(
    profile.reasoningEffort,
    {
      ...(profile.provider ? { provider: profile.provider } : {}),
      ...(profile.transportKind ? { transportKind: profile.transportKind } : {}),
      model,
    },
  );
  const vertexCredentials = profile.provider === 'google-vertex-ai'
    ? readGoogleVertexCredentials('google-vertex-ai')
    : undefined;
  const vertexProject = profile.vertexProject?.trim();
  const vertexLocation = profile.vertexLocation?.trim();
  const vertexClientEmail = vertexCredentials?.clientEmail?.trim();
  const vertexPrivateKey = vertexCredentials?.privateKey?.trim();

  return {
    transportKind: 'openai-compatible',
    apiKey,
    model,
    baseUrl,
    workspaceRoot,
    ...(llmVendor ? { llmVendor } : {}),
    ...(vertexProject ? { vertexProject } : {}),
    ...(vertexLocation ? { vertexLocation } : {}),
    ...(vertexClientEmail ? { vertexClientEmail } : {}),
    ...(vertexPrivateKey ? { vertexPrivateKey } : {}),
    ...(profile.capabilities
      ? { modelCapabilities: modelCapabilitiesFromConfig(profile.capabilities) }
      : {}),
    ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
  };
}

/**
 * Resolves LLM transport from shared Spirit config + keyring.
 */
export function resolveTransportConfig(config: AcpServerConfig): LlmTransportConfig {
  const profile = loadActiveModelProfile(config.spiritDataDir);
  if (!profile) {
    throw new Error('No active model configured. Run spirit-agent-acp --setup first.');
  }

  const apiKey = resolveStoredApiKeyForProfile(profile) ?? '';
  if (!apiKey.trim() && profile.provider === 'google-vertex-ai') {
    const vertex = readGoogleVertexCredentials('google-vertex-ai');
    const hasVertex = Boolean(
      vertex.apiKey?.trim()
      || (vertex.clientEmail?.trim() && vertex.privateKey?.trim()),
    );
    if (!hasVertex) {
      throw new Error(`No Vertex credentials found for model "${profile.name}". Run --setup again.`);
    }
  } else if (
    !apiKey.trim()
    && profile.provider !== 'amazon-bedrock'
  ) {
    throw new Error(`No API key found for model "${profile.name}". Run --setup again.`);
  }

  return buildTransportFromProfile(profile, apiKey, config.workspaceRoot);
}
