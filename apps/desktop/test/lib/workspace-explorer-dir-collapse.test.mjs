import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collapseWorkspaceExplorerDirChain,
  isWorkspaceExplorerCollapsedDirOpen,
} from '../../src/lib/workspace-explorer-dir-collapse.ts';

function dir(name) {
  return { name, kind: 'dir' };
}

function file(name) {
  return { name, kind: 'file' };
}

test('collapseWorkspaceExplorerDirChain does not merge when current dir is not loaded', () => {
  const result = collapseWorkspaceExplorerDirChain('apps', 'apps', () => undefined);

  assert.deepEqual(result, {
    leafRel: 'apps',
    displayName: 'apps',
    chainRels: ['apps'],
  });
});

test('collapseWorkspaceExplorerDirChain merges one level when child listing is unknown', () => {
  const listings = {
    apps: [dir('desktop')],
  };

  const result = collapseWorkspaceExplorerDirChain('apps', 'apps', (rel) => listings[rel]);

  assert.deepEqual(result, {
    leafRel: 'apps/desktop',
    displayName: 'apps/desktop',
    chainRels: ['apps', 'apps/desktop'],
  });
});

test('collapseWorkspaceExplorerDirChain stops before merging through a loaded single-file dir', () => {
  const listings = {
    apps: [dir('desktop')],
    'apps/desktop': [file('electron-builder.yml')],
  };

  const result = collapseWorkspaceExplorerDirChain('apps', 'apps', (rel) => listings[rel]);

  assert.deepEqual(result, {
    leafRel: 'apps',
    displayName: 'apps',
    chainRels: ['apps'],
  });
});

test('collapseWorkspaceExplorerDirChain merges through loaded multi-child dirs', () => {
  const listings = {
    a: [dir('b')],
    'a/b': [dir('c'), dir('d')],
    'a/b/c': [dir('e')],
    'a/b/c/e': [file('file.ts')],
  };

  const result = collapseWorkspaceExplorerDirChain('a', 'a', (rel) => listings[rel]);

  assert.deepEqual(result, {
    leafRel: 'a/b',
    displayName: 'a/b',
    chainRels: ['a', 'a/b'],
  });
});

test('collapseWorkspaceExplorerDirChain matches PR deep passthrough collapse when loaded', () => {
  const listings = {
    a: [dir('b')],
    'a/b': [dir('c')],
    'a/b/c': [dir('d')],
    'a/b/c/d': [dir('e')],
    'a/b/c/d/e': [file('file.ts')],
  };

  const result = collapseWorkspaceExplorerDirChain('a', 'a', (rel) => listings[rel]);

  assert.deepEqual(result, {
    leafRel: 'a/b/c/d',
    displayName: 'a/b/c/d',
    chainRels: ['a', 'a/b', 'a/b/c', 'a/b/c/d'],
  });
});

test('collapseWorkspaceExplorerDirChain does not collapse sibling branches', () => {
  const listings = {
    apps: [dir('desktop'), dir('mobile')],
  };

  const result = collapseWorkspaceExplorerDirChain('apps', 'apps', (rel) => listings[rel]);

  assert.deepEqual(result, {
    leafRel: 'apps',
    displayName: 'apps',
    chainRels: ['apps'],
  });
});

test('isWorkspaceExplorerCollapsedDirOpen treats any chain segment as expanded', () => {
  assert.equal(
    isWorkspaceExplorerCollapsedDirOpen(['apps', 'apps/desktop'], { apps: true }),
    true,
  );
  assert.equal(
    isWorkspaceExplorerCollapsedDirOpen(['apps', 'apps/desktop'], { 'apps/desktop': true }),
    true,
  );
  assert.equal(isWorkspaceExplorerCollapsedDirOpen(['apps', 'apps/desktop'], {}), false);
});
