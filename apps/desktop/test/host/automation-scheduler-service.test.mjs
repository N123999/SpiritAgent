import test from 'node:test';
import assert from 'node:assert/strict';

import { groupGitHubPollMatchesByAutomation } from '../../dist-electron/src/host/automation-scheduler-service.js';

test('groupGitHubPollMatchesByAutomation groups matches by automation id', () => {
  const definitionA = {
    id: 'a',
    title: 'A',
    overview: 'A',
    trigger: { kind: 'github', owner: 'o', repo: 'r', event: 'issue_created' },
    workspaceRoot: '/tmp',
    modelName: 'm',
    approvalLevel: 'default',
    enabled: true,
    createdAtUnixMs: 1,
    updatedAtUnixMs: 1,
  };
  const definitionB = { ...definitionA, id: 'b', title: 'B', overview: 'B' };
  const grouped = groupGitHubPollMatchesByAutomation([
    {
      automationId: 'a',
      definition: definitionA,
      item: { number: 1, htmlUrl: 'https://example/1', isPullRequest: false, createdAt: '' },
      nextLastSeenNumber: 2,
    },
    {
      automationId: 'b',
      definition: definitionB,
      item: { number: 3, htmlUrl: 'https://example/3', isPullRequest: false, createdAt: '' },
      nextLastSeenNumber: 3,
    },
    {
      automationId: 'a',
      definition: definitionA,
      item: { number: 2, htmlUrl: 'https://example/2', isPullRequest: false, createdAt: '' },
      nextLastSeenNumber: 2,
    },
  ]);

  assert.equal(grouped.size, 2);
  assert.equal(grouped.get('a')?.length, 2);
  assert.equal(grouped.get('b')?.length, 1);
});
