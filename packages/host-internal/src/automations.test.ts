import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  computeNextRunAt,
  createHostAutomationStore,
  formatScheduleLabel,
  formatTriggerLabel,
  normalizeAutomationTrigger,
  shouldFireNow,
} from './automations.js';

test('automation store create list get update delete', async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), 'spirit-host-automations-'));

  try {
    const store = createHostAutomationStore(spiritDataDir);
    const created = await store.create({
      title: 'GitHub 日报',
      overview: '收集 GitHub 新闻',
      trigger: { kind: 'time', schedule: { kind: 'daily', hour: 20, minute: 0 } },
      workspaceRoot: spiritDataDir,
      modelName: 'gpt-test',
      approvalLevel: 'default',
    });
    assert.equal(created.enabled, true);
    assert.equal(created.trigger.kind, 'time');

    const summaries = await store.listSummaries();
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.title, 'GitHub 日报');
    assert.equal(summaries[0]?.scheduleLabel, '每天 20:00');

    const loaded = await store.get(created.id);
    assert.ok(loaded);
    assert.equal(loaded!.runs.length, 0);

    const updated = await store.update(created.id, { enabled: false, title: 'Renamed' });
    assert.equal(updated.enabled, false);
    assert.equal(updated.title, 'Renamed');

    await store.delete(created.id);
    assert.equal((await store.listSummaries()).length, 0);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test('automation store tracks runs and active run', async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), 'spirit-host-automations-runs-'));

  try {
    const store = createHostAutomationStore(spiritDataDir);
    const created = await store.create({
      title: 'Hourly task',
      overview: 'Do work',
      trigger: { kind: 'time', schedule: { kind: 'hourly' } },
      workspaceRoot: spiritDataDir,
      modelName: 'gpt-test',
      approvalLevel: 'full-approval',
    });

    const run = await store.addRun(created.id, {
      id: 'run-1',
      automationId: created.id,
      sessionPath: '/tmp/session.json',
      status: 'running',
      startedAtUnixMs: Date.now(),
    });
    assert.equal(run.status, 'running');
    assert.ok(await store.getActiveRun(created.id));

    await store.updateRun(created.id, run.id, {
      status: 'completed',
      completedAtUnixMs: Date.now(),
    });
    assert.equal((await store.getActiveRun(created.id)), undefined);

    const blockedRun = await store.addRun(created.id, {
      id: 'run-2',
      automationId: created.id,
      sessionPath: '/tmp/session-2.json',
      status: 'blocked',
      startedAtUnixMs: Date.now(),
    });
    assert.equal(blockedRun.status, 'blocked');
    assert.equal((await store.getActiveRun(created.id)), undefined);

    const loaded = await store.get(created.id);
    assert.equal(loaded?.runs[0]?.status, 'completed');
    assert.equal(loaded?.runs[1]?.status, 'blocked');
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test('shouldFireNow respects schedule and last fired bucket', () => {
  const dailyAtEight = { kind: 'daily' as const, hour: 8, minute: 30 };
  const eightThirty = Date.parse('2026-06-08T08:30:00');
  assert.equal(shouldFireNow(dailyAtEight, undefined, eightThirty), true);
  assert.equal(shouldFireNow(dailyAtEight, eightThirty, eightThirty), false);
  assert.equal(shouldFireNow(dailyAtEight, undefined, eightThirty + 60_000), false);

  const hourly = { kind: 'hourly' as const };
  const topOfHour = Date.parse('2026-06-08T09:00:00');
  assert.equal(shouldFireNow(hourly, undefined, topOfHour), true);
  assert.equal(shouldFireNow(hourly, undefined, topOfHour + 5 * 60_000), false);
});

test('computeNextRunAt advances schedule', () => {
  const after = Date.parse('2026-06-08T08:31:00');
  const daily = { kind: 'daily' as const, hour: 8, minute: 30 };
  assert.equal(
    computeNextRunAt(daily, after),
    Date.parse('2026-06-09T08:30:00'),
  );

  const weekly = { kind: 'weekly' as const, weekday: 1 as const, hour: 9, minute: 0 };
  const mondayNine = Date.parse('2026-06-08T09:00:00');
  assert.equal(computeNextRunAt(weekly, mondayNine), Date.parse('2026-06-15T09:00:00'));
});

test('formatScheduleLabel renders weekly label', () => {
  assert.equal(
    formatScheduleLabel({ kind: 'weekly', weekday: 1, hour: 9, minute: 0 }),
    '每周一 09:00',
  );
  assert.equal(formatScheduleLabel({ kind: 'hourly' }), '每小时');
});

test('formatTriggerLabel renders GitHub trigger', () => {
  assert.equal(
    formatTriggerLabel({
      kind: 'github',
      owner: 'spirit',
      repo: 'agent',
      event: 'pull_request_created',
    }),
    'GitHub · spirit/agent · PR created',
  );
});

test('normalizeAutomationTrigger accepts legacy bare schedule', () => {
  assert.deepEqual(normalizeAutomationTrigger({ kind: 'daily', hour: 9, minute: 0 }), {
    kind: 'time',
    schedule: { kind: 'daily', hour: 9, minute: 0 },
  });
});

test('automation store migrates legacy schedule field on load', async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), 'spirit-host-automations-legacy-'));
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { automationsDirPath } = await import('./automations.js');

  try {
    const automationId = '00000000-0000-4000-8000-000000000001';
    const dir = automationsDirPath(spiritDataDir);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, `${automationId}.json`),
      `${JSON.stringify({
        version: 1,
        definition: {
          id: automationId,
          title: 'Legacy',
          overview: 'Legacy overview',
          schedule: { kind: 'hourly' },
          workspaceRoot: spiritDataDir,
          modelName: 'gpt-test',
          approvalLevel: 'default',
          enabled: true,
          createdAtUnixMs: 1,
          updatedAtUnixMs: 1,
        },
        runs: [],
      }, null, 2)}\n`,
      'utf8',
    );

    const store = createHostAutomationStore(spiritDataDir);
    const loaded = await store.get(automationId);
    assert.ok(loaded);
    assert.deepEqual(loaded!.definition.trigger, { kind: 'time', schedule: { kind: 'hourly' } });
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});
