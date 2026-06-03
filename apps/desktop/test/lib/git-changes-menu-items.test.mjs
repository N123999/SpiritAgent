import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildGitChangesMenuItemIds } from '../../dist-electron/src/lib/git-changes-menu-items.js';

test('buildGitChangesMenuItemIds lists push and merge when enabled', () => {
  assert.deepEqual(
    buildGitChangesMenuItemIds({ needsPush: true, canMerge: true }),
    ['push', 'merge'],
  );
  assert.deepEqual(
    buildGitChangesMenuItemIds({ needsPush: true, canMerge: false }),
    ['push'],
  );
  assert.deepEqual(
    buildGitChangesMenuItemIds({ needsPush: false, canMerge: true }),
    ['merge'],
  );
  assert.deepEqual(
    buildGitChangesMenuItemIds({ needsPush: false, canMerge: false }),
    [],
  );
});
