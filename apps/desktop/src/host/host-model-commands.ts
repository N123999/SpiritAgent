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

import { resolveDesktopAgentMode } from '../lib/agent-mode.js';
import i18n from '../lib/i18n-host.js';
import type {
  AddModelRequest,
  AddProviderModelsRequest,
  DesktopModelCapability,
  DesktopModelProvider,
  DesktopModelReasoningEffort,
  DesktopSnapshot,
  DesktopTransportKind,
  PreviewModelsRequest,
  PreviewModelsResponse,
  RemoveModelRequest,
  RemoveProviderModelsRequest,
  UpdateConfigRequest,
} from '../types.js';
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
import { modelSupportsChat } from './lightweight-chat-model.js';
import { modelExistsInProviderScope, resolveActiveModelAfterRemoval } from './provider-api-key.js';
import {
  loadHostMetadata,
  modelProviderKeyScope,
  normalizeDreamConfig,
  normalizeAgentsConfig,
  normalizeNetworksConfig,
  applyLlmHttpVersionFromConfig,
  normalizeModelCapabilities,
  normalizeWebHostConfig,
  removeModelApiKey,
  removeProviderApiKey,
  saveApiKeyForModel,
  saveApiKeyForProvider,
  saveConfig,
  type DesktopConfigFile,
  type DesktopWorkspaceBinding,
  type HostMetadataSummary,
} from './storage.js';
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
  ensureInitialized(): Promise<void>;
  requireState(): HostModelState;
  activeBundle(): HostModelBundle;
  isRuntimeBusy(): boolean;
  refreshRuntime(): Promise<void>;
  refreshModelKeyPresence(): Promise<void>;
  flushDeferredRuntimeRefreshIfIdle(): Promise<void>;
  persistCurrentSessionIfNeeded(): Promise<void>;
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
    await ctx.ensureInitialized();
    const state = ctx.requireState();
    const wasBusy = ctx.isRuntimeBusy();
    const prevActiveModel = state.config.activeModel;
    const prevImageGenerationModel = state.config.imageGenerationModel;
    const prevVideoGenerationModel = state.config.videoGenerationModel;
    const prevApiBase = currentApiBase(state.config);
    const prevAgentMode = resolveDesktopAgentMode(state.config);
    const prevLspEnabled = state.config.agents.lsp.enabled;

    if (ctx.isRuntimeBusy() && Boolean(request.apiKey?.trim())) {
      throw new Error(i18n.t('error.runtimeBusy'));
    }

    const activeModel = request.activeModel.trim();
    const apiBase = request.apiBase.trim();
    const reasoningEffort = request.reasoningEffort;
    const existing = state.config.models.find((model) => model.name === activeModel);
    if (existing) {
      existing.apiBase = apiBase;
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
    if (request.networks?.llmHttpVersion !== undefined) {
      state.config.networks = normalizeNetworksConfig({
        ...state.config.networks,
        llmHttpVersion: request.networks.llmHttpVersion,
      });
      applyLlmHttpVersionFromConfig(state.config);
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
    await ctx.refreshLspSnapshot();

    const transportOrPlanChanged =
      agentModeNow !== prevAgentMode
      || modelOrEndpointChanged
      || imageGenerationModelChanged
      || videoGenerationModelChanged;
    const deferRuntimeRefresh =
      wasBusy &&
      transportOrPlanChanged &&
      !Boolean(request.apiKey?.trim());

    if (deferRuntimeRefresh) {
      ctx.activeBundle().deferredRuntimeRefreshWhileBusy = true;
    } else {
      ctx.activeBundle().deferredRuntimeRefreshWhileBusy = false;
      await ctx.refreshRuntime();
    }
    ctx.setLastRuntimeError('');
    // 勿在此处 persist：仅改 config（如 agentMode）不应刷新 savedAtUnixMs，否则会话在侧栏会误排到首位
    await ctx.flushDeferredRuntimeRefreshIfIdle();
    return ctx.buildSnapshot();
  });
}

export async function previewModelsCommand(request: PreviewModelsRequest): Promise<PreviewModelsResponse> {
  const provider = parseModelProviderId(request.provider);
  const transportKind = resolveDesktopTransportKind({
    provider,
    transportKind: request.transportKind,
  });
  const apiBaseRaw = request.apiBase.trim();
  const apiBase = apiBaseRaw || defaultApiBaseForTransport(provider, transportKind);
  const apiKey = request.apiKey.trim();
  if (!apiKey) {
    throw new Error(i18n.t('error.apiKeyRequired'));
  }
  const result = await loadPreviewModelsForTransport({
    provider,
    transportKind,
    apiBase,
    apiKey,
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
    const apiBaseRaw = request.apiBase.trim();
    const apiBase = apiBaseRaw || defaultApiBaseForTransport(provider, transportKind);
    const apiKey = request.apiKey.trim();
    if (!apiKey) {
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
      provider?: DesktopModelProvider;
      transportKind?: DesktopTransportKind;
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
        }),
      };
      if (catalogEntry?.supportedReasoningEfforts !== undefined) {
        profile.supportedReasoningEfforts = catalogEntry.supportedReasoningEfforts;
      }
      if (catalogEntry?.capabilities) {
        profile.capabilities = catalogEntry.capabilities;
      }
      if (provider !== undefined) {
        profile.provider = provider;
        if (transportKind === 'anthropic' || transportKind === 'open-responses') {
          profile.transportKind = transportKind;
        }
      }
      toAdd.push(profile);
    }

    if (toAdd.length === 0) {
      throw new Error(i18n.t('error.modelsAlreadyExist'));
    }

    const providerKeyScope = modelProviderKeyScope(provider);
    try {
      await saveApiKeyForProvider(providerKeyScope, apiKey);
    } catch (err) {
      await removeProviderApiKey(providerKeyScope);
      throw err;
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
    const transportKind = resolveDesktopTransportKind({
      provider,
      transportKind: request.transportKind,
    });
    const apiBaseRaw = request.apiBase.trim();
    const apiBase = apiBaseRaw || defaultApiBaseForTransport(provider, transportKind);
    const apiKey = request.apiKey.trim();

    if (!name) {
      throw new Error(i18n.t('error.modelNameRequired'));
    }
    if (!apiKey) {
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
      }),
    };
    if (catalogEntry?.supportedReasoningEfforts !== undefined) {
      profile.supportedReasoningEfforts = catalogEntry.supportedReasoningEfforts;
    }
    if (provider !== undefined) {
      profile.provider = provider;
      if (transportKind === 'anthropic' || transportKind === 'open-responses') {
        profile.transportKind = transportKind;
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
    state.config.models.push(profile);
    state.config.activeModel = name;
    if (!state.config.imageGenerationModel && supportsImageGeneration(profile)) {
      state.config.imageGenerationModel = name;
    }
    if (!state.config.videoGenerationModel && supportsVideoGeneration(profile)) {
      state.config.videoGenerationModel = name;
    }
    await saveConfig(state.config);
    if (provider !== undefined) {
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
    const before = state.config.models.length;
    state.config.models = state.config.models.filter((model) => model.name !== name);
    if (state.config.models.length === before) {
      throw new Error(i18n.t('error.modelNotFound', { name }));
    }

    return finalizeModelRemoval(ctx, state, [name], { removeLegacyModelKeys: true });
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

    const { matched: targets, unmatched } = partitionModelsByProvider(state.config.models, provider);
    if (targets.length === 0) {
      throw new Error(i18n.t('error.noModelsInProvider'));
    }

    const namesToRemove = targets.map((model) => model.name);
    state.config.models = unmatched;
    return finalizeModelRemoval(ctx, state, namesToRemove, { removeProviderKey: provider });
  });
}

async function finalizeModelRemoval(
  ctx: HostModelCommandContext,
  state: HostModelState,
  namesToRemove: readonly string[],
  options?: {
    removeProviderKey?: DesktopModelProvider;
    removeLegacyModelKeys?: boolean;
  },
): Promise<DesktopSnapshot> {
  state.config.activeModel = resolveActiveModelAfterRemoval(
    state.config.activeModel,
    state.config.models,
    namesToRemove,
  );
  if (state.config.imageGenerationModel && namesToRemove.includes(state.config.imageGenerationModel)) {
    delete state.config.imageGenerationModel;
  }
  if (state.config.videoGenerationModel && namesToRemove.includes(state.config.videoGenerationModel)) {
    delete state.config.videoGenerationModel;
  }
  if (state.config.lightweightChatModel && namesToRemove.includes(state.config.lightweightChatModel)) {
    delete state.config.lightweightChatModel;
  }
  await saveConfig(state.config);
  if (options?.removeProviderKey) {
    await removeProviderApiKey(options.removeProviderKey);
  }
  if (options?.removeLegacyModelKeys) {
    for (const name of namesToRemove) {
      await removeModelApiKey(name);
    }
  }
  await ctx.refreshModelKeyPresence();
  await ctx.refreshRuntime();
  ctx.setLastRuntimeError('');
  await ctx.persistCurrentSessionIfNeeded();
  return ctx.buildSnapshot();
}
