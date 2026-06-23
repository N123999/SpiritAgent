import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldShowComposerChangesCard } from '../../src/lib/composer-changes-card-visibility.ts';

test('shouldShowComposerChangesCard hides when not a repository', () => {
  assert.equal(
    shouldShowComposerChangesCard({
      isRepository: false,
      hasChanges: true,
      workingTreeLineDelta: { added: 3, removed: 1 },
    }),
    false,
  );
});

test('shouldShowComposerChangesCard hides when workspace is clean', () => {
  assert.equal(
    shouldShowComposerChangesCard({
      isRepository: true,
      hasChanges: false,
      workingTreeLineDelta: { added: 0, removed: 0 },
    }),
    false,
  );
});

test('shouldShowComposerChangesCard hides without line delta', () => {
  assert.equal(
    shouldShowComposerChangesCard({
      isRepository: true,
      hasChanges: true,
    }),
    false,
  );
});

test('shouldShowComposerChangesCard hides when both added and removed are zero', () => {
  assert.equal(
    shouldShowComposerChangesCard({
      isRepository: true,
      hasChanges: true,
      workingTreeLineDelta: { added: 0, removed: 0 },
    }),
    false,
  );
});

test('shouldShowComposerChangesCard shows when added or removed is positive', () => {
  assert.equal(
    shouldShowComposerChangesCard({
      isRepository: true,
      hasChanges: true,
      workingTreeLineDelta: { added: 2, removed: 0 },
    }),
    true,
  );
  assert.equal(
    shouldShowComposerChangesCard({
      isRepository: true,
      hasChanges: true,
      workingTreeLineDelta: { added: 0, removed: 4 },
    }),
    true,
  );
});

test('shouldShowComposerChangesCard treats undefined git as hidden', () => {
  assert.equal(shouldShowComposerChangesCard(undefined), false);
});
