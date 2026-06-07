import assert from 'node:assert/strict';
import test from 'node:test';

import { isCdpComputerUseRef, isComputerUseRef } from '../src/lib/computer-use-tree.ts';

test('computer use ref routing distinguishes UIA and CDP prefixes', () => {
  assert.equal(isComputerUseRef('w1a2b3n4'), true);
  assert.equal(isCdpComputerUseRef('w1a2b3n4'), false);

  assert.equal(isComputerUseRef('c9222n1042'), true);
  assert.equal(isCdpComputerUseRef('c9222n1042'), true);

  assert.equal(isComputerUseRef('invalid'), false);
  assert.equal(isCdpComputerUseRef('invalid'), false);
});
