import assert from 'node:assert/strict';
import test from 'node:test';

import {
  workspaceDirectoryIconClassName,
} from '../../src/lib/workspace-directory-icon.ts';

test('workspaceDirectoryIconClassName matches slash menu list density', () => {
  assert.match(workspaceDirectoryIconClassName('seti'), /size-3\.5/u);
  assert.match(workspaceDirectoryIconClassName('seti'), /opacity-70/u);
  assert.doesNotMatch(workspaceDirectoryIconClassName('seti'), /text-/u);
});

test('workspaceDirectoryIconClassName inherit uses chip size', () => {
  assert.match(workspaceDirectoryIconClassName('inherit'), /size-\[10px\]/u);
  assert.match(
    workspaceDirectoryIconClassName('inherit', 'text-blue-600'),
    /text-blue-600/u,
  );
  assert.doesNotMatch(workspaceDirectoryIconClassName('inherit', 'text-blue-600'), /opacity-70/u);
  assert.doesNotMatch(workspaceDirectoryIconClassName('inherit'), /size-3\.5/u);
});
