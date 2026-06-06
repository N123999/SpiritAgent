import path from 'node:path';

import { resolveDesktopAgentMode } from '../lib/agent-mode.js';
import type { PlanSnapshot } from '../types.js';
import {
  discoverWorkspaceRoot,
  applyLlmHttpVersionFromConfig,
  loadConfig,
  loadHostMetadata,
  mergeRecentWorkspaceRoots,
  normalizeWorkspaceBinding,
  resolveDesktopHomeDirectory,
  saveConfig,
  type DesktopConfigFile,
  type DesktopWorkspaceBinding,
  type HostMetadataSummary,
} from './storage.js';
import { applyGitRevision, readWorkspaceGitSnapshot } from './git.js';
import type { SessionRegistry } from './session-registry.js';
import type { DesktopToolExecutor } from './tool-executor.js';
import type { DesktopGitSnapshot, DesktopExtensionCssLayer, DesktopExtensionListItem } from '../types.js';
import type { EphemeralSessionRecord } from './sessions.js';
import { ensureBuiltinUserSkills } from './builtin-skills.js';
import { resolveWorkspaceBindingForRequestedRoot, sameWorkspaceRoot } from './service-utils.js';
import { spiritAgentDataDir } from './storage.js';
import type { ExtensionWarmupTrigger } from './extension-warmup.js';

export interface InitializationState {
  workspaceRoot: string;
  workspaceBinding: DesktopWorkspaceBinding;
  config: DesktopConfigFile;
  git: DesktopGitSnapshot;
  metadata: HostMetadataSummary;
  plan: PlanSnapshot;
  extensionsList: DesktopExtensionListItem[];
  extensionCss: DesktopExtensionCssLayer[];
  ephemeralSessions: EphemeralSessionRecord[];
}

export interface HostInitializationContext {
  initialized(): boolean;
  state(): InitializationState | undefined;
  setState(state: InitializationState): void;
  setInitialized(initialized: boolean): void;
  setLastRuntimeError(error: string): void;
  setToolExecutor(executor: DesktopToolExecutor | undefined): void;
  sessionRegistry(): SessionRegistry;
  resetStreamingPlacementState(full: boolean): void;
  refreshExtensionsList(options?: { metadataOnly?: boolean }): Promise<void>;
  refreshRuntime(): Promise<void>;
  refreshLspSnapshot(): Promise<void>;
  deactivateExtensions(): Promise<void>;
  invalidateExtensionWarmup(): void;
  scheduleExtensionWarmup(trigger: ExtensionWarmupTrigger): void;
  loadDesktopPlanSnapshot(planPath: string, existsHint?: boolean): Promise<PlanSnapshot>;
}

export async function ensureInitializedCommand(
  ctx: HostInitializationContext,
  workspaceRootOverride?: string,
  options: {
    fastPath?: boolean;
    preserveRecentWorkspaces?: boolean;
    /** Skip global runtime rebuild after workspace switch; caller will activate a session bundle. */
    deferRuntimeRefresh?: boolean;
    /** Skip extension warmup scheduling; caller will schedule after serialized work completes. */
    deferExtensionWarmup?: boolean;
    workspaceBinding?: DesktopWorkspaceBinding;
  } = {},
): Promise<void> {
  const requestedWorkspaceRoot = workspaceRootOverride?.trim()
    ? path.resolve(workspaceRootOverride.trim())
    : undefined;

  const loadedConfig = await loadConfig();
  applyLlmHttpVersionFromConfig(loadedConfig);
  await ensureBuiltinUserSkills(spiritAgentDataDir());
  const previousState = ctx.state();
  const previousBinding = normalizeWorkspaceBinding(
    previousState?.workspaceBinding ?? loadedConfig.workspaceBinding,
  );
  const workspaceBinding = resolveWorkspaceBindingForRequestedRoot({
    requestedWorkspaceRoot,
    explicitBinding: options.workspaceBinding,
    previousBinding,
    persistedBinding: normalizeWorkspaceBinding(loadedConfig.workspaceBinding),
  });

  const workspaceRoot =
    workspaceBinding === 'none'
      ? resolveDesktopHomeDirectory()
      : requestedWorkspaceRoot
        ?? (previousState?.workspaceBinding === 'project' ? previousState.workspaceRoot : undefined)
        ?? loadedConfig.lastProjectWorkspaceRoot
        ?? loadedConfig.recentWorkspaces?.[0]
        ?? discoverWorkspaceRoot();

  if (
    options.fastPath === true &&
    ctx.initialized() &&
    previousState?.workspaceRoot &&
    sameWorkspaceRoot(previousState.workspaceRoot, workspaceRoot) &&
    previousBinding === workspaceBinding
  ) {
    return;
  }

  const git = await readWorkspaceGitSnapshot(workspaceRoot);
  let lastProjectWorkspaceRoot = loadedConfig.lastProjectWorkspaceRoot;
  if (
    workspaceBinding === 'none'
    && previousBinding === 'project'
    && previousState?.workspaceRoot
    && !sameWorkspaceRoot(previousState.workspaceRoot, resolveDesktopHomeDirectory())
  ) {
    lastProjectWorkspaceRoot = previousState.workspaceRoot;
  }

  const preserveRecent =
    workspaceBinding === 'none'
    || options.preserveRecentWorkspaces === true;
  const config = {
    ...loadedConfig,
    workspaceBinding,
    ...(lastProjectWorkspaceRoot ? { lastProjectWorkspaceRoot } : {}),
    recentWorkspaces: preserveRecent
      ? (loadedConfig.recentWorkspaces ?? [])
      : mergeRecentWorkspaceRoots(
          loadedConfig.recentWorkspaces,
          git.primaryRepoRoot ?? workspaceRoot,
        ),
  } satisfies DesktopConfigFile;

  const recentWorkspacesChanged =
    !loadedConfig.recentWorkspaces ||
    config.recentWorkspaces.length !== loadedConfig.recentWorkspaces.length ||
    config.recentWorkspaces.some((entry, index) => entry !== loadedConfig.recentWorkspaces?.[index]);
  const bindingChanged = normalizeWorkspaceBinding(loadedConfig.workspaceBinding) !== workspaceBinding;
  const lastProjectChanged = loadedConfig.lastProjectWorkspaceRoot !== config.lastProjectWorkspaceRoot;
  if (recentWorkspacesChanged || bindingChanged || lastProjectChanged) {
    await saveConfig(config);
  }

  if (
    ctx.initialized()
    && previousState?.workspaceRoot
    && sameWorkspaceRoot(previousState.workspaceRoot, workspaceRoot)
    && previousBinding === workspaceBinding
  ) {
    const currentState = ctx.state();
    if (!currentState) {
      return;
    }
    currentState.config = config;
    currentState.git = applyGitRevision(git, currentState.git.revision ?? 0);
    currentState.workspaceBinding = workspaceBinding;
    currentState.plan = await ctx.loadDesktopPlanSnapshot(
      currentState.metadata.planMetadata.path,
      currentState.metadata.planMetadata.exists,
    );
    await ctx.refreshLspSnapshot();
    return;
  }

  const metadata = await loadHostMetadata(workspaceRoot, resolveDesktopAgentMode(config), {
    workspaceBinding,
  });
  const plan = await ctx.loadDesktopPlanSnapshot(metadata.planMetadata.path, metadata.planMetadata.exists);
  const state = ctx.state();
  const previousWorkspaceRoot = state?.workspaceRoot;
  const switchingWorkspace = Boolean(
    previousWorkspaceRoot && !sameWorkspaceRoot(previousWorkspaceRoot, workspaceRoot),
  );
  if (switchingWorkspace) {
    await ctx.deactivateExtensions();
    ctx.invalidateExtensionWarmup();
  }

  if (switchingWorkspace) {
    ctx.setLastRuntimeError('');
    ctx.setToolExecutor(undefined);
    ctx.sessionRegistry().clearForWorkspaceSwitch(workspaceRoot);
    ctx.resetStreamingPlacementState(true);
  } else if (!ctx.sessionRegistry().hasActive()) {
    ctx.sessionRegistry().ensureDraft(workspaceRoot);
  } else {
    ctx.sessionRegistry().requireActive().workspaceRoot = workspaceRoot;
  }

  ctx.setState({
    workspaceRoot,
    workspaceBinding,
    config,
    git: applyGitRevision(git, 0, { reset: true }),
    metadata,
    plan,
    extensionsList: state?.extensionsList ?? [],
    extensionCss: state?.extensionCss ?? [],
    ephemeralSessions: state?.ephemeralSessions ?? [],
  });
  ctx.setInitialized(true);
  await ctx.refreshExtensionsList({ metadataOnly: true });
  await ctx.refreshLspSnapshot();
  const skipRuntimeRefresh = switchingWorkspace && options.deferRuntimeRefresh === true;
  if (!skipRuntimeRefresh) {
    await ctx.refreshRuntime();
  }
  if (options.deferExtensionWarmup !== true) {
    ctx.scheduleExtensionWarmup({ type: 'startup', workspaceRoot });
  }
}
