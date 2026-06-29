import {
  parseModelProviderId,
  parsePresetModelProviderId,
  partitionModelsByProvider,
} from '@spirit-agent/host-internal';
import {
  defaultModelReasoningEffort,
  resolveModelReasoningEffortForContext,
  type ModelReasoningEffort,
} from '@spirit-agent/core/reasoning-effort';
import { shouldPinReasoningEffortToDefault } from '@spirit-agent/core/model-thinking-controls';

import { resolveDesktopAgentMode } from '../lib/agent-mode.js';
import { parseModelContextLength } from '../lib/context-usage.js';
import i18n from '../lib/i18n-host.js';
import type {
  AddModelRequest,
  AddProviderModelsRequest,
  DesktopModelCapability,
  DesktopModelProvider,
  DesktopModelReasoningEffort,
  DesktopProviderConnectSiteId,
  DesktopSnapshot,
  DesktopTransportKind,
  ModelProfileSnapshot,
  PreviewModelsRequest,
  PreviewModelsResponse,
  RemoveModelRequest,
  RemoveProviderModelsRequest,
  UpdateConfigRequest,
} from '../types.js';
import { syncExistingModelsFromCatalog, removeDelistedModelsFromCatalog } from './model-catalog-startup-refresh.js';
import {
  defaultApiBaseForTransport,
  findCatalogEntryForModel,
  loadPreviewModelsForTransport,
  previewCatalogMapForAddProviderRequest,
  reasoningProviderForTransport,
  resolveAddedModelCapabilities,
  resolveDesktopTransportKind,
  supportsImageGeneration,
  supportsVideoGeneration,
} from './model-config.js';
import {
  bedrockApiBaseFromRegion,
  azureApiBaseFromResourceName,
  isValidAzureResourceName,
  vertexApiBaseFromProjectAndLocation,
} from '@spirit-agent/host-internal';
import { providerConnectSiteRequiresWorkspaceId } from './provider-presets.js';
import { bedrockMantleApiBaseFromRegion, isBedrockMantleOpenAiModel } from '@spirit-agent/host-internal/bedrock-mantle';
import { modelSupportsChat } from './lightweight-chat-model.js';
import {
  modelExistsInProviderScope,
  applyModelsRemovalToConfig,
  type ModelRemovalTarget,
} from './provider-api-key.js';
import {
  loadHostMetadata,
  modelProviderKeyScope,
  normalizeDreamConfig,
  normalizeAgentsConfig,
  normalizeNetworksConfig,
  applyLlmClientVersionFromApp,
  applyLlmHttpVersionFromConfig,
  normalizeModelCapabilities,
  normalizeWebHostConfig,
  removeModelApiKey,
  removeProviderApiKey,
  saveApiKeyForModel,
  saveApiKeyForProvider,
  saveBedrockProviderCredentialsForProvider,
  saveGoogleVertexProviderCredentialsForProvider,
  saveConfig,
  readBedrockProviderCredentialsFromKeyring,
  type DesktopConfigFile,
  type DesktopWorkspaceBinding,
  type HostMetadataSummary,
} from './storage.js';
import {
  hasBedrockIamCredentials,
  hasBedrockRuntimeCredentials,
  hasGoogleVertexRuntimeCredentials,
  hasGoogleVertexServiceAccountCredentials,
} from './provider-api-key.js';
import { currentApiBase } from './service-utils.js';

interface HostModelState {
  workspaceRoot: string;
  workspaceBinding: DesktopWorkspaceBinding;
  config: DesktopConfigFile;
  metadata: HostMetadataSummary;
}

interface HostModelBundle {
  activePlanPath?: string;
  deferredRuntimeRefreshWhileBusy: boolean;
}

export interface HostModelCommandContext {
  runSerialized<T>(work: () => Promise<T>): Promise<T>;
  ensureInitialized(options?: { fastPath?: boolean }): Promise<void>;
  requireState(): HostModelState;
  activeBundle(): HostModelBundle;
  isRuntimeBusy(): boolean;
  refreshRuntime(): Promise<void>;
  refreshActiveModelTransportConfig(): Promise<void>;
  refreshModelKeyPresence(): Promise<void>;
  flushDeferredRuntimeRefreshIfIdle(): Promise<void>;
  persistCurrentSessionIfNeeded(): Promise<void>;
  clearActiveContextUsage(): void;
  setLastRuntimeError(error: string): void;
  buildSnapshot(): DesktopSnapshot;
  disposeAllLspServices(): Promise<void>;
  invalidateToolExecutors(): void;
  refreshLspSnapshot(): Promise<void>;
}

export async function updateConfigCommand(
  ctx: HostModelCommandContext,
  request: UpdateConfigRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized({ fastPath: true });
    const state = ctx.requireState();
    const wasBusy = ctx.isRuntimeBusy();
    const prevActiveModel = state.config.activeModel;
    const prevImageGenerationModel = state.config.imageGenerationModel;
    const prevVideoGenerationModel = state.config.videoGenerationModel;
    const prevApiBase = currentApiBase(state.config);
    const prevAgentMode = resolveDesktopAgentMode(state.config);
    const prevLspEnabled = state.config.agents.lsp.enabled;
    const prevActiveModelProfile = state.config.models.find(
      (model) => model.name === state.config.activeModel,
    );
    const prevActiveModelInference = prevActiveModelProfile
      ? {
          thinkingEnabled: prevActiveModelProfile.thinkingEnabled,
          reasoningEffort: prevActiveModelProfile.reasoningEffort,
        }
      : undefined;

    if (ctx.isRuntimeBusy() && Boolean(request.apiKey?.trim())) {
      throw new Error(i18n.t('error.runtimeBusy'));
    }

    const activeModel = request.activeModel.trim();
    const apiBase = request.apiBase.trim();
    const reasoningEffort = request.reasoningEffort;
    const thinkingEnabled = request.thinkingEnabled;
    let existing = activeModel
      ? state.config.models.find((model) => model.name === activeModel)
      : undefined;
    if (activeModel) {
      if (existing) {
        if (existing.provider && existing.provider !== 'custom') {
          existing.apiBase = defaultApiBaseForTransport(
            existing.provider,
            resolveDesktopTransportKind(existing),
          );
        } else {
          existing.apiBase = apiBase;
        }
        if (reasoningEffort !== undefined) {
          existing.reasoningEffort = resolveModelReasoningEffortForContext(reasoningEffort, {
            ...(existing.provider ? { provider: existing.provider } : {}),
            model: existing.name,
            ...(existing.transportKind ? { transportKind: existing.transportKind } : {}),
            ...(existing.supportedReasoningEfforts !== undefined
              ? { supportedEfforts: existing.supportedReasoningEfforts }
              : {}),
          });
        }
        if (thinkingEnabled !== undefined) {
          const modelContext = {
            ...(existing.provider ? { provider: existing.provider } : {}),
            model: existing.name,
            ...(existing.transportKind ? { transportKind: existing.transportKind } : {}),
            ...(existing.supportedReasoningEfforts !== undefined
              ? { supportedEfforts: existing.supportedReasoningEfforts }
              : {}),
            ...(existing.supportsThinkingType
              ? { supportsThinkingType: existing.supportsThinkingType }
              : {}),
          };
          if (thinkingEnabled) {
            delete existing.thinkingEnabled;
          } else {
            existing.thinkingEnabled = false;
          }
          if (shouldPinReasoningEffortToDefault(thinkingEnabled, modelContext)) {
            existing.reasoningEffort = resolveModelReasoningEffortForContext('default', modelContext);
          }
        }
      } else {
        state.config.models.push({
          name: activeModel,
          apiBase,
          reasoningEffort: resolveModelReasoningEffortForContext(reasoningEffort, {
            model: activeModel,
          }),
        });
      }
      state.config.activeModel = activeModel;
    } else {
      state.config.activeModel = '';
      existing = undefined;
    }
    state.config.uiLocale = request.uiLocale?.trim() || undefined;
    if (request.imageGenerationModel !== undefined) {
      const imageGenerationModel = request.imageGenerationModel.trim();
      if (!imageGenerationModel) {
        delete state.config.imageGenerationModel;
      } else {
        const imageProfile = state.config.models.find((model) => model.name === imageGenerationModel);
        if (!imageProfile) {
          throw new Error(i18n.t('error.imageGenModelNotFound', { model: imageGenerationModel }));
        }
        if (!supportsImageGeneration(imageProfile)) {
          throw new Error(i18n.t('error.modelNoImageGenCapability', { model: imageGenerationModel }));
        }
        state.config.imageGenerationModel = imageProfile.name;
      }
    }
    if (request.videoGenerationModel !== undefined) {
      const videoGenerationModel = request.videoGenerationModel.trim();
      if (!videoGenerationModel) {
        delete state.config.videoGenerationModel;
      } else {
        const videoProfile = state.config.models.find((model) => model.name === videoGenerationModel);
        if (!videoProfile) {
          throw new Error(i18n.t('error.videoGenModelNotFound', { model: videoGenerationModel }));
        }
        if (!supportsVideoGeneration(videoProfile)) {
          throw new Error(i18n.t('error.modelNoVideoGenCapability', { model: videoGenerationModel }));
        }
        state.config.videoGenerationModel = videoProfile.name;
      }
    }
    if (request.lightweightChatModel !== undefined) {
      const lightweightChatModel = request.lightweightChatModel.trim();
      if (!lightweightChatModel) {
        delete state.config.lightweightChatModel;
      } else {
        const chatProfile = state.config.models.find((model) => model.name === lightweightChatModel);
        if (!chatProfile) {
          throw new Error(i18n.t('error.lightweightChatModelNotFound', { model: lightweightChatModel }));
        }
        if (!modelSupportsChat(chatProfile)) {
          throw new Error(i18n.t('error.modelNoChatCapability', { model: lightweightChatModel }));
        }
        state.config.lightweightChatModel = chatProfile.name;
      }
    }
    state.config.windowsMica = request.windowsMica !== false;
    if (request.systemNotifications !== undefined) {
      state.config.systemNotifications = request.systemNotifications !== false;
    }
    if (request.agentMode !== undefined) {
      state.config.agentMode = request.agentMode;
    } else if (request.planMode !== undefined) {
      state.config.agentMode = request.planMode ? 'plan' : 'agent';
    }
    if (request.webHost !== undefined) {
      const nextWebHost = normalizeWebHostConfig({
        ...state.config.webHost,
        ...request.webHost,
      });
      if (request.webHost.resetPairing === true) {
        delete nextWebHost.authTokenHash;
      }
      state.config.webHost = nextWebHost;
    }
    if (request.dreams !== undefined) {
      const nextDreamConfig = {
        ...state.config.dreams,
        ...request.dreams,
      };
      if (request.dreams.clearCollectorModel === true) {
        delete nextDreamConfig.collectorModel;
      }
      state.config.dreams = normalizeDreamConfig(nextDreamConfig);
    }
    if (request.agents?.lsp !== undefined) {
      state.config.agents = normalizeAgentsConfig({
        ...state.config.agents,
        lsp: {
          ...state.config.agents.lsp,
          ...request.agents.lsp,
        },
      });
    }
    if (request.agents?.codeCompletion !== undefined) {
      state.config.agents = normalizeAgentsConfig({
        ...state.config.agents,
        codeCompletion: {
          ...state.config.agents.codeCompletion,
          ...request.agents.codeCompletion,
        },
      });
    }
    if (request.networks?.llmHttpVersion !== undefined) {
      state.config.networks = normalizeNetworksConfig({
        ...state.config.networks,
        llmHttpVersion: request.networks.llmHttpVersion,
      });
      applyLlmHttpVersionFromConfig(state.config);
      applyLlmClientVersionFromApp();
    }
    await saveConfig(state.config);
    if (request.apiKey?.trim()) {
      const keyScope = modelProviderKeyScope(existing?.provider);
      await saveApiKeyForProvider(keyScope, request.apiKey);
    }

    const agentModeNow = resolveDesktopAgentMode(state.config);
    const lspEnabledChanged = state.config.agents.lsp.enabled !== prevLspEnabled;
    const modelOrEndpointChanged =
      state.config.activeModel !== prevActiveModel ||
      currentApiBase(state.config) !== prevApiBase;
    const imageGenerationModelChanged = state.config.imageGenerationModel !== prevImageGenerationModel;
    const videoGenerationModelChanged = state.config.videoGenerationModel !== prevVideoGenerationModel;

    if (agentModeNow !== prevAgentMode) {
      state.metadata = await loadHostMetadata(state.workspaceRoot, agentModeNow, {
        activePlanPath: ctx.activeBundle().activePlanPath,
        workspaceBinding: state.workspaceBinding,
      });
    }

    if (lspEnabledChanged) {
      await ctx.disposeAllLspServices();
      ctx.invalidateToolExecutors();
    }

    if (state.config.activeModel !== prevActiveModel) {
      ctx.clearActiveContextUsage();
    }

    const transportOrPlanChanged =
      agentModeNow !== prevAgentMode
      || modelOrEndpointChanged
      || imageGenerationModelChanged
      || videoGenerationModelChanged;
    const activeModelProfile = state.config.models.find(
      (model) => model.name === state.config.activeModel,
    );
    const inferencePreferenceOnlyUpdate =
      !transportOrPlanChanged
      && !lspEnabledChanged
      && agentModeNow === prevAgentMode
      && !Boolean(request.apiKey?.trim())
      && activeModelProfile !== undefined
      && prevActiveModelInference !== undefined
      && state.config.activeModel === prevActiveModel
      && (
        activeModelProfile.thinkingEnabled !== prevActiveModelInference.thinkingEnabled
        || activeModelProfile.reasoningEffort !== prevActiveModelInference.reasoningEffort
      );
    const deferRuntimeRefresh =
      wasBusy &&
      transportOrPlanChanged &&
      !Boolean(request.apiKey?.trim());

    if (deferRuntimeRefresh) {
      ctx.activeBundle().deferredRuntimeRefreshWhileBusy = true;
    } else if (inferencePreferenceOnlyUpdate) {
      ctx.activeBundle().deferredRuntimeRefreshWhileBusy = false;
      await ctx.refreshActiveModelTransportConfig();
    } else {
      ctx.activeBundle().deferredRuntimeRefreshWhileBusy = false;
      await ctx.refreshRuntime();
    }

    if (!inferencePreferenceOnlyUpdate) {
      await ctx.refreshLspSnapshot();
    }

    ctx.setLastRuntimeError('');
    // 勿在此处 persist：仅改 config（如 agentMode）不应刷新 savedAtUnixMs，否则会话在侧栏会误排到首位
    await ctx.flushDeferredRuntimeRefreshIfIdle();
    return ctx.buildSnapshot();
  });
}

function assertAlibabaConnectWorkspace(input: {
  provider?: DesktopModelProvider;
  providerSite?: DesktopProviderConnectSiteId;
  alibabaWorkspaceId?: string;
}): void {
  if (input.provider !== 'alibaba' || !input.providerSite) {
    return;
  }
  if (providerConnectSiteRequiresWorkspaceId('alibaba', input.providerSite)
    && !input.alibabaWorkspaceId?.trim()) {
    throw new Error(i18n.t('error.alibabaWorkspaceIdRequired'));
  }
}

function resolveManagedConnectApiBase(
  provider: DesktopModelProvider | undefined,
  transportKind: DesktopTransportKind,
  requestApiBase: string,
  awsRegion?: string,
  modelName?: string,
  vertexProject?: string,
  vertexLocation?: string,
  azureResourceName?: string,
  providerSite?: DesktopProviderConnectSiteId,
  alibabaWorkspaceId?: string,
): string {
  if (provider === 'amazon-bedrock') {
    const region = awsRegion?.trim();
    if (region) {
      if (modelName && isBedrockMantleOpenAiModel(modelName)) {
        return bedrockMantleApiBaseFromRegion(region);
      }
      return bedrockApiBaseFromRegion(region);
    }
  }
  if (provider === 'google-vertex-ai') {
    const project = vertexProject?.trim();
    const location = vertexLocation?.trim();
    if (project && location) {
      return vertexApiBaseFromProjectAndLocation(project, location);
    }
  }
  if (provider === 'azure') {
    const resourceName = azureResourceName?.trim();
    if (resourceName) {
      return azureApiBaseFromResourceName(resourceName);
    }
  }
  if (provider === 'custom') {
    const trimmed = requestApiBase.trim();
    if (!trimmed) {
      throw new Error(i18n.t('error.endpointRequired'));
    }
    return trimmed;
  }
  if (!provider) {
    const trimmed = requestApiBase.trim();
    return trimmed || defaultApiBaseForTransport('custom', transportKind);
  }
  return defaultApiBaseForTransport(provider, transportKind, providerSite, alibabaWorkspaceId);
}

function assertBedrockConnectCredentials(input: {
  apiKey: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}): void {
  const apiKey = input.apiKey.trim();
  const accessKeyId = input.accessKeyId?.trim();
  const secretAccessKey = input.secretAccessKey?.trim();
  if (hasBedrockRuntimeCredentials({ apiKey, accessKeyId, secretAccessKey })) {
    return;
  }
  throw new Error(i18n.t('error.bedrockCredentialsRequired'));
}

function assertBedrockCatalogCredentials(input: {
  apiKey: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}): void {
  if (hasBedrockIamCredentials(input)) {
    return;
  }
  throw new Error(i18n.t('error.bedrockCatalogIamRequired'));
}

function assertVertexCatalogCredentials(input: {
  apiKey?: string;
  vertexClientEmail?: string;
  vertexPrivateKey?: string;
  vertexProject?: string;
  vertexLocation?: string;
}): void {
  if (input.apiKey?.trim()) {
    throw new Error(i18n.t('error.vertexExpressCatalogUnsupported'));
  }
  if (!input.vertexProject?.trim() || !input.vertexLocation?.trim()) {
    throw new Error(i18n.t('error.vertexProjectLocationRequired'));
  }
  const hasServiceAccountFields = Boolean(
    input.vertexClientEmail?.trim() || input.vertexPrivateKey?.trim(),
  );
  if (
    hasServiceAccountFields
    && !hasGoogleVertexServiceAccountCredentials({
      clientEmail: input.vertexClientEmail,
      privateKey: input.vertexPrivateKey,
    })
  ) {
    throw new Error(i18n.t('error.vertexCatalogServiceAccountRequired'));
  }
}

function assertVertexConnectCredentials(input: {
  apiKey?: string;
  vertexClientEmail?: string;
  vertexPrivateKey?: string;
  vertexProject?: string;
  vertexLocation?: string;
}): void {
  if (hasGoogleVertexRuntimeCredentials(input)) {
    return;
  }
  throw new Error(i18n.t('error.vertexCredentialsRequired'));
}

export async function previewModelsCommand(request: PreviewModelsRequest): Promise<PreviewModelsResponse> {
  const provider = parseModelProviderId(request.provider);
  const transportKind = resolveDesktopTransportKind({
    provider,
    transportKind: request.transportKind,
  });
  const awsRegion = request.awsRegion?.trim();
  const providerSite = request.providerSite?.trim() as DesktopProviderConnectSiteId | undefined;
  const alibabaWorkspaceId = request.alibabaWorkspaceId?.trim();
  const vertexProject = request.vertexProject?.trim();
  const vertexLocation = request.vertexLocation?.trim();
  if (provider === 'amazon-bedrock' && !awsRegion) {
    throw new Error(i18n.t('error.bedrockRegionRequired'));
  }
  assertAlibabaConnectWorkspace({ provider, providerSite, alibabaWorkspaceId });
  const apiBase = resolveManagedConnectApiBase(
    provider,
    transportKind,
    request.apiBase,
    awsRegion,
    undefined,
    vertexProject,
    vertexLocation,
    undefined,
    providerSite,
    alibabaWorkspaceId,
  );
  const apiKey = request.apiKey.trim();
  const accessKeyId = request.accessKeyId?.trim();
  const secretAccessKey = request.secretAccessKey?.trim();
  const vertexClientEmail = request.vertexClientEmail?.trim();
  const vertexPrivateKey = request.vertexPrivateKey?.trim();
  if (provider === 'amazon-bedrock') {
    assertBedrockCatalogCredentials({ apiKey, accessKeyId, secretAccessKey });
  } else if (provider === 'google-vertex-ai') {
    assertVertexCatalogCredentials({
      apiKey,
      vertexClientEmail,
      vertexPrivateKey,
      vertexProject,
      vertexLocation,
    });
  } else if (!apiKey) {
    throw new Error(i18n.t('error.apiKeyRequired'));
  }
  const result = await loadPreviewModelsForTransport({
    provider,
    transportKind,
    apiBase,
    apiKey,
    ...(awsRegion ? { awsRegion } : {}),
    ...(accessKeyId ? { accessKeyId } : {}),
    ...(secretAccessKey ? { secretAccessKey } : {}),
    ...(vertexProject ? { vertexProject } : {}),
    ...(vertexLocation ? { vertexLocation } : {}),
    ...(vertexClientEmail ? { vertexClientEmail } : {}),
    ...(vertexPrivateKey ? { vertexPrivateKey } : {}),
    forceRefresh: request.forceRefresh === true,
  });
  return {
    modelIds: result.modelIds,
    ...(result.modelCatalog ? { models: result.modelCatalog } : {}),
    fromCache: result.fromCache,
  };
}

export async function addProviderModelsCommand(
  ctx: HostModelCommandContext,
  request: AddProviderModelsRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();

    if (ctx.isRuntimeBusy()) {
      throw new Error(i18n.t('error.runtimeBusy'));
    }

    const provider = parseModelProviderId(request.provider);
    const transportKind = resolveDesktopTransportKind({
      provider,
      transportKind: request.transportKind,
    });
    const awsRegion = request.awsRegion?.trim();
    const providerSite = request.providerSite?.trim() as DesktopProviderConnectSiteId | undefined;
    const alibabaWorkspaceId = request.alibabaWorkspaceId?.trim();
    const vertexProject = request.vertexProject?.trim();
    const vertexLocation = request.vertexLocation?.trim();
    if (provider === 'amazon-bedrock' && !awsRegion) {
      throw new Error(i18n.t('error.bedrockRegionRequired'));
    }
    assertAlibabaConnectWorkspace({ provider, providerSite, alibabaWorkspaceId });
    const apiBase = resolveManagedConnectApiBase(
      provider,
      transportKind,
      request.apiBase,
      awsRegion,
      undefined,
      vertexProject,
      vertexLocation,
      undefined,
      providerSite,
      alibabaWorkspaceId,
    );
    const apiKey = request.apiKey.trim();
    const accessKeyId = request.accessKeyId?.trim();
    const secretAccessKey = request.secretAccessKey?.trim();
    const vertexClientEmail = request.vertexClientEmail?.trim();
    const vertexPrivateKey = request.vertexPrivateKey?.trim();
    if (provider === 'amazon-bedrock') {
      assertBedrockConnectCredentials({ apiKey, accessKeyId, secretAccessKey });
    } else if (provider === 'google-vertex-ai') {
      assertVertexConnectCredentials({
        apiKey,
        vertexClientEmail,
        vertexPrivateKey,
        vertexProject,
        vertexLocation,
      });
    } else if (!apiKey) {
      throw new Error(i18n.t('error.apiKeyRequired'));
    }

    const rawIds = request.modelIds.map((id) => id.trim()).filter((id) => id.length > 0);
    const uniqueIds = [...new Set(rawIds)];
    if (uniqueIds.length === 0) {
      throw new Error(i18n.t('error.emptyModelList'));
    }

    type NewProfile = {
      name: string;
      apiBase: string;
      reasoningEffort: ModelReasoningEffort;
      supportedReasoningEfforts?: DesktopModelReasoningEffort[];
      capabilities?: DesktopModelCapability[];
      contextLength?: number;
      supportsThinkingType?: 'only';
      provider?: DesktopModelProvider;
      transportKind?: DesktopTransportKind;
      awsRegion?: string;
      providerSite?: DesktopProviderConnectSiteId;
      alibabaWorkspaceId?: string;
      vertexProject?: string;
      vertexLocation?: string;
    };
    const catalogEntries = previewCatalogMapForAddProviderRequest(request, provider, transportKind);
    const toAdd: NewProfile[] = [];
    for (const name of uniqueIds) {
      if (modelExistsInProviderScope(state.config.models, name, provider)) {
        continue;
      }
      const catalogEntry = catalogEntries.get(name);
      const profile: NewProfile = {
        name,
        apiBase,
        reasoningEffort: defaultModelReasoningEffort({
          ...(reasoningProviderForTransport(provider, transportKind)
            ? { provider: reasoningProviderForTransport(provider, transportKind) }
            : {}),
          model: name,
          ...(catalogEntry?.supportedReasoningEfforts !== undefined
            ? { supportedEfforts: catalogEntry.supportedReasoningEfforts }
            : {}),
          ...(catalogEntry?.supportsThinkingType
            ? { supportsThinkingType: catalogEntry.supportsThinkingType }
            : {}),
        }),
      };
      if (catalogEntry?.supportedReasoningEfforts !== undefined) {
        profile.supportedReasoningEfforts = catalogEntry.supportedReasoningEfforts;
      }
      if (catalogEntry?.capabilities) {
        profile.capabilities = catalogEntry.capabilities;
      }
      if (catalogEntry?.contextLength !== undefined) {
        const contextLength = parseModelContextLength(catalogEntry.contextLength);
        if (contextLength !== undefined) {
          profile.contextLength = contextLength;
        }
      }
      if (catalogEntry?.supportsThinkingType !== undefined) {
        profile.supportsThinkingType = catalogEntry.supportsThinkingType;
      }
      if (provider !== undefined) {
        profile.provider = provider;
        if (transportKind === 'anthropic' || transportKind === 'open-responses' || transportKind === 'bedrock') {
          profile.transportKind = transportKind;
        }
        if (provider === 'amazon-bedrock' && awsRegion) {
          profile.awsRegion = awsRegion;
        }
        if (providerSite) {
          profile.providerSite = providerSite;
        }
        if (provider === 'alibaba' && alibabaWorkspaceId) {
          profile.alibabaWorkspaceId = alibabaWorkspaceId;
        }
        if (provider === 'google-vertex-ai') {
          if (vertexProject) {
            profile.vertexProject = vertexProject;
          }
          if (vertexLocation) {
            profile.vertexLocation = vertexLocation;
          }
        }
      }
      toAdd.push(profile);
    }

    const scopeProfile: ModelProfileSnapshot = {
      name: uniqueIds[0] ?? '',
      apiBase,
      provider,
      reasoningEffort: defaultModelReasoningEffort({
        ...(reasoningProviderForTransport(provider, transportKind)
          ? { provider: reasoningProviderForTransport(provider, transportKind) }
          : {}),
        model: uniqueIds[0] ?? '',
      }),
      ...(transportKind === 'anthropic' || transportKind === 'open-responses' || transportKind === 'bedrock'
        ? { transportKind }
        : {}),
      ...(provider === 'amazon-bedrock' && awsRegion ? { awsRegion } : {}),
      ...(providerSite ? { providerSite } : {}),
      ...(provider === 'alibaba' && alibabaWorkspaceId ? { alibabaWorkspaceId } : {}),
      ...(provider === 'google-vertex-ai' && vertexProject ? { vertexProject } : {}),
      ...(provider === 'google-vertex-ai' && vertexLocation ? { vertexLocation } : {}),
    };
    const catalogRefreshResult = {
      modelIds: uniqueIds,
      fromCache: false,
      modelCatalog: request.modelCatalog,
    };
    const configPreview = structuredClone(state.config);
    const prunedPreview = removeDelistedModelsFromCatalog(
      configPreview,
      scopeProfile,
      catalogRefreshResult,
    );
    const syncedPreview = request.modelCatalog?.length
      ? syncExistingModelsFromCatalog(configPreview, scopeProfile, catalogRefreshResult)
      : 0;

    if (toAdd.length === 0 && syncedPreview === 0 && prunedPreview.length === 0) {
      throw new Error(i18n.t('error.modelsAlreadyExist'));
    }

    const providerKeyScope = modelProviderKeyScope(provider);
    try {
      if (provider === 'amazon-bedrock') {
        await saveBedrockProviderCredentialsForProvider(providerKeyScope, {
          apiKey,
          accessKeyId,
          secretAccessKey,
        });
      } else if (provider === 'google-vertex-ai') {
        await saveGoogleVertexProviderCredentialsForProvider(providerKeyScope, {
          apiKey,
          clientEmail: vertexClientEmail,
          privateKey: vertexPrivateKey,
        });
      } else {
        await saveApiKeyForProvider(providerKeyScope, apiKey);
      }
    } catch (err) {
      if (provider === 'amazon-bedrock') {
        await saveBedrockProviderCredentialsForProvider(providerKeyScope, {});
      } else if (provider === 'google-vertex-ai') {
        await saveGoogleVertexProviderCredentialsForProvider(providerKeyScope, {});
      } else {
        await removeProviderApiKey(providerKeyScope);
      }
      throw err;
    }

    const pruned = removeDelistedModelsFromCatalog(state.config, scopeProfile, catalogRefreshResult);
    if (request.modelCatalog?.length) {
      syncExistingModelsFromCatalog(state.config, scopeProfile, catalogRefreshResult);
    }

    const firstNew = toAdd[0]?.name;
    for (const profile of toAdd) {
      state.config.models.push(profile);
    }

    state.config.activeModel = firstNew ?? state.config.activeModel;
    if (!state.config.imageGenerationModel) {
      const imageGenerationProfile = toAdd.find((profile) => supportsImageGeneration(profile));
      if (imageGenerationProfile) {
        state.config.imageGenerationModel = imageGenerationProfile.name;
      }
    }
    if (!state.config.videoGenerationModel) {
      const videoGenerationProfile = toAdd.find((profile) => supportsVideoGeneration(profile));
      if (videoGenerationProfile) {
        state.config.videoGenerationModel = videoGenerationProfile.name;
      }
    }
    for (const name of pruned) {
      await removeModelApiKey(name);
    }
    await saveConfig(state.config);
    await ctx.refreshRuntime();
    ctx.setLastRuntimeError('');
    await ctx.persistCurrentSessionIfNeeded();
    return ctx.buildSnapshot();
  });
}

export async function addModelCommand(
  ctx: HostModelCommandContext,
  request: AddModelRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();

    if (ctx.isRuntimeBusy()) {
      throw new Error(i18n.t('error.runtimeBusy'));
    }

    const name = request.name.trim();
    const provider = parseModelProviderId(request.provider);
    if (
      provider === 'azure'
      && request.transportKind !== undefined
      && request.transportKind !== 'open-responses'
    ) {
      throw new Error(i18n.t('error.azureOpenResponsesOnly'));
    }
    const transportKind = resolveDesktopTransportKind({
      provider,
      transportKind: request.transportKind,
    });
    const awsRegion = request.awsRegion?.trim();
    const providerSite = request.providerSite?.trim() as DesktopProviderConnectSiteId | undefined;
    const alibabaWorkspaceId = request.alibabaWorkspaceId?.trim();
    const vertexProject = request.vertexProject?.trim();
    const vertexLocation = request.vertexLocation?.trim();
    const azureResourceName = request.azureResourceName?.trim();
    if (provider === 'amazon-bedrock' && !awsRegion) {
      throw new Error(i18n.t('error.bedrockRegionRequired'));
    }
    if (provider === 'azure' && !azureResourceName) {
      throw new Error(i18n.t('error.azureResourceNameRequired'));
    }
    if (provider === 'azure' && azureResourceName && !isValidAzureResourceName(azureResourceName)) {
      throw new Error(i18n.t('error.azureResourceNameInvalid'));
    }
    assertAlibabaConnectWorkspace({ provider, providerSite, alibabaWorkspaceId });
    const apiBase = resolveManagedConnectApiBase(
      provider,
      transportKind,
      request.apiBase,
      awsRegion,
      name,
      vertexProject,
      vertexLocation,
      azureResourceName,
      providerSite,
      alibabaWorkspaceId,
    );
    const apiKey = request.apiKey.trim();

    if (!name) {
      throw new Error(i18n.t('error.modelNameRequired'));
    }
    if (provider === 'google-vertex-ai') {
      assertVertexConnectCredentials({
        apiKey,
        vertexProject,
        vertexLocation,
      });
    } else if (provider === 'azure' && /\s/u.test(name)) {
      throw new Error(i18n.t('error.azureDeploymentNameWhitespace'));
    } else if (!apiKey) {
      throw new Error(i18n.t('error.apiKeyRequired'));
    }
    if (state.config.models.some((model) => model.name === name)) {
      throw new Error(i18n.t('error.modelExists', { name }));
    }

    const catalogEntry = await findCatalogEntryForModel({
      provider,
      transportKind,
      apiBase,
      apiKey,
      model: name,
    });
    const requestedCapabilities = normalizeModelCapabilities(request.capabilities);

    const profile: {
      name: string;
      apiBase: string;
      reasoningEffort: ModelReasoningEffort;
      supportedReasoningEfforts?: DesktopModelReasoningEffort[];
      provider?: DesktopModelProvider;
      transportKind?: DesktopTransportKind;
      capabilities?: DesktopModelCapability[];
      contextLength?: number;
      supportsThinkingType?: 'only';
      awsRegion?: string;
      providerSite?: DesktopProviderConnectSiteId;
      alibabaWorkspaceId?: string;
      vertexProject?: string;
      vertexLocation?: string;
      azureResourceName?: string;
    } = {
      name,
      apiBase,
      reasoningEffort: defaultModelReasoningEffort({
        ...(reasoningProviderForTransport(provider, transportKind)
          ? { provider: reasoningProviderForTransport(provider, transportKind) }
          : {}),
        model: name,
        ...(catalogEntry?.supportedReasoningEfforts !== undefined
          ? { supportedEfforts: catalogEntry.supportedReasoningEfforts }
          : {}),
        ...(catalogEntry?.supportsThinkingType
          ? { supportsThinkingType: catalogEntry.supportsThinkingType }
          : {}),
      }),
    };
    if (catalogEntry?.supportedReasoningEfforts !== undefined) {
      profile.supportedReasoningEfforts = catalogEntry.supportedReasoningEfforts;
    }
    if (provider !== undefined) {
      profile.provider = provider;
      if (transportKind === 'anthropic' || transportKind === 'open-responses' || transportKind === 'bedrock') {
        profile.transportKind = transportKind;
      }
      if (provider === 'amazon-bedrock' && awsRegion) {
        profile.awsRegion = awsRegion;
      }
      if (providerSite) {
        profile.providerSite = providerSite;
      }
      if (provider === 'alibaba' && alibabaWorkspaceId) {
        profile.alibabaWorkspaceId = alibabaWorkspaceId;
      }
      if (provider === 'google-vertex-ai') {
        if (vertexProject) {
          profile.vertexProject = vertexProject;
        }
        if (vertexLocation) {
          profile.vertexLocation = vertexLocation;
        }
      }
      if (provider === 'azure' && azureResourceName) {
        profile.azureResourceName = azureResourceName;
      }
    }
    const capabilities = resolveAddedModelCapabilities({
      provider,
      requestedCapabilities,
      catalogEntry,
    });
    if (capabilities) {
      profile.capabilities = capabilities;
    }
    if (catalogEntry?.contextLength !== undefined && request.contextLength === undefined) {
      const contextLength = parseModelContextLength(catalogEntry.contextLength);
      if (contextLength !== undefined) {
        profile.contextLength = contextLength;
      }
    }
    if (catalogEntry?.supportsThinkingType !== undefined) {
      profile.supportsThinkingType = catalogEntry.supportsThinkingType;
    }
    if (request.contextLength !== undefined) {
      const contextLength = parseModelContextLength(request.contextLength);
      if (contextLength === undefined) {
        throw new Error(i18n.t('error.contextLengthInvalid'));
      }
      profile.contextLength = contextLength;
    }
    state.config.models.push(profile);
    state.config.activeModel = name;
    ctx.clearActiveContextUsage();
    if (!state.config.imageGenerationModel && supportsImageGeneration(profile)) {
      state.config.imageGenerationModel = name;
    }
    if (!state.config.videoGenerationModel && supportsVideoGeneration(profile)) {
      state.config.videoGenerationModel = name;
    }
    await saveConfig(state.config);
    if (provider === 'amazon-bedrock') {
      await saveBedrockProviderCredentialsForProvider(modelProviderKeyScope(provider), { apiKey });
    } else if (provider === 'google-vertex-ai') {
      await saveGoogleVertexProviderCredentialsForProvider(modelProviderKeyScope(provider), { apiKey });
    } else if (provider !== undefined) {
      await saveApiKeyForProvider(modelProviderKeyScope(provider), apiKey);
    } else {
      await saveApiKeyForModel(name, apiKey);
    }

    await ctx.refreshRuntime();
    ctx.setLastRuntimeError('');
    await ctx.persistCurrentSessionIfNeeded();
    return ctx.buildSnapshot();
  });
}

export async function removeModelCommand(
  ctx: HostModelCommandContext,
  request: RemoveModelRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();

    const name = request.name.trim();
    if (!name) {
      throw new Error(i18n.t('error.modelNameRequired'));
    }
    const targetsToRemove: ModelRemovalTarget[] = state.config.models
      .filter((model) => model.name === name)
      .map((model) => ({ name: model.name, provider: model.provider }));
    if (targetsToRemove.length === 0) {
      throw new Error(i18n.t('error.modelNotFound', { name }));
    }

    return finalizeModelRemoval(ctx, state, targetsToRemove, { removeLegacyModelKeys: true });
  });
}

export async function removeProviderModelsCommand(
  ctx: HostModelCommandContext,
  request: RemoveProviderModelsRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();

    const provider = parsePresetModelProviderId(request.provider);
    if (!provider) {
      throw new Error(i18n.t('error.providerDeleteOnly'));
    }

    const { matched: targets } = partitionModelsByProvider(state.config.models, provider);
    if (targets.length === 0) {
      throw new Error(i18n.t('error.noModelsInProvider'));
    }

    const targetsToRemove: ModelRemovalTarget[] = targets.map((model) => ({
      name: model.name,
      provider: model.provider,
    }));
    return finalizeModelRemoval(ctx, state, targetsToRemove, { removeProviderKey: provider });
  });
}

async function finalizeModelRemoval(
  ctx: HostModelCommandContext,
  state: HostModelState,
  targetsToRemove: readonly ModelRemovalTarget[],
  options?: {
    removeProviderKey?: DesktopModelProvider;
    removeLegacyModelKeys?: boolean;
  },
): Promise<DesktopSnapshot> {
  applyModelsRemovalToConfig(state.config, targetsToRemove);
  await saveConfig(state.config);
  if (options?.removeProviderKey) {
    await removeProviderApiKey(options.removeProviderKey);
  }
  if (options?.removeLegacyModelKeys) {
    for (const target of targetsToRemove) {
      await removeModelApiKey(target.name);
    }
  }
  await ctx.refreshModelKeyPresence();
  await ctx.refreshRuntime();
  ctx.setLastRuntimeError('');
  await ctx.persistCurrentSessionIfNeeded();
  return ctx.buildSnapshot();
}
