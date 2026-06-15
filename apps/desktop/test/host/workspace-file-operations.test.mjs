import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  isDescendantOrSelf,
  moveWorkspaceEntry,
  renameWorkspaceEntry,
  validateEntryName,
} from '../../dist-electron/src/host/workspace-file-operations.js';

test('validateEntryName rejects empty and path separators', () => {
  assert.throws(() => validateEntryName(''), /Invalid file name|无效文件名/u);
  assert.throws(() => validateEntryName('foo/bar'), /Invalid file name|无效文件名/u);
  assert.throws(() => validateEntryName('..'), /Invalid file name|无效文件名/u);
  assert.doesNotThrow(() => validateEntryName('App.tsx'));
});

test('isDescendantOrSelf detects self and nested paths', () => {
  assert.equal(isDescendantOrSelf('src', 'src'), true);
  assert.equal(isDescendantOrSelf('src', 'src/components'), true);
  assert.equal(isDescendantOrSelf('src/components', 'src'), false);
  assert.equal(isDescendantOrSelf('', 'src'), true);
});

test('renameWorkspaceEntry renames a file within the workspace', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'spirit-ws-rename-'));
  const filePath = path.join(workspaceRoot, 'old.txt');
  await writeFile(filePath, 'hello', 'utf8');

  try {
    const result = await renameWorkspaceEntry(workspaceRoot, 'old.txt', 'new.txt');
    assert.equal(result.relativePath, 'new.txt');
    const moved = await renameWorkspaceEntry(workspaceRoot, 'new.txt', 'new.txt');
    assert.equal(moved.relativePath, 'new.txt');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('moveWorkspaceEntry moves a file into a directory', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'spirit-ws-move-'));
  await mkdir(path.join(workspaceRoot, 'src'));
  await writeFile(path.join(workspaceRoot, 'App.tsx'), 'export {}', 'utf8');

  try {
    const result = await moveWorkspaceEntry(workspaceRoot, 'App.tsx', 'src');
    assert.equal(result.relativePath, 'src/App.tsx');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('moveWorkspaceEntry rejects moving a directory into itself', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'spirit-ws-move-self-'));
  await mkdir(path.join(workspaceRoot, 'src', 'components'), { recursive: true });

  try {
    await assert.rejects(
      () => moveWorkspaceEntry(workspaceRoot, 'src', 'src/components'),
      /Cannot move a folder into itself|无法将文件夹移动到自身/u,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
