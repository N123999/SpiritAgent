import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  addGitWorktree,
  buildWorktreeRootPath,
} from '@spirit-agent/host-internal';

import { resolveStoredSessionWorkspaceRoot } from '../../dist-electron/src/host/resolve-session-workspace-root.js';

const execFileAsync = promisify(execFile);

async function runGit(cwd, args) {
  await execFileAsync('git', args, { cwd, windowsHide: true });
}

test('resolveStoredSessionWorkspaceRoot keeps linked worktree path as-is', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'spirit-resolve-session-root-'));
  const worktreeName = 'spirit-resolve-test';
  const branchName = 'spirit/resolve-test';

  try {
    await runGit(repoRoot, ['init']);
    await runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
    await runGit(repoRoot, ['config', 'user.name', 'Spirit Test']);
    await writeFile(join(repoRoot, 'README.md'), '# hello\n');
    await runGit(repoRoot, ['add', 'README.md']);
    await runGit(repoRoot, ['commit', '-m', 'init']);

    const { stdout: defaultBranchOutput } = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: repoRoot,
      windowsHide: true,
    });
    const worktreePath = buildWorktreeRootPath(repoRoot, worktreeName);
    await addGitWorktree(repoRoot, {
      worktreePath,
      branchName,
      baseBranch: defaultBranchOutput.trim(),
    });

    const resolved = await resolveStoredSessionWorkspaceRoot({
      workspaceRoot: worktreePath,
      gitBranch: branchName,
    });
    assert.equal(resolved.replace(/\\/g, '/'), worktreePath.replace(/\\/g, '/'));
  } finally {
    await rm(`${repoRoot}.worktrees`, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await rm(repoRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('resolveStoredSessionWorkspaceRoot maps stored primary repo root to existing spirit worktree', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'spirit-resolve-session-root-'));
  const worktreeName = 'spirit-resolve-fallback';
  const branchName = 'spirit/resolve-fallback';

  try {
    await runGit(repoRoot, ['init']);
    await runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
    await runGit(repoRoot, ['config', 'user.name', 'Spirit Test']);
    await writeFile(join(repoRoot, 'README.md'), '# hello\n');
    await runGit(repoRoot, ['add', 'README.md']);
    await runGit(repoRoot, ['commit', '-m', 'init']);

    const { stdout: defaultBranchOutput } = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: repoRoot,
      windowsHide: true,
    });
    const worktreePath = buildWorktreeRootPath(repoRoot, worktreeName);
    await addGitWorktree(repoRoot, {
      worktreePath,
      branchName,
      baseBranch: defaultBranchOutput.trim(),
    });

    const resolved = await resolveStoredSessionWorkspaceRoot({
      workspaceRoot: repoRoot,
      gitBranch: branchName,
    });
    assert.equal(resolved.replace(/\\/g, '/'), worktreePath.replace(/\\/g, '/'));
  } finally {
    await rm(`${repoRoot}.worktrees`, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await rm(repoRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('resolveStoredSessionWorkspaceRoot keeps primary repo when branch is not spirit/*', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'spirit-resolve-session-root-'));

  try {
    await runGit(repoRoot, ['init']);
    await runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
    await runGit(repoRoot, ['config', 'user.name', 'Spirit Test']);
    await writeFile(join(repoRoot, 'README.md'), '# hello\n');
    await runGit(repoRoot, ['add', 'README.md']);
    await runGit(repoRoot, ['commit', '-m', 'init']);

    const resolved = await resolveStoredSessionWorkspaceRoot({
      workspaceRoot: repoRoot,
      gitBranch: 'main',
    });
    assert.equal(resolved.replace(/\\/g, '/'), repoRoot.replace(/\\/g, '/'));
  } finally {
    await rm(repoRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
