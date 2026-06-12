import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deriveForkedSessionDisplayName } from '../../src/lib/fork-session-utils.ts';

test('deriveForkedSessionDisplayName prefixes untitled sessions with (1)', () => {
  assert.equal(deriveForkedSessionDisplayName('My Chat'), '(1) My Chat');
});

test('deriveForkedSessionDisplayName increments stacked fork prefix', () => {
  assert.equal(deriveForkedSessionDisplayName('(1) My Chat'), '(2) My Chat');
  assert.equal(deriveForkedSessionDisplayName('(2) My Chat'), '(3) My Chat');
  assert.equal(deriveForkedSessionDisplayName('(9) My Chat'), '(10) My Chat');
});
