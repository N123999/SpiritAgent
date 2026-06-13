import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendPullRequestChecksPages,
  createExpectedRequiredCheck,
  mapGraphQLCheckRunNode,
  mapGraphQLStatusContextNode,
  mergeRequiredStatusChecks,
} from './pull-request-checks-graphql.js';

test('mapGraphQLCheckRunNode maps success and in-progress check runs', () => {
  assert.deepEqual(
    mapGraphQLCheckRunNode({
      __typename: 'CheckRun',
      databaseId: 101,
      name: 'build',
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
      startedAt: '2026-06-01T12:00:00Z',
      completedAt: '2026-06-01T12:02:30Z',
      detailsUrl: 'https://github.com/octocat/Hello-World/runs/101',
      isRequired: true,
    }),
    {
      id: 'run:101',
      name: 'build',
      state: 'success',
      startedAt: '2026-06-01T12:00:00Z',
      completedAt: '2026-06-01T12:02:30Z',
      url: 'https://github.com/octocat/Hello-World/runs/101',
      required: true,
    },
  );

  assert.equal(
    mapGraphQLCheckRunNode({
      __typename: 'CheckRun',
      databaseId: 102,
      name: 'lint',
      status: 'IN_PROGRESS',
      conclusion: null,
      startedAt: '2026-06-01T12:00:00Z',
      isRequired: false,
    })?.state,
    'in_progress',
  );
});

test('mapGraphQLStatusContextNode maps legacy status contexts', () => {
  assert.deepEqual(
    mapGraphQLStatusContextNode({
      __typename: 'StatusContext',
      context: 'ci/travis',
      state: 'SUCCESS',
      createdAt: '2026-06-01T11:00:00Z',
      updatedAt: '2026-06-01T11:05:00Z',
      targetUrl: 'https://travis-ci.org/octocat/Hello-World/builds/1',
      isRequired: true,
    }),
    {
      id: 'status:ci/travis',
      name: 'ci/travis',
      state: 'success',
      startedAt: '2026-06-01T11:00:00Z',
      completedAt: '2026-06-01T11:05:00Z',
      url: 'https://travis-ci.org/octocat/Hello-World/builds/1',
      required: true,
    },
  );

  assert.equal(
    mapGraphQLStatusContextNode({
      __typename: 'StatusContext',
      context: 'ci/jenkins',
      state: 'PENDING',
      createdAt: '2026-06-01T11:00:00Z',
    })?.state,
    'in_progress',
  );
});

test('mergeRequiredStatusChecks adds pending placeholders for missing required contexts', () => {
  const merged = mergeRequiredStatusChecks(
    [
      {
        id: 'run:1',
        name: 'Dependencies Check',
        state: 'success',
        startedAt: '2026-06-01T12:00:00Z',
        required: true,
      },
      {
        id: 'status:license/cla',
        name: 'license/cla',
        state: 'success',
        startedAt: '2026-06-01T12:00:00Z',
      },
    ],
    ['Dependencies Check', 'Linux / CLI', 'Windows / Electron'],
  );

  assert.deepEqual(
    merged.map((check) => ({ name: check.name, state: check.state, required: check.required ?? false })),
    [
      { name: 'Linux / CLI', state: 'pending', required: true },
      { name: 'Windows / Electron', state: 'pending', required: true },
      { name: 'Dependencies Check', state: 'success', required: true },
      { name: 'license/cla', state: 'success', required: false },
    ],
  );
});

test('appendPullRequestChecksPages merges checks by name', () => {
  const merged = appendPullRequestChecksPages(
    [
      {
        id: 'run:1',
        name: 'build',
        state: 'success',
        startedAt: '2026-06-01T12:00:00Z',
      },
      {
        id: 'expected:lint',
        name: 'lint',
        state: 'pending',
        startedAt: new Date(0).toISOString(),
        required: true,
      },
    ],
    [
      {
        id: 'run:2',
        name: 'test',
        state: 'in_progress',
        startedAt: '2026-06-01T12:10:00Z',
      },
    ],
  );

  assert.equal(merged.length, 3);
  assert.deepEqual(
    merged.map((check) => check.name),
    ['lint', 'test', 'build'],
  );
});

test('createExpectedRequiredCheck uses stable pending placeholder id', () => {
  assert.deepEqual(createExpectedRequiredCheck('Linux / Browser'), {
    id: 'expected:Linux / Browser',
    name: 'Linux / Browser',
    state: 'pending',
    startedAt: new Date(0).toISOString(),
    required: true,
  });
});
