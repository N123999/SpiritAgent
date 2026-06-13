import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resolvePrTestPlanProgressVariant,
  resolvePullRequestListIconTone,
} from '../../src/lib/github-pr-list-ui.ts';

test('resolvePrTestPlanProgressVariant covers none, zero, partial, and complete', () => {
  assert.equal(resolvePrTestPlanProgressVariant(null), 'none');
  assert.equal(resolvePrTestPlanProgressVariant({ total: 0, completed: 0 }), 'none');
  assert.equal(resolvePrTestPlanProgressVariant({ total: 3, completed: 0 }), 'zero');
  assert.equal(resolvePrTestPlanProgressVariant({ total: 3, completed: 2 }), 'partial');
  assert.equal(resolvePrTestPlanProgressVariant({ total: 3, completed: 3 }), 'complete');
});

test('resolvePullRequestListIconTone prefers merged and draft over state', () => {
  assert.equal(
    resolvePullRequestListIconTone({ merged: true, draft: true, state: 'open' }),
    'merged',
  );
  assert.equal(
    resolvePullRequestListIconTone({ merged: false, draft: true, state: 'open' }),
    'draft',
  );
  assert.equal(
    resolvePullRequestListIconTone({ merged: false, draft: false, state: 'open' }),
    'open',
  );
  assert.equal(
    resolvePullRequestListIconTone({ merged: false, draft: false, state: 'closed' }),
    'closed',
  );
});
