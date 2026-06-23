import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialWorkspaceToolsState,
} from '../../src/lib/workspace-tool-tabs.ts';
import { resolveWorkspaceGitTab } from '../../src/lib/workspace-git-navigation.ts';

test('resolveWorkspaceGitTab keeps focus when active tab is Git', () => {
  const initial = createInitialWorkspaceToolsState(true);
  const gitTabId = initial.tabs.find((tab) => tab.kind === 'git')?.id;
  assert.ok(gitTabId);

  const navigation = resolveWorkspaceGitTab(initial.tabs, gitTabId);

  assert.equal(navigation.activeTabId, gitTabId);
  assert.equal(navigation.gitTabId, gitTabId);
  assert.equal(navigation.tabs.length, initial.tabs.length);
});

test('resolveWorkspaceGitTab focuses first Git tab when active tab is not Git', () => {
  const initial = createInitialWorkspaceToolsState(true);
  const gitTabId = initial.tabs.find((tab) => tab.kind === 'git')?.id;
  assert.ok(gitTabId);

  const navigation = resolveWorkspaceGitTab(initial.tabs, initial.activeTabId);

  assert.equal(navigation.activeTabId, gitTabId);
  assert.equal(navigation.gitTabId, gitTabId);
});

test('resolveWorkspaceGitTab creates Git tab when missing', () => {
  const initial = createInitialWorkspaceToolsState(true);
  const tabsWithoutGit = initial.tabs.filter((tab) => tab.kind !== 'git');

  const navigation = resolveWorkspaceGitTab(tabsWithoutGit, initial.activeTabId);

  assert.notEqual(navigation.activeTabId, initial.activeTabId);
  assert.equal(navigation.tabs.at(-1)?.kind, 'git');
  assert.equal(navigation.gitTabId, navigation.activeTabId);
});
