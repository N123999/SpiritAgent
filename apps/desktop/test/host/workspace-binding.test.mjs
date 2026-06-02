import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeWorkspaceBinding,
  resolveDesktopHomeDirectory,
} from '../../dist-electron/src/host/storage.js';

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
