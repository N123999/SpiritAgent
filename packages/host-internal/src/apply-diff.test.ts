import assert from 'node:assert/strict';
import test from 'node:test';

import { applyDiff } from './apply-diff.js';

test('applyDiff create mode', () => {
  const diff = ['+line one', '+line two', '*** End Patch'].join('\n');
  assert.equal(applyDiff('', diff, 'create'), 'line one\nline two');
});

test('applyDiff create mode tolerates leading bare @@ anchor', () => {
  const diff = ['@@', '+line one', '+line two', '*** End Patch'].join('\n');
  assert.equal(applyDiff('', diff, 'create'), 'line one\nline two');
});

test('applyDiff create mode tolerates leading @@ anchor with context', () => {
  const diff = ['@@ context line', '+line one', '*** End Patch'].join('\n');
  assert.equal(applyDiff('', diff, 'create'), 'line one');
});

test('applyDiff update mode replaces one line', () => {
  const input = 'alpha\nbeta\ngamma';
  const diff = ['@@ ', ' alpha', '-beta', '+BETA', ' gamma', '*** End Patch'].join('\n');
  assert.equal(applyDiff(input, diff), 'alpha\nBETA\ngamma');
});
