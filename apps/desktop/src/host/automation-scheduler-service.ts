import {
  automationTimeScheduleFromTrigger,
  baselineGitHubAutomationWatermark,
  computeGitHubPollMatchesForRepoGroup,
  createHostAutomationStore,
  fetchGitHubAutomationRepoItems,
  githubTriggerNeedsBaseline,
  groupGitHubAutomationsByRepo,
  resolveGitHubPollWatermark,
  shouldFireNow,
  type AutomationRunTriggerContext,
  type HostAutomationDefinition,
} from '@spirit-agent/host-internal';

import { cloneDesktopConfig } from './service-utils.js';
import { loadGitHubAccessToken } from './github-auth-storage.js';
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

  try {
    await tickGitHubAutomationTriggers(ctx, store, definitions, config);
  } catch {
    /* GitHub poll failures must not block time triggers in the same tick. */
  }
  await tickTimeAutomationTriggers(ctx, store, definitions, config, now);
}

async function tickTimeAutomationTriggers(
  ctx: AutomationSchedulerServiceContext,
  store: ReturnType<typeof createHostAutomationStore>,
  definitions: HostAutomationDefinition[],
  config: DesktopConfigFile,
  now: number,
): Promise<void> {
  for (const definition of definitions) {
    if (definition.trigger.kind !== 'time') {
      continue;
    }
    if (ctx.runningAutomationIds().has(definition.id)) {
      continue;
    }
    const activeRun = await store.getActiveRun(definition.id);
    if (activeRun) {
      continue;
    }
    const schedule = automationTimeScheduleFromTrigger(definition.trigger);
    if (!schedule || !shouldFireNow(schedule, definition.lastFiredAtUnixMs, now)) {
      continue;
    }

    void launchAutomationRun(ctx, store, {
      definition,
      config,
      context: { kind: 'time' },
      markFiredAtUnixMs: now,
    });
  }
}

async function tickGitHubAutomationTriggers(
  ctx: AutomationSchedulerServiceContext,
  store: ReturnType<typeof createHostAutomationStore>,
  definitions: HostAutomationDefinition[],
  config: DesktopConfigFile,
): Promise<void> {
  const githubDefinitions = definitions.filter((definition) => definition.trigger.kind === 'github');
  if (githubDefinitions.length === 0) {
    return;
  }

  const accessToken = await loadGitHubAccessToken();
  if (!accessToken) {
    return;
  }

  for (const definition of githubDefinitions) {
    if (!githubTriggerNeedsBaseline(definition.trigger)) {
      continue;
    }
    if (definition.trigger.kind !== 'github') {
      continue;
    }
    try {
      const lastSeenNumber = await baselineGitHubAutomationWatermark(
        accessToken,
        definition.trigger.owner,
        definition.trigger.repo,
      );
      await store.ensureGitHubTriggerBaseline(definition.id, lastSeenNumber);
    } catch {
      /* Skip baseline for this automation; do not abort the rest of the tick. */
    }
  }

  const refreshed = await store.listEnabledDefinitions();
  const groups = groupGitHubAutomationsByRepo(
    refreshed.filter((definition) => definition.trigger.kind === 'github'),
  );

  for (const group of groups) {
    const minWatermark = Math.min(
      ...group.automations.map((definition) =>
        definition.trigger.kind === 'github'
          ? resolveGitHubPollWatermark(definition.trigger)
          : Number.MAX_SAFE_INTEGER,
      ),
    );
    let items;
    try {
      items = await fetchGitHubAutomationRepoItems(accessToken, group.owner, group.repo, {
        sinceNumber: Number.isFinite(minWatermark) ? minWatermark : 0,
      });
    } catch {
      continue;
    }

    const matches = computeGitHubPollMatchesForRepoGroup(group, items);
    for (const match of matches) {
      if (ctx.runningAutomationIds().has(match.automationId)) {
        continue;
      }
      const activeRun = await store.getActiveRun(match.automationId);
      if (activeRun) {
        continue;
      }
      const latestDefinition = refreshed.find((definition) => definition.id === match.automationId);
      if (!latestDefinition || latestDefinition.trigger.kind !== 'github') {
        continue;
      }

      await store.updateGitHubPollState(match.automationId, match.item.number);

      launchAutomationRun(ctx, store, {
        definition: latestDefinition,
        config,
        context: {
          kind: 'github',
          event: latestDefinition.trigger.event,
          eventUrl: match.item.htmlUrl,
        },
        advanceGitHubPollOnSuccess: match.item.number,
      });
    }
  }
}

function launchAutomationRun(
  ctx: AutomationSchedulerServiceContext,
  store: ReturnType<typeof createHostAutomationStore>,
  input: {
    definition: HostAutomationDefinition;
    config: DesktopConfigFile;
    context: AutomationRunTriggerContext;
    markFiredAtUnixMs?: number;
    advanceGitHubPollOnSuccess?: number;
  },
): void {
  ctx.markAutomationRunning(input.definition.id, true);
  void runDesktopAutomationOnce(
    {
      definition: input.definition,
      config: cloneDesktopConfig(input.config),
      triggerContext: input.context,
    },
    {
      onRunUpdated: (automationId) => ctx.onAutomationUpdated(automationId),
      notifySessionListUpdated: () => ctx.notifySessionListUpdated(),
      syncSessionFromDisk: (sessionPath) => ctx.syncSessionFromDisk?.(sessionPath),
    },
  )
    .then(async (run) => {
      if (run?.status === 'completed' && input.advanceGitHubPollOnSuccess !== undefined) {
        await store.updateGitHubPollState(input.definition.id, input.advanceGitHubPollOnSuccess);
      }
      if (run && input.markFiredAtUnixMs !== undefined) {
        await store.markFired(input.definition.id, input.markFiredAtUnixMs);
      }
    })
    .catch(() => {
      /* run status persisted in store */
    })
    .finally(() => {
      ctx.markAutomationRunning(input.definition.id, false);
      ctx.onAutomationUpdated(input.definition.id);
    });
}

export function automationDefinitionNeedsApiKey(
  definition: HostAutomationDefinition,
  config: DesktopConfigFile,
): boolean {
  return config.models.some((model) => model.name === definition.modelName);
}
