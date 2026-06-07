import assert from 'node:assert/strict';
import test from 'node:test';

import {
  flattenComputerUseTree,
  isCdpComputerUseRef,
  isComputerUseRef,
  parseCdpComputerUseRef,
  parseComputerUseRef,
  pruneComputerUseTree,
} from '../src/lib/computer-use-tree.ts';

test('parseComputerUseRef accepts w{hwnd}n{ordinal}', () => {
  assert.equal(isComputerUseRef('w1a2b3n4'), true);
  const parsed = parseComputerUseRef('w1a2b3n4');
  assert.deepEqual(parsed, { windowHwndHex: '1a2b3', ordinal: 4 });
  assert.equal(isComputerUseRef('bad-ref'), false);
});

test('parseCdpComputerUseRef is re-exported from computer-use-tree', () => {
  assert.equal(isCdpComputerUseRef('c9222n42'), true);
  assert.deepEqual(parseCdpComputerUseRef('c9222n42'), { port: 9222, backendDomNodeId: 42 });
  assert.equal(isComputerUseRef('c9222n42'), true);
});

test('flattenComputerUseTree preserves depth order', () => {
  const tree = {
    ref: 'w10n1',
    role: 'Window',
    name: 'Notepad',
    automation_id: '',
    patterns: [],
    is_enabled: true,
    is_offscreen: false,
    children: [
      {
        ref: 'w10n2',
        role: 'Edit',
        name: 'Text Editor',
        automation_id: 'editor',
        patterns: ['set_value'],
        is_enabled: true,
        is_offscreen: false,
      },
    ],
  };

  const rows = flattenComputerUseTree(tree);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].depth, 1);
  assert.equal(rows[1].ref, 'w10n2');
});

test('pruneComputerUseTree removes empty structural nodes', () => {
  const tree = {
    ref: 'w10n1',
    role: 'Pane',
    name: '',
    automation_id: '',
    patterns: [],
    is_enabled: true,
    is_offscreen: false,
    children: [
      {
        ref: 'w10n2',
        role: 'Button',
        name: 'OK',
        automation_id: '',
        patterns: ['invoke'],
        is_enabled: true,
        is_offscreen: false,
      },
    ],
  };

  const pruned = pruneComputerUseTree(tree);
  assert.ok(pruned);
  assert.equal(pruned.children?.length, 1);
  assert.equal(pruned.children?.[0].name, 'OK');
});
