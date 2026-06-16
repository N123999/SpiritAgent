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
  listProviderModels,
  resolveProviderConnectApiBase,
  bedrockApiBaseFromRegion,
  bedrockMantleApiBaseFromRegion,
  isBedrockMantleOpenAiModel,
  azureApiBaseFromResourceName,
  type ProviderListedModelEntry,
} from '@spirit-agent/host-internal';

import type {
  AddProviderModelsRequest,
  DesktopAgentMode,
  DesktopModelCapability,
  DesktopModelProvider,
  DesktopTransportKind,
  ModelProfileSnapshot,
  PreviewModelCatalogEntry,
} from '../types.js';
import type { BedrockProviderCredentials } from './provider-api-key.js';
import {
  isModelCatalogCacheFresh,
  readModelCatalogCache,
  writeModelCatalogCache,
} from './model-catalog-cache.js';
import {
  previewCatalogMapForTransport,
  previewModelCatalogForTransport,
  usesProviderListedModelCatalogMetadata,
} from './model-catalog-metadata.js';
import {
  resolveComposerDirectMediaTool,
  type DirectMediaTool,
} from '../lib/composer-direct-media.js';
import {
  DEFAULT_API_BASE,
  defaultCustomModelCapabilities,
  type DesktopConfigFile,
} from './storage.js';

export { resolveComposerDirectMediaTool, type DirectMediaTool };

export function resolveProfileApiBase(
  profile: Pick<ModelProfileSnapshot, 'name' | 'provider' | 'transportKind' | 'apiBase' | 'awsRegion' | 'azureResourceName'>,
): string {
  if (profile.provider === 'amazon-bedrock') {
    const region = profile.awsRegion?.trim();
    if (region) {
      if (isBedrockMantleOpenAiModel(profile.name)) {
        return bedrockMantleApiBaseFromRegion(region);
      }
      return bedrockApiBaseFromRegion(region);
    }
  }

  if (profile.provider === 'azure') {
    const resourceName = profile.azureResourceName?.trim();
    if (resourceName) {
      return azureApiBaseFromResourceName(resourceName);
    }
    const trimmed = profile.apiBase?.trim();
    if (trimmed) {
      return trimmed;
    }
    throw new Error('Azure OpenAI 模型缺少 azureResourceName 配置。');
  }

  if (profile.provider && profile.provider !== 'custom') {
    return defaultApiBaseForTransport(profile.provider, resolveDesktopTransportKind(profile));
  }

  const trimmed = profile.apiBase?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_API_BASE;
}

export function resolveDesktopTransportKind(
  profile?: Pick<ModelProfileSnapshot, 'provider' | 'transportKind'>,
): DesktopTransportKind {
  const requested = profile?.transportKind;
  if (requested) {
    if (
      profile?.provider === 'google'
      && (requested === 'open-responses' || requested === 'anthropic')
    ) {
      return 'openai-compatible';
    }
    if (profile?.provider === 'azure') {
      return 'open-responses';
    }
    return requested;
  }

  return profile?.provider === 'anthropic'
    ? 'anthropic'
    : profile?.provider === 'amazon-bedrock'
      ? 'bedrock'
      : profile?.provider === 'azure'
        ? 'open-responses'
        : 'openai-compatible';
}

export function defaultApiBaseForTransport(
  provider?: DesktopModelProvider,
  transportKind?: DesktopTransportKind,
): string {
  if (!provider) {
    return DEFAULT_API_BASE;
  }

  return resolveProviderConnectApiBase(
    provider,
    transportKind ?? resolveDesktopTransportKind({ provider }),
  );
}

export function reasoningProviderForTransport(
  provider: DesktopModelProvider | undefined,
  transportKind: DesktopTransportKind,
): DesktopModelProvider | undefined {
  if (transportKind === 'anthropic') {
    return 'anthropic';
  }

  if (transportKind === 'open-responses' && provider === 'openai') {
    return 'openai';
  }

  return provider;
}

export function openAiCompatibleVendorFromProvider(
  provider?: DesktopModelProvider,
): Exclude<DesktopModelProvider, 'anthropic' | 'amazon-bedrock'> | undefined {
  return provider && provider !== 'anthropic' && provider !== 'amazon-bedrock'
    ? provider
    : undefined;
}

export function buildPrimaryTransportConfig(input: {
  apiKey: string;
  model: string;
  baseUrl: string;
  workspaceRoot: string;
  agentMode?: DesktopAgentMode;
  bedrockCredentials?: BedrockProviderCredentials;
  profile?: Pick<
    ModelProfileSnapshot,
    | 'provider'
    | 'transportKind'
    | 'capabilities'
    | 'reasoningEffort'
    | 'supportedReasoningEfforts'
    | 'awsRegion'
    | 'azureResourceName'
  >;
}): LlmTransportConfig {
  const spiritAgentMode = input.agentMode ?? 'agent';
  const transportKind = resolveDesktopTransportKind(input.profile);

  if (
    input.profile?.provider === 'amazon-bedrock'
    && isBedrockMantleOpenAiModel(input.model)
  ) {
    const region = input.profile.awsRegion?.trim();
    if (!region) {
      throw new Error('Amazon Bedrock 模型缺少 AWS 区域配置。');
    }
    const bedrockCredentials = input.bedrockCredentials;
    const apiKey = input.apiKey.trim() || bedrockCredentials?.apiKey?.trim();
    const accessKeyId = bedrockCredentials?.accessKeyId?.trim();
    const secretAccessKey = bedrockCredentials?.secretAccessKey?.trim();
    const sessionToken = bedrockCredentials?.sessionToken?.trim();
    if (!apiKey && !(accessKeyId && secretAccessKey)) {
      throw new Error('Amazon Bedrock Mantle 模型需要 Bearer API Key 或 IAM 凭证。');
    }
    const normalizedReasoningEffort = resolveOpenAiTransportReasoningEffortForContext(
      input.profile?.reasoningEffort,
      {
        provider: 'openai',
        transportKind: 'open-responses',
        ...(input.profile?.supportedReasoningEfforts !== undefined
          ? { supportedEfforts: input.profile.supportedReasoningEfforts }
          : {}),
        model: input.model,
      },
    );
    const mantleBaseUrl = bedrockMantleApiBaseFromRegion(region);
    const reasoningSummary = resolveOpenResponsesReasoningSummary({
      llmVendor: 'openai',
      model: input.model,
      baseUrl: mantleBaseUrl,
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
    });

    return {
      transportKind: 'open-responses',
      apiKey: apiKey ?? '',
      model: input.model,
      baseUrl: mantleBaseUrl,
      workspaceRoot: input.workspaceRoot,
      spiritAgentMode,
      responsesProvider: 'openai',
      llmVendor: 'openai',
      store: false,
      ...(input.profile?.capabilities
        ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
        : {}),
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
      ...(reasoningSummary ? { reasoningSummary } : {}),
      ...(!apiKey && accessKeyId && secretAccessKey
        ? {
            bedrockMantleIam: {
              region,
              accessKeyId,
              secretAccessKey,
              ...(sessionToken ? { sessionToken } : {}),
            },
          }
        : {}),
    };
  }

  if (transportKind === 'open-responses') {
    const llmVendor = openAiCompatibleVendorFromProvider(input.profile?.provider);
    const normalizedReasoningEffort = resolveOpenAiTransportReasoningEffortForContext(
      input.profile?.reasoningEffort,
      {
        ...(input.profile?.provider ? { provider: input.profile.provider } : {}),
        transportKind: 'open-responses',
        ...(input.profile?.supportedReasoningEfforts !== undefined
          ? { supportedEfforts: input.profile.supportedReasoningEfforts }
          : {}),
        model: input.model,
      },
    );
    const responsesProvider: OpenResponsesSdkProvider | undefined =
      input.profile?.provider === 'openai'
        ? 'openai'
        : input.profile?.provider === 'xai'
          ? 'xai'
          : input.profile?.provider === 'azure'
            ? 'azure'
            : input.profile?.provider === 'vercel-ai-gateway' ||
                input.profile?.provider === 'openrouter'
              ? undefined
              : 'open-responses-compatible';
    const azureResourceName = input.profile?.azureResourceName?.trim();
    if (input.profile?.provider === 'azure' && !azureResourceName) {
      throw new Error('Azure OpenAI 模型缺少 azureResourceName 配置。');
    }
    const reasoningSummary = resolveOpenResponsesReasoningSummary({
      ...(llmVendor ? { llmVendor } : {}),
      model: input.model,
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
    });

    return {
      transportKind: 'open-responses',
      apiKey: input.apiKey,
      model: input.model,
      baseUrl: input.baseUrl,
      workspaceRoot: input.workspaceRoot,
      spiritAgentMode,
      ...(responsesProvider ? { responsesProvider } : {}),
      store: false,
      ...(llmVendor ? { llmVendor } : {}),
      ...(input.profile?.capabilities
        ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
        : {}),
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
      ...(reasoningSummary ? { reasoningSummary } : {}),
      ...(azureResourceName ? { azureResourceName } : {}),
    };
  }

  if (transportKind === 'anthropic') {
    const supportedAnthropicEfforts = normalizeAnthropicSupportedEfforts(
      input.profile?.supportedReasoningEfforts,
    );
    const anthropicEffort = resolveAnthropicTransportReasoningEffortForContext(
      input.profile?.reasoningEffort,
      {
        ...(input.profile?.provider ? { provider: input.profile.provider } : {}),
        ...(input.profile?.transportKind ? { transportKind: input.profile.transportKind } : {}),
        ...(input.profile?.supportedReasoningEfforts !== undefined
          ? { supportedEfforts: input.profile.supportedReasoningEfforts }
          : {}),
        model: input.model,
      },
    );
    return {
      transportKind: 'anthropic',
      apiKey: input.apiKey,
      model: input.model,
      baseUrl: input.baseUrl,
      workspaceRoot: input.workspaceRoot,
      ...(input.profile?.capabilities
        ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
        : {}),
      ...(supportedAnthropicEfforts !== undefined
        ? { supportedEfforts: supportedAnthropicEfforts }
        : {}),
      ...(anthropicEffort ? { effort: anthropicEffort } : {}),
    };
  }

  if (transportKind === 'bedrock') {
    const region = input.profile?.awsRegion?.trim();
    if (!region) {
      throw new Error('Amazon Bedrock 模型缺少 AWS 区域配置。');
    }
    const bedrockCredentials = input.bedrockCredentials;
    const apiKey = input.apiKey.trim() || bedrockCredentials?.apiKey?.trim();
    const accessKeyId = bedrockCredentials?.accessKeyId?.trim();
    const secretAccessKey = bedrockCredentials?.secretAccessKey?.trim();
    const normalizedReasoningEffort = resolveOpenAiTransportReasoningEffortForContext(
      input.profile?.reasoningEffort,
      {
        ...(input.profile?.provider ? { provider: input.profile.provider } : {}),
        transportKind: 'bedrock',
        ...(input.profile?.supportedReasoningEfforts !== undefined
          ? { supportedEfforts: input.profile.supportedReasoningEfforts }
          : {}),
        model: input.model,
      },
    );
    return {
      transportKind: 'bedrock',
      model: input.model,
      region,
      ...(apiKey ? { apiKey } : {}),
      ...(accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : {}),
      baseUrl: input.baseUrl,
      workspaceRoot: input.workspaceRoot,
      ...(input.profile?.capabilities
        ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
        : {}),
      ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
    };
  }

  const llmVendor = openAiCompatibleVendorFromProvider(input.profile?.provider);
  const normalizedReasoningEffort = resolveOpenAiTransportReasoningEffortForContext(
    input.profile?.reasoningEffort,
    {
      ...(input.profile?.provider ? { provider: input.profile.provider } : {}),
      ...(input.profile?.transportKind ? { transportKind: input.profile.transportKind } : {}),
      ...(input.profile?.supportedReasoningEfforts !== undefined
        ? { supportedEfforts: input.profile.supportedReasoningEfforts }
        : {}),
      model: input.model,
    },
  );
  return {
    apiKey: input.apiKey,
    model: input.model,
    baseUrl: input.baseUrl,
    workspaceRoot: input.workspaceRoot,
    ...(llmVendor ? { llmVendor } : {}),
    ...(input.profile?.capabilities
      ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
      : {}),
    ...(normalizedReasoningEffort ? { reasoningEffort: normalizedReasoningEffort } : {}),
  };
}

export function modelCapabilitiesFromConfig(
  capabilities: readonly DesktopModelCapability[],
): LlmModelCapabilities {
  return {
    ...(capabilities.includes('chat') ? { chat: true } : {}),
    ...(capabilities.includes('image') ? { imageInput: true } : {}),
    ...(capabilities.includes('video') ? { videoInput: true } : {}),
    ...(capabilities.includes('imageGeneration') ? { imageGeneration: true } : {}),
  };
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

export function supportsImageGeneration(model: { capabilities?: readonly DesktopModelCapability[] }): boolean {
  return model.capabilities?.includes('imageGeneration') === true;
}

export function supportsVideoGeneration(model: { capabilities?: readonly DesktopModelCapability[] }): boolean {
  return model.capabilities?.includes('videoGeneration') === true;
}

export function buildImageGenerationSubConfig(input: {
  profile: Pick<ModelProfileSnapshot, 'name' | 'apiBase' | 'provider' | 'capabilities'>;
  apiKey: string;
}) {
  const imageGenerationVendor = openAiCompatibleVendorFromProvider(input.profile.provider);
  return {
    apiKey: input.apiKey,
    model: input.profile.name,
    baseUrl: resolveProfileApiBase(input.profile),
    ...(imageGenerationVendor ? { llmVendor: imageGenerationVendor } : {}),
    ...(input.profile.capabilities
      ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
      : {}),
  };
}

export function buildVideoGenerationSubConfig(input: {
  profile: Pick<ModelProfileSnapshot, 'name' | 'apiBase' | 'provider' | 'capabilities'>;
  apiKey: string;
}) {
  const videoGenerationVendor = openAiCompatibleVendorFromProvider(input.profile.provider);
  return {
    apiKey: input.apiKey,
    model: input.profile.name,
    baseUrl: resolveProfileApiBase(input.profile),
    ...(videoGenerationVendor ? { llmVendor: videoGenerationVendor } : {}),
    ...(input.profile.capabilities
      ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
      : {}),
  };
}

export function buildMediaOnlyTransportConfig(
  toolName: DirectMediaTool,
  input: {
    profile: Pick<ModelProfileSnapshot, 'name' | 'apiBase' | 'provider' | 'capabilities'>;
    apiKey: string;
  },
): LlmTransportConfig {
  const shell = {
    transportKind: 'openai-compatible' as const,
    apiKey: input.apiKey,
    model: input.profile.name,
    baseUrl: resolveProfileApiBase(input.profile),
  };

  if (toolName === 'generate_image') {
    return {
      ...shell,
      imageGeneration: buildImageGenerationSubConfig(input),
    } as LlmTransportConfig;
  }

  return {
    ...shell,
    videoGeneration: buildVideoGenerationSubConfig(input),
  } as LlmTransportConfig;
}

export function attachVideoGenerationToTransportConfig(
  transportConfig: LlmTransportConfig,
  input: {
    profile?: ModelProfileSnapshot;
    apiKey?: string;
  },
): LlmTransportConfig {
  if (!input.profile || !input.apiKey || !supportsVideoGeneration(input.profile)) {
    return transportConfig;
  }
  if (transportConfig.transportKind === 'anthropic') {
    return transportConfig;
  }

  return {
    ...transportConfig,
    videoGeneration: buildVideoGenerationSubConfig({
      profile: input.profile,
      apiKey: input.apiKey,
    }),
  } as LlmTransportConfig;
}

export function attachImageGenerationToTransportConfig(
  transportConfig: LlmTransportConfig,
  input: {
    profile?: ModelProfileSnapshot;
    apiKey?: string;
  },
): LlmTransportConfig {
  if (!input.profile || !input.apiKey || !supportsImageGeneration(input.profile)) {
    return transportConfig;
  }
  if (transportConfig.transportKind === 'anthropic') {
    return transportConfig;
  }

  return {
    ...transportConfig,
    imageGeneration: buildImageGenerationSubConfig({
      profile: input.profile,
      apiKey: input.apiKey,
    }),
  } as LlmTransportConfig;
}

interface LoadedPreviewModelsResult {
  modelIds: string[];
  modelCatalog?: PreviewModelCatalogEntry[];
  fromCache: boolean;
}

export async function loadPreviewModelsForTransport(input: {
  provider?: DesktopModelProvider;
  transportKind: DesktopTransportKind;
  apiBase: string;
  apiKey: string;
  awsRegion?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forceRefresh: boolean;
}): Promise<LoadedPreviewModelsResult> {
  const cached = await readModelCatalogCache(
    input.apiBase,
    input.apiKey,
    input.provider,
    input.transportKind,
  );
  const now = Date.now();
  if (cached && isModelCatalogCacheFresh(cached, now, input.forceRefresh)) {
    return {
      modelIds: cached.modelIds,
      ...(cached.modelCatalog ? { modelCatalog: cached.modelCatalog } : {}),
      fromCache: true,
    };
  }

  const listedModels = await listProviderModels({
    provider: input.provider,
    transportKind: input.transportKind,
    baseUrl: input.apiBase,
    apiKey: input.apiKey,
    ...(input.awsRegion ? { awsRegion: input.awsRegion } : {}),
    ...(input.accessKeyId ? { accessKeyId: input.accessKeyId } : {}),
    ...(input.secretAccessKey ? { secretAccessKey: input.secretAccessKey } : {}),
  });
  const modelCatalog = previewModelCatalogForProvider(input.provider, input.transportKind, listedModels);
  const modelIds = listedModels.map((entry) => entry.id);
  await writeModelCatalogCache(
    input.apiBase,
    modelIds,
    input.apiKey,
    modelCatalog,
    input.provider,
    input.transportKind,
  );
  return {
    modelIds,
    ...(modelCatalog ? { modelCatalog } : {}),
    fromCache: false,
  };
}

function previewModelCatalogForProvider(
  provider: DesktopModelProvider | undefined,
  transportKind: DesktopTransportKind,
  listedModels: readonly ProviderListedModelEntry[],
): PreviewModelCatalogEntry[] | undefined {
  return previewModelCatalogForTransport({ provider, transportKind, listedModels });
}

export function previewCatalogMapForAddProviderRequest(
  request: AddProviderModelsRequest,
  provider: DesktopModelProvider | undefined,
  transportKind: DesktopTransportKind,
): Map<string, PreviewModelCatalogEntry> {
  return previewCatalogMapForTransport({
    provider,
    transportKind,
    modelCatalog: request.modelCatalog,
  });
}

export async function findCatalogEntryForModel(input: {
  provider?: DesktopModelProvider;
  transportKind: DesktopTransportKind;
  apiBase: string;
  apiKey: string;
  model: string;
}): Promise<PreviewModelCatalogEntry | undefined> {
  if (!usesProviderListedModelCatalogMetadata(input)) {
    return undefined;
  }

  try {
    const preview = await loadPreviewModelsForTransport({
      provider: input.provider,
      transportKind: input.transportKind,
      apiBase: input.apiBase,
      apiKey: input.apiKey,
      forceRefresh: false,
    });
    return preview.modelCatalog?.find((entry) => entry.id === input.model);
  } catch {
    return undefined;
  }
}

export function resolveAddedModelCapabilities(input: {
  provider?: DesktopModelProvider;
  requestedCapabilities?: DesktopModelCapability[];
  catalogEntry?: PreviewModelCatalogEntry;
}): DesktopModelCapability[] | undefined {
  if (input.catalogEntry?.capabilities) {
    const merged = [...input.catalogEntry.capabilities];
    if (
      input.requestedCapabilities?.includes('imageGeneration') === true
      && !merged.includes('imageGeneration')
    ) {
      merged.push('imageGeneration');
    }
    return merged;
  }

  if (input.requestedCapabilities) {
    return input.requestedCapabilities;
  }

  return input.provider === 'custom' ? defaultCustomModelCapabilities() : undefined;
}
