import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  computeNextRunAt,
  createHostAutomationStore,
  formatScheduleLabel,
  shouldFireNow,
} from './automations.js';

test('automation store create list get update delete', async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), 'spirit-host-automations-'));

  try {
    const store = createHostAutomationStore(spiritDataDir);
    const created = await store.create({
      title: 'GitHub 日报',
      overview: '收集 GitHub 新闻',
      schedule: { kind: 'daily', hour: 20, minute: 0 },
      workspaceRoot: spiritDataDir,
      modelName: 'gpt-test',
      approvalLevel: 'default',
    });
    assert.equal(created.enabled, true);
    assert.equal(created.schedule.kind, 'daily');

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
      schedule: { kind: 'hourly' },
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

    const loaded = await store.get(created.id);
    assert.equal(loaded?.runs[0]?.status, 'completed');
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
