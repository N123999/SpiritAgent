import test from 'node:test';
import assert from 'node:assert/strict';

import { parseGitHubRemoteUrl } from './remote.js';

test('parseGitHubRemoteUrl parses https origin', () => {
  assert.deepEqual(parseGitHubRemoteUrl('https://github.com/SpiritAgents/SpiritAgent.git'), {
    owner: 'SpiritAgents',
    repo: 'SpiritAgent',
  });
});

test('parseGitHubRemoteUrl parses ssh origin', () => {
  assert.deepEqual(parseGitHubRemoteUrl('git@github.com:octocat/Hello-World.git'), {
    owner: 'octocat',
    repo: 'Hello-World',
  });
});

test('parseGitHubRemoteUrl rejects non-github remotes', () => {
  assert.equal(parseGitHubRemoteUrl('https://gitlab.com/group/project.git'), null);
  assert.equal(parseGitHubRemoteUrl(''), null);
});
