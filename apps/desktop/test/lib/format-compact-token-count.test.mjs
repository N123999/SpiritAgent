import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatCompactTokenCount } from '../../src/lib/format-compact-token-count.ts';

test('formatCompactTokenCount abbreviates thousands and millions', () => {
  assert.equal(formatCompactTokenCount(503), '503');
  assert.equal(formatCompactTokenCount(4803), '4.8K');
  assert.equal(formatCompactTokenCount(50_000), '50K');
  assert.equal(formatCompactTokenCount(128_000), '128K');
  assert.equal(formatCompactTokenCount(999_999), '999.9K');
  assert.equal(formatCompactTokenCount(999_950), '999.9K');
  assert.equal(formatCompactTokenCount(1_000_000), '1M');
  assert.equal(formatCompactTokenCount(1_050_000), '1.1M');
});
