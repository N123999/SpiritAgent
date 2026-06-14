import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAutomationRepositorySearchQuery } from './automation-repositories.js';

test('buildAutomationRepositorySearchQuery falls back to current user when query is empty', () => {
  assert.equal(buildAutomationRepositorySearchQuery('', 'octocat'), 'user:octocat');
  assert.equal(buildAutomationRepositorySearchQuery('   ', 'octocat'), 'user:octocat');
});

test('buildAutomationRepositorySearchQuery uses repo qualifier for owner/repo input', () => {
  assert.equal(
    buildAutomationRepositorySearchQuery('microsoft/vscode', 'octocat'),
    'repo:microsoft/vscode',
  );
});

test('buildAutomationRepositorySearchQuery uses global search for free-text input', () => {
  assert.equal(buildAutomationRepositorySearchQuery('spirit agent', 'octocat'), 'spirit agent');
});
