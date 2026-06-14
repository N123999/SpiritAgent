import assert from 'node:assert/strict';
import test from 'node:test';

import {
  baselineGitHubAutomationWatermark,
  computeGitHubPollMatchesForAutomation,
  computeGitHubPollMatchesForRepoGroup,
  githubTriggerNeedsBaseline,
  groupGitHubAutomationsByRepo,
  mergeGitHubPollWatermarkUpdates,
} from './automation-poller.js';

const baseDefinition = {
  title: 'Test',
  overview: 'Do work',
  workspaceRoot: '/tmp',
  modelName: 'gpt-test',
  approvalLevel: 'default' as const,
  enabled: true,
  createdAtUnixMs: 1,
  updatedAtUnixMs: 1,
};

test('groupGitHubAutomationsByRepo deduplicates repo fetch targets', () => {
  const groups = groupGitHubAutomationsByRepo([
    {
      ...baseDefinition,
      id: 'a1',
      trigger: {
        kind: 'github',
        owner: 'o',
        repo: 'r',
        event: 'pull_request_created',
        poll: { lastSeenNumber: 1 },
      },
    },
    {
      ...baseDefinition,
      id: 'a2',
      trigger: {
        kind: 'github',
        owner: 'o',
        repo: 'r',
        event: 'issue_created',
        poll: { lastSeenNumber: 2 },
      },
    },
    {
      ...baseDefinition,
      id: 'a3',
      trigger: { kind: 'time', schedule: { kind: 'hourly' } },
    },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.automations.length, 2);
});

test('computeGitHubPollMatchesForAutomation avoids replaying historical items', () => {
  const definition = {
    ...baseDefinition,
    id: 'a1',
    trigger: {
      kind: 'github' as const,
      owner: 'o',
      repo: 'r',
      event: 'pull_request_created' as const,
      poll: { lastSeenNumber: 10 },
    },
  };
  const items = [
    { number: 9, htmlUrl: 'https://github.com/o/r/pull/9', isPullRequest: true, createdAt: '1' },
    { number: 11, htmlUrl: 'https://github.com/o/r/pull/11', isPullRequest: true, createdAt: '2' },
    { number: 12, htmlUrl: 'https://github.com/o/r/issues/12', isPullRequest: false, createdAt: '3' },
  ];
  const matches = computeGitHubPollMatchesForAutomation(definition, items);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.item.number, 11);
  assert.equal(matches[0]?.nextLastSeenNumber, 11);
});

test('computeGitHubPollMatchesForRepoGroup emits one match per new item', () => {
  const group = {
    repoKey: 'o/r',
    owner: 'o',
    repo: 'r',
    automations: [
      {
        ...baseDefinition,
        id: 'a1',
        trigger: {
          kind: 'github' as const,
          owner: 'o',
          repo: 'r',
          event: 'pull_request_created' as const,
          poll: { lastSeenNumber: 0 },
        },
      },
    ],
  };
  const items = [
    { number: 1, htmlUrl: 'https://github.com/o/r/pull/1', isPullRequest: true, createdAt: '1' },
    { number: 2, htmlUrl: 'https://github.com/o/r/pull/2', isPullRequest: true, createdAt: '2' },
  ];
  const matches = computeGitHubPollMatchesForRepoGroup(group, items);
  assert.deepEqual(matches.map((match) => match.item.number), [1, 2]);
});

test('mergeGitHubPollWatermarkUpdates keeps highest seen number per automation', () => {
  const updates = mergeGitHubPollWatermarkUpdates([
    {
      automationId: 'a1',
      definition: {
        ...baseDefinition,
        id: 'a1',
        trigger: { kind: 'github', owner: 'o', repo: 'r', event: 'pull_request_created' },
      },
      item: { number: 3, htmlUrl: 'u', isPullRequest: true, createdAt: '1' },
      nextLastSeenNumber: 3,
    },
    {
      automationId: 'a1',
      definition: {
        ...baseDefinition,
        id: 'a1',
        trigger: { kind: 'github', owner: 'o', repo: 'r', event: 'pull_request_created' },
      },
      item: { number: 5, htmlUrl: 'u2', isPullRequest: true, createdAt: '2' },
      nextLastSeenNumber: 5,
    },
  ]);
  assert.equal(updates.get('a1'), 5);
});

test('githubTriggerNeedsBaseline detects missing poll state', () => {
  assert.equal(
    githubTriggerNeedsBaseline({
      kind: 'github',
      owner: 'o',
      repo: 'r',
      event: 'issue_created',
    }),
    true,
  );
  assert.equal(
    githubTriggerNeedsBaseline({
      kind: 'github',
      owner: 'o',
      repo: 'r',
      event: 'issue_created',
      poll: { lastSeenNumber: 0 },
    }),
    false,
  );
});

test('baselineGitHubAutomationWatermark uses fetch helper', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify([{ number: 42, html_url: 'https://github.com/o/r/issues/42' }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  try {
    const watermark = await baselineGitHubAutomationWatermark('token', 'o', 'r');
    assert.equal(watermark, 42);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
