import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  resolveWorkspaceExplorerIgnoreFlags,
} from './workspace-ignore.js';

const execFileAsync = promisify(execFile);

async function withTempWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'spirit-workspace-ignore-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function initGitRepo(root: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: root, windowsHide: true });
}

test('resolveWorkspaceExplorerIgnoreFlags uses git check-ignore in repositories', async () => {
  await withTempWorkspace(async (root) => {
    await initGitRepo(root);
    await writeFile(join(root, '.gitignore'), 'node_modules/\n.env\n', 'utf8');
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await writeFile(join(root, '.env'), 'SECRET=1\n', 'utf8');
    await writeFile(join(root, 'src.ts'), 'export {}\n', 'utf8');

    const flags = await resolveWorkspaceExplorerIgnoreFlags(root, '', [
      { name: 'node_modules', kind: 'dir' },
      { name: '.env', kind: 'file' },
      { name: 'src.ts', kind: 'file' },
    ]);

    assert.deepEqual(flags, [true, true, false]);
  });
});

test('resolveWorkspaceExplorerIgnoreFlags honors .git/info/exclude via git', async () => {
  await withTempWorkspace(async (root) => {
    await initGitRepo(root);
    await mkdir(join(root, '.git', 'info'), { recursive: true });
    await writeFile(join(root, '.git', 'info', 'exclude'), 'local-only/\n', 'utf8');
    await mkdir(join(root, 'local-only'), { recursive: true });
    await writeFile(join(root, 'tracked.ts'), 'export {}\n', 'utf8');

    const flags = await resolveWorkspaceExplorerIgnoreFlags(root, '', [
      { name: 'local-only', kind: 'dir' },
      { name: 'tracked.ts', kind: 'file' },
    ]);

    assert.deepEqual(flags, [true, false]);
  });
});

test('resolveWorkspaceExplorerIgnoreFlags falls back to ignore library without git', async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, '.gitignore'), 'dist/\n', 'utf8');
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'app.ts'), 'export {}\n', 'utf8');

    const flags = await resolveWorkspaceExplorerIgnoreFlags(root, '', [
      { name: 'dist', kind: 'dir' },
      { name: 'app.ts', kind: 'file' },
    ]);

    assert.deepEqual(flags, [true, false]);
  });
});

test('resolveWorkspaceExplorerIgnoreFlags returns all false when git is broken and no ignore rules', async () => {
  await withTempWorkspace(async (root) => {
    await mkdir(join(root, '.git'), { recursive: true });

    const flags = await resolveWorkspaceExplorerIgnoreFlags(root, '', [
      { name: 'src.ts', kind: 'file' },
    ]);

    assert.deepEqual(flags, [false]);
  });
});

test('resolveWorkspaceExplorerIgnoreFlags returns empty array for empty entries', async () => {
  await withTempWorkspace(async (root) => {
    const flags = await resolveWorkspaceExplorerIgnoreFlags(root, '', []);
    assert.deepEqual(flags, []);
  });
});
