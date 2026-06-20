import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  isSpiritBranchName,
  listGitWorktrees,
  readWorktreeContext,
  resolvePrimaryRepoRoot,
} from '@spirit-agent/host-internal';

export async function resolveStoredSessionWorkspaceRoot(input: {
  workspaceRoot: string;
  gitBranch?: string;
}): Promise<string> {
  const trimmed = input.workspaceRoot.trim();
  if (!trimmed) {
    return trimmed;
  }

  const resolved = path.resolve(trimmed);
  const context = await readWorktreeContext(resolved);
  if (context.isWorktree) {
    return resolved;
  }

  const branch = input.gitBranch?.trim();
  if (!branch || !isSpiritBranchName(branch)) {
    return resolved;
  }

  try {
    const primaryRepoRoot = await resolvePrimaryRepoRoot(resolved);
    const worktrees = await listGitWorktrees(primaryRepoRoot);
    const match = worktrees.find((entry) => entry.branch === branch && entry.path);
    if (match?.path && existsSync(match.path)) {
      return path.resolve(match.path);
    }
  } catch {
    // 无法解析时保留 stored root
  }

  return resolved;
}
