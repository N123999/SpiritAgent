import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPrChangedFilesTree } from '../../src/lib/pr-changed-files-tree.ts';

function dir(name, path, children) {
  return { kind: 'dir', name, path, children };
}

function file(name, path) {
  return {
    kind: 'file',
    name,
    path,
    file: {
      filename: path,
      status: 'modified',
      additions: 1,
      deletions: 0,
      changes: 1,
    },
  };
}

test('buildPrChangedFilesTree collapses linear dir chains without files', () => {
  const tree = buildPrChangedFilesTree([
    { filename: 'apps/desktop/src/App.tsx', status: 'modified', additions: 1, deletions: 0, changes: 1 },
  ]);

  assert.deepEqual(tree, [
    dir('apps/desktop', 'apps/desktop', [
      dir('src', 'apps/desktop/src', [file('App.tsx', 'apps/desktop/src/App.tsx')]),
    ]),
  ]);
});

test('buildPrChangedFilesTree collapses multiple linear segments before branching', () => {
  const tree = buildPrChangedFilesTree([
    { filename: 'apps/desktop/src/a.ts', status: 'modified', additions: 1, deletions: 0, changes: 1 },
    { filename: 'apps/desktop/test/a.test.ts', status: 'modified', additions: 1, deletions: 0, changes: 1 },
  ]);

  assert.deepEqual(tree, [
    dir('apps/desktop', 'apps/desktop', [
      dir('src', 'apps/desktop/src', [file('a.ts', 'apps/desktop/src/a.ts')]),
      dir('test', 'apps/desktop/test', [file('a.test.ts', 'apps/desktop/test/a.test.ts')]),
    ]),
  ]);
});

test('buildPrChangedFilesTree does not collapse dirs with multiple children', () => {
  const tree = buildPrChangedFilesTree([
    { filename: 'apps/desktop/a.ts', status: 'modified', additions: 1, deletions: 0, changes: 1 },
    { filename: 'apps/mobile/a.ts', status: 'modified', additions: 1, deletions: 0, changes: 1 },
  ]);

  assert.deepEqual(tree, [
    dir('apps', 'apps', [
      dir('desktop', 'apps/desktop', [file('a.ts', 'apps/desktop/a.ts')]),
      dir('mobile', 'apps/mobile', [file('a.ts', 'apps/mobile/a.ts')]),
    ]),
  ]);
});

test('buildPrChangedFilesTree collapses deep passthrough dir chains', () => {
  const tree = buildPrChangedFilesTree([
    { filename: 'a/b/c/d/e/file.ts', status: 'modified', additions: 1, deletions: 0, changes: 1 },
  ]);

  assert.deepEqual(tree, [
    dir('a/b/c/d', 'a/b/c/d', [dir('e', 'a/b/c/d/e', [file('file.ts', 'a/b/c/d/e/file.ts')])]),
  ]);
});

test('buildPrChangedFilesTree collapses single-child dir even when it contains root files', () => {
  const electronBuilder = {
    filename: 'apps/desktop/electron-builder.yml',
    status: 'modified',
    additions: 8,
    deletions: 0,
    changes: 8,
  };
  const mainTs = {
    filename: 'apps/desktop/electron/main.ts',
    status: 'added',
    additions: 20,
    deletions: 0,
    changes: 20,
  };
  const hostTools = {
    filename: 'packages/agent-core/src/host-tools.ts',
    status: 'modified',
    additions: 1,
    deletions: 0,
    changes: 1,
  };

  const tree = buildPrChangedFilesTree([electronBuilder, mainTs, hostTools]);

  assert.deepEqual(tree, [
    dir('apps/desktop', 'apps/desktop', [
      dir('electron', 'apps/desktop/electron', [
        { kind: 'file', name: 'main.ts', path: mainTs.filename, file: mainTs },
      ]),
      { kind: 'file', name: 'electron-builder.yml', path: electronBuilder.filename, file: electronBuilder },
    ]),
    dir('packages/agent-core', 'packages/agent-core', [
      dir('src', 'packages/agent-core/src', [
        { kind: 'file', name: 'host-tools.ts', path: hostTools.filename, file: hostTools },
      ]),
    ]),
  ]);
});

test('buildPrChangedFilesTree does not collapse when a dir contains a file sibling', () => {
  const tree = buildPrChangedFilesTree([
    { filename: 'apps/README.md', status: 'modified', additions: 1, deletions: 0, changes: 1 },
    { filename: 'apps/desktop/a.ts', status: 'modified', additions: 1, deletions: 0, changes: 1 },
  ]);

  assert.deepEqual(tree, [
    dir('apps', 'apps', [
      dir('desktop', 'apps/desktop', [file('a.ts', 'apps/desktop/a.ts')]),
      file('README.md', 'apps/README.md'),
    ]),
  ]);
});
