import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCdpAxTree,
  isCdpComputerUseRef,
  makeCdpRef,
  parseCdpComputerUseRef,
} from '../src/lib/cdp-ax-tree.ts';

const fixtureNodes = [
  {
    nodeId: '1',
    role: { value: 'RootWebArea' },
    name: { value: 'NetEase Cloud Music' },
    backendDOMNodeId: 1,
    childIds: ['2'],
  },
  {
    nodeId: '2',
    parentId: '1',
    role: { value: 'button' },
    name: { value: 'Play' },
    backendDOMNodeId: 42,
    childIds: [],
    properties: [{ name: 'disabled', value: { value: false } }],
  },
];

test('parseCdpComputerUseRef accepts c{port}n{backendDOMNodeId}', () => {
  assert.equal(isCdpComputerUseRef('c9222n1042'), true);
  assert.deepEqual(parseCdpComputerUseRef('c9222n1042'), {
    port: 9222,
    backendDomNodeId: 1042,
  });
  assert.equal(isCdpComputerUseRef('w10n1'), false);
  assert.equal(makeCdpRef(9222, 1042), 'c9222n1042');
});

test('buildCdpAxTree builds hierarchy and refs from flat AX nodes', () => {
  const result = buildCdpAxTree(fixtureNodes, { port: 9222, maxDepth: 8, maxNodes: 50 });
  assert.equal(result.coverage, 'full');
  assert.equal(result.nodesReturned, 2);
  assert.ok(result.tree);
  assert.equal(result.tree.ref, 'c9222n1');
  assert.equal(result.tree.children?.length, 1);
  const button = result.tree.children?.[0];
  assert.equal(button?.ref, 'c9222n42');
  assert.equal(button?.role, 'button');
  assert.deepEqual(button?.patterns, ['invoke']);
});

test('buildCdpAxTree marks partial coverage when max_nodes exceeded', () => {
  const manyNodes = [
    {
      nodeId: 'root',
      role: { value: 'RootWebArea' },
      name: { value: 'App' },
      backendDOMNodeId: 1,
      childIds: ['a', 'b'],
    },
    {
      nodeId: 'a',
      parentId: 'root',
      role: { value: 'button' },
      name: { value: 'A' },
      backendDOMNodeId: 2,
      childIds: [],
    },
    {
      nodeId: 'b',
      parentId: 'root',
      role: { value: 'button' },
      name: { value: 'B' },
      backendDOMNodeId: 3,
      childIds: [],
    },
  ];
  const result = buildCdpAxTree(manyNodes, { port: 9222, maxDepth: 8, maxNodes: 2 });
  assert.equal(result.coverage, 'partial');
  assert.equal(result.nodesReturned, 2);
});
