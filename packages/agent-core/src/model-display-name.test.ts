import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatModelDisplayNameFromId } from './model-display-name.js';

test('formatModelDisplayNameFromId replaces separators and title-cases words', () => {
  assert.equal(formatModelDisplayNameFromId('gpt-4o-mini'), 'Gpt 4o Mini');
  assert.equal(formatModelDisplayNameFromId('anthropic/claude-sonnet-4'), 'Anthropic Claude Sonnet 4');
  assert.equal(formatModelDisplayNameFromId('foo:bar/baz'), 'Foo Bar Baz');
  assert.equal(formatModelDisplayNameFromId('  spaced--id  '), 'Spaced Id');
});

test('formatModelDisplayNameFromId keeps empty input as-is', () => {
  assert.equal(formatModelDisplayNameFromId(''), '');
  assert.equal(formatModelDisplayNameFromId('   '), '   ');
});
