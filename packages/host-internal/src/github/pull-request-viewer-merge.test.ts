import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveViewerCanMerge } from './pull-request-viewer-merge.js';

test('resolveViewerCanMerge prefers GraphQL headline when available', () => {
  assert.equal(
    resolveViewerCanMerge('Merge pull request #1 from feature', { push: false }),
    true,
  );
  assert.equal(resolveViewerCanMerge('', { push: true }), false);
});

test('resolveViewerCanMerge falls back to repository permissions when GraphQL unavailable', () => {
  assert.equal(resolveViewerCanMerge(null, { push: true }), true);
  assert.equal(resolveViewerCanMerge(undefined, { pull: true }), false);
});
