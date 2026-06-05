import {
  buildDreamCollectorSystemMessage,
  type LlmPlanMetadata,
  type LlmTransportConfig,
} from '@spirit-agent/agent-core';

import i18n from '../lib/i18n-host.js';
import type {
  DesktopDreamCollectorSnapshot,
  DesktopGitSnapshot,
} from '../types.js';
import type { DesktopConfigFile, HostMetadataSummary } from './storage.js';
import type { DesktopRuntime } from './runtime.js';
import type { DesktopToolExecutor } from './tool-executor.js';
import {
  buildDreamCollectorPlanMetadata,
  DREAM_COLLECTOR_BACKOFF_MS,
  DREAM_COLLECTOR_MONITOR_INTERVAL_MS,
  DREAM_COLLECTOR_TICK_INTERVAL_MS,
  emptyDreamCollectorSnapshot,
  runDesktopDreamCollectorOnce,
} from './dreams.js';
import { resolveLightweightChatModelProfile } from './lightweight-chat-model.js';
import { cloneDesktopConfig } from './service-utils.js';

interface DreamCollectorState {
  workspaceRoot: string;
  git: DesktopGitSnapshot;
  config: DesktopConfigFile;
  metadata: HostMetadataSummary;
}

export interface DreamCollectorServiceContext {
  state(): DreamCollectorState | undefined;
  initialized(): boolean;
  runtimeBusy(): boolean;
  running(): boolean;
  setRunning(running: boolean): void;
  lastTickUnixMs(): number;
  setLastTickUnixMs(value: number): void;
  status(): DesktopDreamCollectorSnapshot;
  setStatus(next: DesktopDreamCollectorSnapshot): void;
  createRuntime(
    transportConfig: LlmTransportConfig,
    planMetadata: LlmPlanMetadata,
    toolExecutor: DesktopToolExecutor,
  ): DesktopRuntime;
  runSerialized<T>(work: () => Promise<T>): Promise<T>;
  activeBundle(): { deferredRuntimeRefreshWhileBusy: boolean };
  refreshRuntime(): Promise<void>;
  clearLastRuntimeError(): void;
}

export function startDreamCollectorIfNeeded(ctx: DreamCollectorServiceContext): void {
  const state = ctx.state();
  if (!state) {
    return;
  }

  const settings = state.config.dreams;
  const now = Date.now();
  if (!settings.enabled) {
    ctx.setStatus(emptyDreamCollectorSnapshot('disabled'));
    return;
  }
  const lightweightModel = resolveLightweightChatModelProfile(state.config);
  if (!lightweightModel) {
    ctx.setStatus({
      ...emptyDreamCollectorSnapshot('missing-model'),
      lastError: i18n.t('error.lightweightChatModelNotConfigured'),
    });
    return;
  }
  if (!state.git.isRepository || !state.git.branch) {
    ctx.setStatus(emptyDreamCollectorSnapshot('idle'));
    return;
  }
  if (ctx.runtimeBusy() || ctx.running()) {
    return;
  }
  const backoffUntilUnixMs = ctx.status().backoffUntilUnixMs;
  if (backoffUntilUnixMs !== undefined && now < backoffUntilUnixMs) {
    ctx.setStatus({
      ...ctx.status(),
      state: 'backoff',
    });
    return;
  }
  if (now - ctx.lastTickUnixMs() < DREAM_COLLECTOR_TICK_INTERVAL_MS) {
    return;
  }

  ctx.setLastTickUnixMs(now);
  ctx.setRunning(true);
  ctx.setStatus({
    ...ctx.status(),
    state: 'running',
    lastRunAtUnixMs: now,
    pendingCount: ctx.status().pendingCount,
    processedCount: ctx.status().processedCount,
  });

  const collectorInput = {
    workspaceRoot: state.workspaceRoot,
    gitBranch: state.git.branch,
    collectorModel: lightweightModel.name,
    config: cloneDesktopConfig(state.config),
    planMetadata: buildDreamCollectorPlanMetadata(state.metadata.planMetadata),
  };

  void runDesktopDreamCollectorOnce(collectorInput, {
    createRuntime: (transportConfig, planMetadata, toolExecutor) => ctx.createRuntime(
      transportConfig,
      planMetadata,
      toolExecutor,
    ),
    getStatus: () => ctx.status(),
    setStatus: (next) => ctx.setStatus(next),
  })
    .catch((error) => {
      const backoffUntilUnixMs = Date.now() + DREAM_COLLECTOR_BACKOFF_MS;
      ctx.setStatus({
        ...ctx.status(),
        state: 'backoff',
        lastError: error instanceof Error ? error.message : String(error),
        backoffUntilUnixMs,
      });
    })
    .finally(() => {
      ctx.setRunning(false);
      void ctx.runSerialized(async () => {
        if (!ctx.initialized() || !ctx.state()) {
          return;
        }
        if (ctx.runtimeBusy()) {
          ctx.activeBundle().deferredRuntimeRefreshWhileBusy = true;
          return;
        }
        ctx.activeBundle().deferredRuntimeRefreshWhileBusy = false;
        await ctx.refreshRuntime();
        ctx.clearLastRuntimeError();
      });
    });
}

export function startDreamCollectorMonitorIfNeeded(
  currentTimer: ReturnType<typeof setInterval> | undefined,
  setTimer: (timer: ReturnType<typeof setInterval>) => void,
  ctx: DreamCollectorServiceContext,
): void {
  if (currentTimer) {
    return;
  }

  const timer = setInterval(() => {
    void ctx.runSerialized(async () => {
      if (!ctx.initialized() || !ctx.state() || ctx.runtimeBusy()) {
        return;
      }
      startDreamCollectorIfNeeded(ctx);
    });
  }, DREAM_COLLECTOR_MONITOR_INTERVAL_MS);
  timer.unref?.();
  setTimer(timer);
}

export function createDreamCollectorRuntime(
  createRuntime: DreamCollectorServiceContext['createRuntime'],
): DreamCollectorServiceContext['createRuntime'] {
  return (transportConfig, planMetadata, toolExecutor) =>
    createRuntime(transportConfig, planMetadata, toolExecutor);
}

export function dreamCollectorExtensionPrompt() {
  return {
    extensionId: 'dream-collector',
    extensionName: i18n.t('error.dreamCollector'),
    content: buildDreamCollectorSystemMessage(),
  };
}
