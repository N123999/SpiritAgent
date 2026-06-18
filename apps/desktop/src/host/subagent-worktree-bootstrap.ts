import path from 'node:path';

import type { SubagentWorkspaceBootstrap } from '@spirit-agent/core';

import type { DesktopToolRequest } from './contracts.js';
import type { DesktopToolExecutor } from './tool-executor.js';
import {
  createWorkspaceGitWorktree,
  readPrimaryRepoRoot,
  readWorkspaceGitSnapshot,
  removeWorkspaceGitWorktree,
} from './git.js';

export type DesktopSubagentWorktreeBootstrapDeps = {
  parentWorkspaceRoot: string;
  generateWorktreeNames: (task: string, baseBranch: string, repoRoot: string) => Promise<{
    worktreeName: string;
    branchName: string;
  }>;
  buildScopedToolExecutor: (workspaceRoot: string) => Promise<DesktopToolExecutor>;
  resolveBaseBranch: () => string | undefined;
  isGitRepository: boolean;
};

export function createDesktopSubagentWorkspaceBootstrap(
  deps: DesktopSubagentWorktreeBootstrapDeps,
): SubagentWorkspaceBootstrap<DesktopToolRequest, string> {
  return async (input) => {
    if (!input.worktree) {
      return { workspaceRoot: input.parentWorkspaceRoot || deps.parentWorkspaceRoot };
    }

    if (!deps.isGitRepository) {
      return { error: 'worktree subagents require a git repository' };
    }

    let repoRoot: string | undefined;
    let createdWorktreePath: string | undefined;
    try {
      const parentRoot = input.parentWorkspaceRoot.trim() || deps.parentWorkspaceRoot;
      repoRoot = await readPrimaryRepoRoot(parentRoot);
      const worktreeContext = await readWorkspaceGitSnapshot(parentRoot);
      if (worktreeContext.isWorktreeSession) {
        return { error: 'worktree subagents cannot start from inside an existing worktree session' };
      }

      const baseBranch = deps.resolveBaseBranch();
      if (!baseBranch) {
        return { error: 'cannot determine base branch for subagent worktree' };
      }

      const names = await deps.generateWorktreeNames(input.task, baseBranch, repoRoot);
      const created = await createWorkspaceGitWorktree(repoRoot, names, baseBranch);
      createdWorktreePath = created.worktreePath;
      const scopedExecutor = await deps.buildScopedToolExecutor(created.worktreePath);

      return {
        workspaceRoot: created.worktreePath,
        worktreePath: created.worktreePath,
        branchName: created.branchName,
        toolExecutor: scopedExecutor,
      };
    } catch (error) {
      if (repoRoot && createdWorktreePath) {
        try {
          await removeWorkspaceGitWorktree(repoRoot, createdWorktreePath);
        } catch {
          // bootstrap 失败时的 best-effort 回滚；残留 worktree 由用户设置页清理兜底。
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      return { error: message };
    }
  };
}

export function resolveSubagentBootstrapParentRoot(
  parentWorkspaceRoot: string,
  fallbackRoot: string,
): string {
  const trimmed = parentWorkspaceRoot.trim();
  return trimmed.length > 0 ? path.resolve(trimmed) : path.resolve(fallbackRoot);
}
