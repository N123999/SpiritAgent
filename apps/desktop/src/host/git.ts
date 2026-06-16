import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import i18n from '../lib/i18n-host.js';
import {
  addGitWorktree as addGitWorktreeInternal,
  buildGitCommitHistorySnapshot,
  checkoutGitBranch as checkoutGitBranchInternal,
  buildWorktreeRootPath,
  isGitCheckoutBlockedError,
  mergeGitLogCommitPages,
  mergeSpiritBranchToMain as mergeSpiritBranchToMainInternal,
  pushGitBranch as pushGitBranchInternal,
  readGitCommitHistory,
  readGitWorkingTreeChanges,
  readGitWorkspaceSnapshot,
  readWorktreeContext,
  removeGitWorktree as removeGitWorktreeInternal,
  resolveDefaultBranch,
  resolvePrimaryRepoRoot,
  type GitCheckoutOptions,
} from '@spirit-agent/host-internal';

import type {
  DesktopGitSnapshot,
  GitHistorySnapshot,
  GitWorkingTreeSnapshot,
  ReadGitHistoryRequest,
} from '../types.js';
import type { GeneratedWorktreeNames } from './worktree-naming.js';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 4 * 1024 * 1024;

async function runGit(
  workspaceRoot: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync('git', args, {
      cwd: workspaceRoot,
      windowsHide: true,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const message = renderGitError(error);
    throw new Error(i18n.t('error.gitCommandFailed', { command: args.join(' '), message }));
  }
}

function renderGitError(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return String(error);
  }

  const stdout = typeof (error as { stdout?: unknown }).stdout === 'string'
    ? (error as { stdout: string }).stdout.trim()
    : '';
  const stderr = typeof (error as { stderr?: unknown }).stderr === 'string'
    ? (error as { stderr: string }).stderr.trim()
    : '';
  const message = error instanceof Error ? error.message.trim() : String(error);
  return stderr || stdout || message;
}

export type WorkspaceGitSnapshotRead = Omit<DesktopGitSnapshot, 'revision'>;

export function applyGitRevision(
  snapshot: WorkspaceGitSnapshotRead,
  previousRevision: number,
  options: { reset?: boolean } = {},
): DesktopGitSnapshot {
  return {
    ...snapshot,
    revision: options.reset ? 1 : previousRevision + 1,
  };
}

export async function readWorkspaceGitSnapshot(
  workspaceRoot: string,
): Promise<WorkspaceGitSnapshotRead> {
  const snapshot = await readGitWorkspaceSnapshot(workspaceRoot);
  const worktreeContext = await readWorktreeContext(workspaceRoot);
  const defaultBranch = worktreeContext.isWorktree && worktreeContext.repoRoot
    ? await resolveDefaultBranch(worktreeContext.repoRoot).catch(() => undefined)
    : undefined;

  return {
    isRepository: snapshot.isRepository,
    hasChanges: snapshot.hasChanges,
    branches: snapshot.branches,
    aheadCount: snapshot.aheadCount,
    behindCount: snapshot.behindCount,
    needsPush: snapshot.needsPush,
    ...(snapshot.branch ? { branch: snapshot.branch } : {}),
    ...(snapshot.upstreamRemote ? { upstreamRemote: snapshot.upstreamRemote } : {}),
    ...(snapshot.upstreamBranch ? { upstreamBranch: snapshot.upstreamBranch } : {}),
    ...(snapshot.pushRemote ? { pushRemote: snapshot.pushRemote } : {}),
    ...(worktreeContext.isWorktree
      ? {
          isWorktreeSession: true,
          ...(worktreeContext.repoRoot ? { primaryRepoRoot: worktreeContext.repoRoot } : {}),
          ...(worktreeContext.worktreeName ? { worktreeName: worktreeContext.worktreeName } : {}),
          ...(worktreeContext.branch ? { worktreeBranch: worktreeContext.branch } : {}),
        }
      : {}),
    ...(defaultBranch ? { defaultBranch } : {}),
  };
}

export async function readWorkspaceGitWorkingTree(
  workspaceRoot: string,
): Promise<GitWorkingTreeSnapshot> {
  return readGitWorkingTreeChanges(workspaceRoot);
}

export async function readWorkspaceGitHistory(
  workspaceRoot: string,
  request: ReadGitHistoryRequest = {},
): Promise<GitHistorySnapshot> {
  const page = await readGitCommitHistory(workspaceRoot, {
    maxCount: request.maxCount,
    skip: request.skip,
  });
  if (
    request.existingLogCommits &&
    request.existingLogCommits.length > 0 &&
    page.isRepository
  ) {
    const logCommits = mergeGitLogCommitPages(request.existingLogCommits, page.logCommits);
    return buildGitCommitHistorySnapshot(logCommits, true, page.hasMore);
  }
  return page;
}

export async function createWorkspaceGitWorktree(
  repoRoot: string,
  names: GeneratedWorktreeNames,
  baseBranch: string,
): Promise<{ worktreePath: string; branchName: string }> {
  const worktreePath = buildWorktreeRootPath(repoRoot, names.worktreeName);
  await addGitWorktreeInternal(repoRoot, {
    worktreePath,
    branchName: names.branchName,
    baseBranch,
  });
  return {
    worktreePath,
    branchName: names.branchName,
  };
}

export async function removeWorkspaceGitWorktree(
  repoRoot: string,
  worktreePath: string,
): Promise<void> {
  await removeGitWorktreeInternal(repoRoot, worktreePath, { force: true });
}

export async function pushWorkspaceGitBranch(workspaceRoot: string): Promise<void> {
  try {
    await pushGitBranchInternal(workspaceRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace(/^git push .* failed: /u, i18n.t('error.gitPushFailed')));
  }
}

export async function mergeWorktreeBranchToMain(
  primaryRepoRoot: string,
  branchName: string,
): Promise<void> {
  try {
    await mergeSpiritBranchToMainInternal(primaryRepoRoot, branchName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace(/^git merge .* failed: /u, i18n.t('error.gitMergeFailed')));
  }
}

export async function readPrimaryRepoRoot(workspaceRoot: string): Promise<string> {
  return resolvePrimaryRepoRoot(workspaceRoot);
}

export async function checkoutWorkspaceGitBranch(
  workspaceRoot: string,
  branch: string,
  options: GitCheckoutOptions = {},
): Promise<WorkspaceGitSnapshotRead> {
  try {
    await checkoutGitBranchInternal(workspaceRoot, branch, options);
  } catch (error) {
    if (isGitCheckoutBlockedError(error)) {
      const blocked = new Error(i18n.t('error.uncommittedChangesBlockCheckout')) as Error & { code: string };
      blocked.code = 'GIT_CHECKOUT_LOCAL_CHANGES';
      throw blocked;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace(/^git checkout .* failed: /u, i18n.t('error.gitCheckoutFailed')));
  }
  return readWorkspaceGitSnapshot(workspaceRoot);
}

export async function commitWorkspaceChanges(
  workspaceRoot: string,
  message: string,
): Promise<void> {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new Error(i18n.t('error.commitMessageRequired'));
  }

  await runGit(workspaceRoot, ['add', '-A']);
  await runGit(workspaceRoot, [
    'commit',
    ...lines.flatMap((line) => ['-m', line]),
  ]);
}
