import path from 'node:path';

import type { SessionEndHookInput, SessionStartHookInput } from '@spirit-agent/core';

import { resolveDesktopAgentMode } from '../lib/agent-mode.js';
import i18n from '../lib/i18n-host.js';
import type {
  ConversationMessageSnapshot,
  DesktopGitSnapshot,
  DesktopSnapshot,
} from '../types.js';
import type { DesktopRuntime } from './runtime.js';
import type { SessionBundle } from './session-bundle.js';
import type { SessionRegistry } from './session-registry.js';
import { loadStoredSession, type DesktopConfigFile, type DesktopWorkspaceBinding } from './storage.js';
import {
  isEphemeralDebugSessionPath,
  restoreEphemeralSessionState,
  restoreStoredSessionState,
  type EphemeralSessionRecord,
} from './sessions.js';
import type { DesktopTimelineTurnSnapshot, DesktopMessageTimeline } from './message-timeline.js';
import { restoreMessagesFromArchive } from './message-ordering.js';
import { currentApiBase, sameWorkspaceRoot } from './service-utils.js';
import type { HostExtensionEvent } from '@spirit-agent/host-internal';
import { cancelPendingWorktreeBootstrapOnBundle } from './worktree-bootstrap-orchestrator.js';
import { resolveStoredSessionWorkspaceRoot } from './resolve-session-workspace-root.js';

interface ActivationState {
  workspaceRoot: string;
  workspaceBinding: DesktopWorkspaceBinding;
  config: DesktopConfigFile;
  git: DesktopGitSnapshot;
}

export interface SessionActivationContext {
  runSerialized<T>(work: () => Promise<T>): Promise<T>;
  ensureInitialized(
    workspaceRootOverride?: string,
    options?: {
      fastPath?: boolean;
      preserveRecentWorkspaces?: boolean;
      deferRuntimeRefresh?: boolean;
    },
  ): Promise<void>;
  requireState(): ActivationState;
  isInitialized(): boolean;
  currentWorkspaceRoot(): string | undefined;
  currentRuntime(): DesktopRuntime | undefined;
  sessionRegistry(): SessionRegistry;
  persistSessionBundle(
    bundle: SessionBundle,
    options: { fromRuntime?: DesktopRuntime; bumpListSortAt?: boolean },
  ): Promise<void>;
  finalizeTodoScopeForNewActiveBundle(bundle: SessionBundle, workspaceRoot: string): Promise<void>;
  resetStreamingPlacementState(full: boolean, bundle: SessionBundle): void;
  findEphemeralSession(filePath: string): EphemeralSessionRecord | undefined;
  createMessageTimelineFromMessages(
    messages: ConversationMessageSnapshot[],
    timelineSnapshot?: DesktopTimelineTurnSnapshot[],
  ): DesktopMessageTimeline;
  syncPlanStateForBundle(bundle: SessionBundle): Promise<void>;
  syncHostWorkspaceRootToActiveBundle(bundle: SessionBundle): Promise<boolean>;
  tickSession(bundle: SessionBundle): Promise<void>;
  syncActiveRuntimePointer(): void;
  refreshTodoSnapshotForBundle(bundle: SessionBundle): Promise<void>;
  flushDeferredRuntimeRefreshIfIdle(bundle?: SessionBundle): Promise<void>;
  ensureToolExecutor(bundle: SessionBundle): Promise<unknown>;
  refreshRuntimeForBundle(bundle: SessionBundle): Promise<void>;
  resolveTodoSessionKeyForBundle(bundle: SessionBundle): string;
  setLastRuntimeError(error: string): void;
  scheduleSessionExtensionWarmup(event: HostExtensionEvent): void;
  buildSnapshot(): DesktopSnapshot;
  clearSubagentViewerTarget(): void;
  runSessionEndForBundle?(
    bundle: SessionBundle,
    reason: SessionEndHookInput['reason'],
  ): Promise<void>;
  runSessionStartForBundle?(
    bundle: SessionBundle,
    source: SessionStartHookInput['source'],
  ): Promise<void>;
}

export async function resetSessionCommand(ctx: SessionActivationContext): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    ctx.clearSubagentViewerTarget();

    const state = ctx.requireState();
    const leaving = ctx.sessionRegistry().getActive();
    const leavingMessageCount = leaving?.messageTimeline.toMessages().length ?? 0;
    if (leaving?.activeSession && leavingMessageCount > 0) {
      await ctx.runSessionEndForBundle?.(leaving, 'switch');
      await ctx.persistSessionBundle(leaving, {
        fromRuntime: ctx.sessionRegistry().activeSessionId() === leaving.id ? ctx.currentRuntime() : undefined,
        bumpListSortAt: false,
      });
    }
    const bundle = ctx.sessionRegistry().beginNewActive(state.workspaceRoot);
    await ctx.finalizeTodoScopeForNewActiveBundle(bundle, state.workspaceRoot);
    ctx.resetStreamingPlacementState(true, bundle);
    await finishSessionActivationCommand(ctx, bundle, { sessionStartSource: 'startup' });
    ctx.setLastRuntimeError('');
    ctx.scheduleSessionExtensionWarmup({
      type: 'onSessionReset',
      detail: {
        workspaceRoot: state.workspaceRoot,
      },
    });
    return ctx.buildSnapshot();
  });
}

export async function openSessionCommand(
  ctx: SessionActivationContext,
  filePath: string,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    ctx.clearSubagentViewerTarget();

    const leaving = ctx.sessionRegistry().getActive();
    const leavingMessageCount = leaving?.messageTimeline.toMessages().length ?? 0;
    if (
      leaving?.activeSession
      && leaving.activeSession.kind !== 'ephemeral'
      && leavingMessageCount > 0
    ) {
      cancelPendingWorktreeBootstrapOnBundle(leaving);
      await ctx.runSessionEndForBundle?.(leaving, 'switch');
      await ctx.persistSessionBundle(leaving, {
        fromRuntime:
          leaving.runtime?.isBusy() && ctx.sessionRegistry().activeSessionId() === leaving.id
            ? ctx.currentRuntime()
            : undefined,
        bumpListSortAt: false,
      });
    }

    if (isEphemeralDebugSessionPath(filePath)) {
      const ephemeral = ctx.findEphemeralSession(filePath);
      if (!ephemeral) {
        throw new Error(i18n.t('error.ephemeralSessionExpired'));
      }
      const ephemeralSameWorkspace = Boolean(
        ctx.isInitialized()
        && ctx.currentWorkspaceRoot()
        && sameWorkspaceRoot(ctx.currentWorkspaceRoot()!, ephemeral.workspaceRoot),
      );
      await ctx.ensureInitialized(ephemeral.workspaceRoot, {
        preserveRecentWorkspaces: true,
        ...(ephemeralSameWorkspace ? { fastPath: true } : { deferRuntimeRefresh: true }),
      });
      const restored = restoreEphemeralSessionState(ephemeral);
      const bundle = ctx.sessionRegistry().upsertFromRestored(
        ephemeral.workspaceRoot,
        restored,
        (messages, timelineSnapshot) => ctx.createMessageTimelineFromMessages(messages, timelineSnapshot),
      );
      await finishSessionActivationCommand(ctx, bundle, { sessionStartSource: 'open' });
      ctx.setLastRuntimeError('');
      return ctx.buildSnapshot();
    }

    const resolvedPath = path.resolve(filePath);
    const warmBundle = ctx.sessionRegistry().findBySessionPath(resolvedPath);
    const warmMessageCount = warmBundle?.messageTimeline.toMessages().length ?? 0;
    if (warmBundle?.activeSession && warmMessageCount > 0) {
      await ctx.ensureInitialized(warmBundle.workspaceRoot, { fastPath: true });
      ctx.sessionRegistry().activateExisting(warmBundle);
      await finishSessionActivationCommand(ctx, warmBundle, { sessionStartSource: 'resume' });
      ctx.setLastRuntimeError('');
      ctx.scheduleSessionExtensionWarmup({
        type: 'onSessionOpened',
        detail: {
          filePath: resolvedPath,
          displayName: warmBundle.activeSession.displayName,
        },
      });
      return ctx.buildSnapshot();
    }

    const loaded = await loadStoredSession(filePath);
    const workspaceRoot = loaded.workspaceRoot
      ? await resolveStoredSessionWorkspaceRoot({
          workspaceRoot: loaded.workspaceRoot,
          gitBranch: loaded.gitBranch,
        })
      : ctx.requireState().workspaceRoot;
    const sameWorkspace =
      ctx.isInitialized()
      && Boolean(ctx.currentWorkspaceRoot())
      && sameWorkspaceRoot(ctx.currentWorkspaceRoot()!, workspaceRoot);
    await ctx.ensureInitialized(workspaceRoot, {
      ...(sameWorkspace ? { fastPath: true } : { deferRuntimeRefresh: true }),
      preserveRecentWorkspaces: true,
    });
    const restored = restoreStoredSessionState({
      filePath,
      loaded,
      fallbackMessages: restoreMessagesFromArchive(loaded),
    });
    const bundle = ctx.sessionRegistry().upsertFromRestored(
      workspaceRoot,
      restored,
      (messages, timelineSnapshot) => ctx.createMessageTimelineFromMessages(messages, timelineSnapshot),
    );
    bundle.listSortSavedAtUnixMs = loaded.savedAtUnixMs;
    const sessionStartSource: SessionStartHookInput['source'] =
      restored.messages.length > 0 || restored.archiveHistory.length > 0 ? 'resume' : 'open';
    await finishSessionActivationCommand(ctx, bundle, { sessionStartSource });
    ctx.setLastRuntimeError('');
    ctx.scheduleSessionExtensionWarmup({
      type: 'onSessionOpened',
      detail: {
        filePath: path.resolve(filePath),
        displayName: bundle.activeSession!.displayName,
      },
    });
    return ctx.buildSnapshot();
  });
}

export function runtimeActivationSignature(
  ctx: SessionActivationContext,
  bundle: SessionBundle,
): string {
  const state = ctx.requireState();
  return JSON.stringify({
    model: state.config.activeModel,
    imageModel: state.config.imageGenerationModel ?? '',
    apiBase: currentApiBase(state.config),
    workspaceRoot: bundle.workspaceRoot || state.workspaceRoot,
    agentMode: resolveDesktopAgentMode(state.config),
    approvalLevel: bundle.approvalLevel,
    loopEnabled: bundle.loopEnabled,
    todoSessionKey: ctx.resolveTodoSessionKeyForBundle(bundle),
  });
}

export function isBundleRuntimeFresh(
  ctx: SessionActivationContext,
  bundle: SessionBundle,
): boolean {
  if (!bundle.runtime || bundle.runtime.isBusy() || !bundle.runtimeTransport) {
    return false;
  }
  if (!bundle.runtimeActivationSignature) {
    return false;
  }
  return bundle.runtimeActivationSignature === runtimeActivationSignature(ctx, bundle);
}

/** After registry switch: wire runtime for new loads, resume in-flight runs without resetting timeline. */
export async function finishSessionActivationCommand(
  ctx: SessionActivationContext,
  bundle: SessionBundle,
  options?: { sessionStartSource?: SessionStartHookInput['source'] },
): Promise<void> {
  const adoptedWorkspaceRoot = await ctx.syncHostWorkspaceRootToActiveBundle(bundle);
  if (!adoptedWorkspaceRoot) {
    await ctx.syncPlanStateForBundle(bundle);
  }
  if (bundle.runtime?.isBusy()) {
    await ctx.tickSession(bundle);
    ctx.syncActiveRuntimePointer();
    return;
  }
  ctx.resetStreamingPlacementState(true, bundle);
  if (isBundleRuntimeFresh(ctx, bundle)) {
    await ctx.refreshTodoSnapshotForBundle(bundle);
    await ctx.flushDeferredRuntimeRefreshIfIdle(bundle);
    ctx.syncActiveRuntimePointer();
    if (options?.sessionStartSource) {
      await ctx.runSessionStartForBundle?.(bundle, options.sessionStartSource);
    }
    return;
  }
  await ctx.ensureToolExecutor(bundle);
  await ctx.refreshTodoSnapshotForBundle(bundle);
  await ctx.refreshRuntimeForBundle(bundle);
  await ctx.flushDeferredRuntimeRefreshIfIdle(bundle);
  ctx.syncActiveRuntimePointer();
  if (options?.sessionStartSource) {
    await ctx.runSessionStartForBundle?.(bundle, options.sessionStartSource);
  }
}
