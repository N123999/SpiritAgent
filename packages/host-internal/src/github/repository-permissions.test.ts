import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeMergeableState } from './pull-request.js';
import { viewerCanMergeFromPermissions } from './repository-permissions.js';

test('normalizeMergeableState maps known GitHub states', () => {
  assert.equal(normalizeMergeableState('clean'), 'clean');
  assert.equal(normalizeMergeableState('dirty'), 'dirty');
  assert.equal(normalizeMergeableState('has_hooks'), 'unknown');
});

test('viewerCanMergeFromPermissions requires admin maintain or push', () => {
  assert.equal(viewerCanMergeFromPermissions(null), false);
  assert.equal(viewerCanMergeFromPermissions({ pull: true }), false);
  assert.equal(viewerCanMergeFromPermissions({ push: true }), true);
  assert.equal(viewerCanMergeFromPermissions({ maintain: true }), true);
  assert.equal(viewerCanMergeFromPermissions({ admin: true }), true);
});
