import {
  createHostAutomationStore,
  shouldFireNow,
  type HostAutomationDefinition,
} from '@spirit-agent/host-internal';

import { cloneDesktopConfig } from './service-utils.js';
import { spiritAgentDataDir, type DesktopConfigFile } from './storage.js';
import { runDesktopAutomationOnce } from './automation-runner.js';

export const AUTOMATION_SCHEDULER_MONITOR_INTERVAL_MS = 60_000;

export interface AutomationSchedulerServiceContext {
  initialized(): boolean;
  config(): DesktopConfigFile | undefined;
  runningAutomationIds(): ReadonlySet<string>;
  markAutomationRunning(automationId: string, running: boolean): void;
  onAutomationUpdated(automationId: string): void;
  notifySessionListUpdated(): void;
  syncSessionFromDisk?(sessionPath: string): void | Promise<void>;
}

export function startAutomationSchedulerMonitorIfNeeded(
  currentTimer: ReturnType<typeof setInterval> | undefined,
  setTimer: (timer: ReturnType<typeof setInterval>) => void,
  ctx: AutomationSchedulerServiceContext,
): void {
  if (currentTimer) {
    return;
  }

  const timer = setInterval(() => {
    void tickAutomationScheduler(ctx);
  }, AUTOMATION_SCHEDULER_MONITOR_INTERVAL_MS);
  timer.unref?.();
  setTimer(timer);
  void tickAutomationScheduler(ctx);
}

export async function tickAutomationScheduler(ctx: AutomationSchedulerServiceContext): Promise<void> {
  if (!ctx.initialized()) {
    return;
  }

  const config = ctx.config();
  if (!config) {
    return;
  }

  const store = createHostAutomationStore(spiritAgentDataDir());
  const definitions = await store.listEnabledDefinitions();
  const now = Date.now();

  for (const definition of definitions) {
    if (ctx.runningAutomationIds().has(definition.id)) {
      continue;
    }
    const activeRun = await store.getActiveRun(definition.id);
    if (activeRun) {
      continue;
    }
    if (!shouldFireNow(definition.schedule, definition.lastFiredAtUnixMs, now)) {
      continue;
    }

    ctx.markAutomationRunning(definition.id, true);
    void runDesktopAutomationOnce(
      {
        definition,
        config: cloneDesktopConfig(config),
      },
      {
        onRunUpdated: (automationId) => ctx.onAutomationUpdated(automationId),
        notifySessionListUpdated: () => ctx.notifySessionListUpdated(),
        syncSessionFromDisk: (sessionPath) => ctx.syncSessionFromDisk?.(sessionPath),
      },
    )
      .then(async () => {
        await store.markFired(definition.id, now);
      })
      .catch(() => {
        /* run status persisted in store */
      })
      .finally(() => {
        ctx.markAutomationRunning(definition.id, false);
        ctx.onAutomationUpdated(definition.id);
      });
  }
}

export function automationDefinitionNeedsApiKey(
  definition: HostAutomationDefinition,
  config: DesktopConfigFile,
): boolean {
  return config.models.some((model) => model.name === definition.modelName);
}
