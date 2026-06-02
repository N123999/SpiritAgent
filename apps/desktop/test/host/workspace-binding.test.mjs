import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeWorkspaceBinding,
  resolveDesktopHomeDirectory,
} from '../../dist-electron/src/host/storage.js';
import {
  buildAvailableWorkspaces,
  resolveWorkspaceBindingForRequestedRoot,
} from '../../dist-electron/src/host/service-utils.js';

test('normalizeWorkspaceBinding treats only none as none', () => {
  assert.equal(normalizeWorkspaceBinding('none'), 'none');
  assert.equal(normalizeWorkspaceBinding('project'), 'project');
  assert.equal(normalizeWorkspaceBinding(undefined), 'project');
  assert.equal(normalizeWorkspaceBinding(''), 'project');
});

test('resolveDesktopHomeDirectory returns an absolute path', () => {
  const home = resolveDesktopHomeDirectory();
  assert.ok(home.length > 0);
  assert.ok(!home.endsWith('.'));
});

test('resolveWorkspaceBindingForRequestedRoot keeps none when opening homedir session', () => {
  const home = resolveDesktopHomeDirectory();
  assert.equal(
    resolveWorkspaceBindingForRequestedRoot({
      requestedWorkspaceRoot: home,
      previousBinding: 'none',
      persistedBinding: 'none',
    }),
    'none',
  );
});

test('resolveWorkspaceBindingForRequestedRoot uses none for homedir even when persisted project', () => {
  const home = resolveDesktopHomeDirectory();
  assert.equal(
    resolveWorkspaceBindingForRequestedRoot({
      requestedWorkspaceRoot: home,
      previousBinding: 'project',
      persistedBinding: 'project',
    }),
    'none',
  );
});

test('resolveWorkspaceBindingForRequestedRoot uses project for real workspace roots', () => {
  assert.equal(
    resolveWorkspaceBindingForRequestedRoot({
      requestedWorkspaceRoot: 'D:/SpiritAgent',
      previousBinding: 'none',
      persistedBinding: 'none',
    }),
    'project',
  );
});

test('buildAvailableWorkspaces excludes homedir when workspace binding is none', () => {
  const home = resolveDesktopHomeDirectory();
  const recent = [home, 'D:/SpiritAgent'];
  const items = buildAvailableWorkspaces(home, recent, 'none');
  const paths = items.map((item) => item.path.replace(/\\/g, '/').toLowerCase());
  assert.ok(!paths.includes(home.replace(/\\/g, '/').toLowerCase()));
  assert.ok(paths.some((entry) => entry.endsWith('/spiritagent')));
});

test('buildAvailableWorkspaces excludes homedir when workspace binding is project', () => {
  const home = resolveDesktopHomeDirectory();
  const recent = [home, 'D:/SpiritAgent'];
  const items = buildAvailableWorkspaces(home, recent, 'project');
  const paths = items.map((item) => item.path.replace(/\\/g, '/').toLowerCase());
  assert.ok(!paths.includes(home.replace(/\\/g, '/').toLowerCase()));
});
