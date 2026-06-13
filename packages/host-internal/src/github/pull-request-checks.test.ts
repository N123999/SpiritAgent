import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mapCheckRun,
  mapCommitStatus,
  mapPullRequestChecks,
  mergePullRequestChecks,
} from './pull-request-checks.js';

test('mapCheckRun maps success check run', () => {
  const check = mapCheckRun({
    id: 101,
    name: 'build',
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-06-01T12:00:00Z',
    completed_at: '2026-06-01T12:02:30Z',
    html_url: 'https://github.com/octocat/Hello-World/runs/101',
  });

  assert.deepEqual(check, {
    id: 'run:101',
    name: 'build',
    state: 'success',
    startedAt: '2026-06-01T12:00:00Z',
    completedAt: '2026-06-01T12:02:30Z',
    url: 'https://github.com/octocat/Hello-World/runs/101',
  });
});

test('mapCheckRun maps failure and in-progress check runs', () => {
  assert.equal(
    mapCheckRun({
      id: 102,
      name: 'lint',
      status: 'completed',
      conclusion: 'failure',
      started_at: '2026-06-01T12:00:00Z',
      completed_at: '2026-06-01T12:01:00Z',
    })?.state,
    'failure',
  );

  assert.equal(
    mapCheckRun({
      id: 103,
      name: 'test',
      status: 'in_progress',
      conclusion: null,
      started_at: '2026-06-01T12:00:00Z',
    })?.state,
    'in_progress',
  );

  assert.equal(
    mapCheckRun({
      id: 104,
      name: 'deploy',
      status: 'queued',
      conclusion: null,
      started_at: '2026-06-01T12:00:00Z',
    })?.state,
    'in_progress',
  );
});

test('mapCheckRun falls back started_at to completed_at and epoch', () => {
  assert.equal(
    mapCheckRun({
      id: 105,
      name: 'build',
      status: 'completed',
      conclusion: 'success',
      completed_at: '2026-06-01T12:01:00Z',
    })?.startedAt,
    '2026-06-01T12:01:00Z',
  );

  assert.equal(
    mapCheckRun({
      id: 106,
      name: 'build',
      status: 'completed',
      conclusion: 'success',
    })?.startedAt,
    new Date(0).toISOString(),
  );
});

test('mapCommitStatus maps legacy commit statuses', () => {
  assert.deepEqual(
    mapCommitStatus({
      id: 1,
      context: 'ci/travis',
      state: 'success',
      created_at: '2026-06-01T11:00:00Z',
      updated_at: '2026-06-01T11:05:00Z',
      target_url: 'https://travis-ci.org/octocat/Hello-World/builds/1',
    }),
    {
      id: 'status:1',
      name: 'ci/travis',
      state: 'success',
      startedAt: '2026-06-01T11:00:00Z',
      completedAt: '2026-06-01T11:05:00Z',
      url: 'https://travis-ci.org/octocat/Hello-World/builds/1',
    },
  );

  assert.equal(
    mapCommitStatus({
      id: 2,
      context: 'ci/circle',
      state: 'failure',
      created_at: '2026-06-01T11:00:00Z',
      updated_at: '2026-06-01T11:05:00Z',
    })?.state,
    'failure',
  );

  assert.equal(
    mapCommitStatus({
      id: 3,
      context: 'ci/jenkins',
      state: 'pending',
      created_at: '2026-06-01T11:00:00Z',
    })?.state,
    'in_progress',
  );
});

test('mergePullRequestChecks prefers check runs over legacy statuses with same name', () => {
  const merged = mergePullRequestChecks(
    [
      {
        id: 'run:10',
        name: 'build',
        state: 'success',
        startedAt: '2026-06-01T12:00:00Z',
        completedAt: '2026-06-01T12:02:00Z',
      },
    ],
    [
      {
        id: 'status:1',
        name: 'build',
        state: 'failure',
        startedAt: '2026-06-01T11:00:00Z',
        completedAt: '2026-06-01T11:05:00Z',
      },
    ],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, 'run:10');
  assert.equal(merged[0]?.state, 'success');
});

test('mapPullRequestChecks sorts in_progress before failure before success', () => {
  const checks = mapPullRequestChecks(
    [
      {
        id: 1,
        name: 'done',
        status: 'completed',
        conclusion: 'success',
        started_at: '2026-06-01T12:00:00Z',
      },
      {
        id: 2,
        name: 'running',
        status: 'in_progress',
        started_at: '2026-06-01T12:10:00Z',
      },
      {
        id: 3,
        name: 'failed',
        status: 'completed',
        conclusion: 'failure',
        started_at: '2026-06-01T12:05:00Z',
      },
    ],
    [],
  );

  assert.deepEqual(
    checks.map((check) => check.name),
    ['running', 'failed', 'done'],
  );
});

test('mapPullRequestChecks returns empty list for empty input', () => {
  assert.deepEqual(mapPullRequestChecks([], []), []);
});
