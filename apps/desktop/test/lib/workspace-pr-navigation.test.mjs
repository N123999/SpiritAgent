import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addWorkspaceToolTab,
  createInitialWorkspaceToolsState,
} from '../../src/lib/workspace-tool-tabs.ts';
import { buildOpenPullRequestNavigation } from '../../src/lib/workspace-pr-navigation.ts';

test('buildOpenPullRequestNavigation focuses existing PR tab', () => {
  const initial = createInitialWorkspaceToolsState(true);
  const prTab = addWorkspaceToolTab(initial.tabs, 'pr');

  const navigation = buildOpenPullRequestNavigation({
    tabs: prTab.tabs,
    activeTabId: initial.activeTabId,
    request: { owner: 'octocat', repo: 'Hello-World', number: 42 },
  });

  assert.equal(navigation.activeTabId, prTab.activeId);
  assert.equal(navigation.prTabId, prTab.activeId);
  assert.deepEqual(navigation.request, { owner: 'octocat', repo: 'Hello-World', number: 42 });
});

test('buildOpenPullRequestNavigation creates PR tab when missing', () => {
  const initial = createInitialWorkspaceToolsState(true);

  const navigation = buildOpenPullRequestNavigation({
    tabs: initial.tabs,
    activeTabId: initial.activeTabId,
    request: { owner: 'SpiritAgents', repo: 'SpiritAgent', number: 100 },
  });

  assert.notEqual(navigation.activeTabId, initial.activeTabId);
  assert.equal(navigation.tabs.at(-1)?.kind, 'pr');
  assert.equal(navigation.prTabId, navigation.activeTabId);
});
