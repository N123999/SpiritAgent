import type {
  ActiveSessionSnapshot,
  ConversationSnapshot,
  DesktopDreamCollectorSnapshot,
  DesktopExtensionCssLayer,
  DesktopExtensionListItem,
  DesktopGitSnapshot,
  DesktopMcpServerListItem,
  DesktopModelCatalogHint,
  DesktopSnapshot,
  McpStatusSnapshot,
} from '../types.js';
import { readModelCatalogCacheSync } from './model-catalog-cache.js';
import {
  DEFAULT_API_BASE,
  type DesktopConfigFile,
  type HostMetadataSummary,
} from './storage.js';
import {
  buildAvailableWorkspaces,
  buildWebHostSnapshot,
} from './service-utils.js';

export interface BuildDesktopSnapshotInput {
  workspaceRoot: string;
  config: DesktopConfigFile;
  git: DesktopGitSnapshot;
  metadata: HostMetadataSummary;
  plan: DesktopSnapshot['plan'];
  extensionsList: DesktopExtensionListItem[];
  extensionCss: DesktopExtensionCssLayer[];
  dreamCollectorStatus: DesktopDreamCollectorSnapshot;
  runtimeReady: boolean;
  runtimeError?: string;
  modelKeyPresence: Record<string, boolean>;
  activeApiKeyConfigured: boolean;
  mcpStatus: McpStatusSnapshot;
  mcpServers: DesktopMcpServerListItem[];
  conversation: ConversationSnapshot;
  activeSession?: ActiveSessionSnapshot;
}

export function buildDesktopSnapshot(input: BuildDesktopSnapshotInput): DesktopSnapshot {
  return {
    workspaceRoot: input.workspaceRoot,
    availableWorkspaces: buildAvailableWorkspaces(
      input.workspaceRoot,
      input.config.recentWorkspaces,
    ),
    git: { ...input.git },
    dreams: {
      settings: {
        enabled: input.config.dreams.enabled === true,
        ...(input.config.dreams.collectorModel ? { collectorModel: input.config.dreams.collectorModel } : {}),
        debugMode: input.config.dreams.debugMode === true,
      },
      collector: { ...input.dreamCollectorStatus },
    },
    runtimeReady: input.runtimeReady,
    ...(input.runtimeError ? { runtimeError: input.runtimeError } : {}),
    config: {
      models: input.config.models.map((model) => ({
        name: model.name,
        apiBase: model.apiBase,
        reasoningEffort: model.reasoningEffort,
        ...(model.supportedReasoningEfforts !== undefined
          ? { supportedReasoningEfforts: [...model.supportedReasoningEfforts] }
          : {}),
        ...(model.capabilities ? { capabilities: [...model.capabilities] } : {}),
        ...(model.provider ? { provider: model.provider } : {}),
        ...(model.transportKind ? { transportKind: model.transportKind } : {}),
        keyConfigured: input.modelKeyPresence[model.name] ?? false,
      })),
      activeModel: input.config.activeModel,
      ...(input.config.imageGenerationModel ? { imageGenerationModel: input.config.imageGenerationModel } : {}),
      ...(input.config.uiLocale ? { uiLocale: input.config.uiLocale } : {}),
      activeApiKeyConfigured: input.activeApiKeyConfigured,
      windowsMica: input.config.windowsMica !== false,
      planMode: input.config.planMode === true,
      modelCatalogHints: buildModelCatalogHints(input.config),
    },
    webHost: buildWebHostSnapshot(input.config.webHost),
    rules: {
      discovered: input.metadata.rules.discovered,
      enabled: input.metadata.rules.enabled,
    },
    skills: {
      discovered: input.metadata.skills.discovered,
      enabled: input.metadata.skills.enabled,
    },
    skillsList: input.metadata.skills.entries.map((entry) => ({
      id: entry.source.id,
      name: entry.source.name,
      description: entry.source.description,
      shortLabel: entry.source.shortLabel,
      scope: entry.source.scope,
      rootKind: entry.source.rootKind,
      enabled: entry.enabled,
    })),
    extensionsList: input.extensionsList.map((item) => ({ ...item })),
    extensionCss: input.extensionCss.map((entry) => ({ ...entry })),
    plan: { ...input.plan },
    mcpStatus: input.mcpStatus,
    mcpServers: input.mcpServers,
    conversation: input.conversation,
    ...(input.activeSession ? { activeSession: { ...input.activeSession } } : {}),
  };
}

export function buildModelCatalogHints(config: DesktopConfigFile): DesktopModelCatalogHint[] {
  const seen = new Set<string>();
  const hints: DesktopModelCatalogHint[] = [];
  for (const model of config.models) {
    const base = model.apiBase.trim() || DEFAULT_API_BASE;
    const transportKind = model.transportKind ?? (model.provider === 'anthropic' ? 'anthropic' : 'openai-compatible');
    const cacheKey = `${model.provider ?? 'custom'}::${transportKind}::${base}`;
    if (seen.has(cacheKey)) {
      continue;
    }
    seen.add(cacheKey);
    const hit = readModelCatalogCacheSync(base, model.provider, transportKind);
    if (hit && hit.modelIds.length > 0) {
      hints.push({
        ...(hit.provider ? { provider: hit.provider } : {}),
        ...(hit.transportKind ? { transportKind: hit.transportKind } : {}),
        apiBase: hit.apiBase,
        modelIds: hit.modelIds,
        fetchedAtUnixMs: hit.fetchedAtUnixMs,
      });
    }
  }
  return hints;
}
