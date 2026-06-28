import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  createWorkspaceEntry,
  forceDeleteWorkspaceEntry,
  isDescendantOrSelf,
  moveWorkspaceEntry,
  renameWorkspaceEntry,
  trashWorkspaceEntry,
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
  assert.equal(isDescendantOrSelf('', 'src'), false);
});

test('createWorkspaceEntry creates a file and directory at workspace root', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'spirit-ws-create-root-'));

  try {
    const file = await createWorkspaceEntry(workspaceRoot, '', 'notes.txt', 'file');
    assert.equal(file.relativePath, 'notes.txt');
    await access(path.join(workspaceRoot, 'notes.txt'));

    const dir = await createWorkspaceEntry(workspaceRoot, '', 'lib', 'dir');
    assert.equal(dir.relativePath, 'lib');
    await access(path.join(workspaceRoot, 'lib'));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('createWorkspaceEntry creates nested entries under a parent directory', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'spirit-ws-create-nested-'));
  await mkdir(path.join(workspaceRoot, 'src'));

  try {
    const file = await createWorkspaceEntry(workspaceRoot, 'src', 'App.tsx', 'file');
    assert.equal(file.relativePath, 'src/App.tsx');
    await access(path.join(workspaceRoot, 'src', 'App.tsx'));

    const dir = await createWorkspaceEntry(workspaceRoot, 'src', 'components', 'dir');
    assert.equal(dir.relativePath, 'src/components');
    await access(path.join(workspaceRoot, 'src', 'components'));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('createWorkspaceEntry rejects duplicate names and invalid names', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'spirit-ws-create-reject-'));
  await writeFile(path.join(workspaceRoot, 'exists.txt'), 'x', 'utf8');

  try {
    await assert.rejects(
      () => createWorkspaceEntry(workspaceRoot, '', 'exists.txt', 'file'),
      /already exists|已存在同名/u,
    );
    await assert.rejects(
      () => createWorkspaceEntry(workspaceRoot, '', 'bad/name', 'file'),
      /Invalid file name|无效文件名/u,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
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

test('moveWorkspaceEntry is a no-op when dropped into the same directory', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'spirit-ws-move-same-'));
  await writeFile(path.join(workspaceRoot, 'App.tsx'), 'export {}', 'utf8');

  try {
    const result = await moveWorkspaceEntry(workspaceRoot, 'App.tsx', '');
    assert.equal(result.relativePath, 'App.tsx');
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

test('renameWorkspaceEntry renames a directory', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'spirit-ws-rename-dir-'));
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
  await writeFile(path.join(workspaceRoot, 'src', 'App.tsx'), 'export {}', 'utf8');

  try {
    const result = await renameWorkspaceEntry(workspaceRoot, 'src', 'lib');
    assert.equal(result.relativePath, 'lib');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('forceDeleteWorkspaceEntry removes a file and a directory tree', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'spirit-ws-force-delete-'));
  await mkdir(path.join(workspaceRoot, 'src', 'nested'), { recursive: true });
  await writeFile(path.join(workspaceRoot, 'App.tsx'), 'export {}', 'utf8');
  await writeFile(path.join(workspaceRoot, 'src', 'nested', 'x.txt'), 'x', 'utf8');

  try {
    await forceDeleteWorkspaceEntry(workspaceRoot, 'App.tsx');
    await assert.rejects(() => access(path.join(workspaceRoot, 'App.tsx')));
    await forceDeleteWorkspaceEntry(workspaceRoot, 'src');
    await assert.rejects(() => access(path.join(workspaceRoot, 'src')));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('trashWorkspaceEntry rejects empty relative path before shell', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'spirit-ws-trash-invalid-'));

  try {
    await assert.rejects(
      () => trashWorkspaceEntry(workspaceRoot, ''),
      /Invalid path|无效路径/u,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
