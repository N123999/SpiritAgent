import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { createDesktopSubagentWorkspaceBootstrap } from '../../dist-electron/src/host/subagent-worktree-bootstrap.js';

const execFileAsync = promisify(execFile);

async function runGit(cwd, args) {
  await execFileAsync('git', args, { cwd, windowsHide: true });
}

async function createTempGitRepo() {
  const repoRoot = await realpath(await mkdtemp(join(tmpdir(), 'spirit-subagent-bootstrap-')));
  await runGit(repoRoot, ['init']);
  await runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
  await runGit(repoRoot, ['config', 'user.name', 'Spirit Test']);
  await writeFile(join(repoRoot, 'README.md'), '# hello\n');
  await runGit(repoRoot, ['add', 'README.md']);
  await runGit(repoRoot, ['commit', '-m', 'init']);
  const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
    cwd: repoRoot,
    windowsHide: true,
  });
  return { repoRoot, defaultBranch: stdout.trim() };
}

test('createDesktopSubagentWorkspaceBootstrap passes subagent task to generateWorktreeNames', async () => {
  const { repoRoot, defaultBranch } = await createTempGitRepo();
  const namingCalls = [];

  try {
    const bootstrap = createDesktopSubagentWorkspaceBootstrap({
      parentWorkspaceRoot: repoRoot,
      isGitRepository: true,
      resolveBaseBranch: () => defaultBranch,
      generateWorktreeNames: async (task, baseBranch, resolvedRepoRoot) => {
        namingCalls.push({ task, baseBranch, resolvedRepoRoot });
        return {
          worktreeName: 'spirit-subagent-task-naming',
          branchName: 'spirit/subagent-task-naming',
        };
      },
      buildScopedToolExecutor: async (workspaceRoot) => ({
        workspaceRoot,
      }),
    });

    const result = await bootstrap({
      subagentSessionId: 'subagent-test-1',
      task: 'Inspect repository layout only',
      worktree: true,
      parentWorkspaceRoot: repoRoot,
    });

    assert.equal(namingCalls.length, 1);
    assert.equal(namingCalls[0]?.task, 'Inspect repository layout only');
    assert.equal(namingCalls[0]?.baseBranch, defaultBranch);
    assert.equal(namingCalls[0]?.resolvedRepoRoot, repoRoot);
    assert.equal(result.worktreePath?.includes('spirit-subagent-task-naming'), true);
    assert.equal(result.branchName, 'spirit/subagent-task-naming');
  } finally {
    await rm(`${repoRoot}.worktrees`, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
    await rm(repoRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
