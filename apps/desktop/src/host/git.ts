import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import i18n from '@/lib/i18n';
import {
  addGitWorktree as addGitWorktreeInternal,
  checkoutGitBranch as checkoutGitBranchInternal,
  buildWorktreeRootPath,
  isGitCheckoutBlockedError,
  mergeSpiritBranchToMain as mergeSpiritBranchToMainInternal,
  readGitWorkspaceSnapshot,
  readWorktreeContext,
  resolveDefaultBranch,
  resolvePrimaryRepoRoot,
  type GitCheckoutOptions,
} from '@spirit-agent/host-internal';

import type { DesktopCommitMode, DesktopGitSnapshot } from '../types.js';
import type { GeneratedWorktreeNames } from './worktree-naming.js';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 4 * 1024 * 1024;

export interface WorkspaceGitCommitMessageContext {
  statusText: string;
  diffStatText: string;
  diffText: string;
}

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

function truncateChars(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }
  return `${chars.slice(0, maxChars).join('')}\n...<truncated>`;
}

export async function readWorkspaceGitSnapshot(
  workspaceRoot: string,
): Promise<DesktopGitSnapshot> {
  const snapshot = await readGitWorkspaceSnapshot(workspaceRoot);
  const worktreeContext = await readWorktreeContext(workspaceRoot);
  const defaultBranch = worktreeContext.isWorktree && worktreeContext.repoRoot
    ? await resolveDefaultBranch(worktreeContext.repoRoot).catch(() => undefined)
    : undefined;

  return {
    isRepository: snapshot.isRepository,
    hasChanges: snapshot.hasChanges,
    branches: snapshot.branches,
    ...(snapshot.branch ? { branch: snapshot.branch } : {}),
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
): Promise<DesktopGitSnapshot> {
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

export async function buildWorkspaceGitCommitMessageContext(
  workspaceRoot: string,
): Promise<WorkspaceGitCommitMessageContext> {
  const [status, diffStat, diff] = await Promise.all([
    runGit(workspaceRoot, ['status', '--short', '--branch', '--untracked-files=all']),
    runGit(workspaceRoot, ['diff', '--no-ext-diff', '--stat', 'HEAD']),
    runGit(workspaceRoot, ['diff', '--no-ext-diff', '--no-color', 'HEAD']),
  ]);

  return {
    statusText: truncateChars(status.stdout.trim(), 8_000),
    diffStatText: truncateChars(diffStat.stdout.trim(), 8_000),
    diffText: truncateChars(diff.stdout.trim(), 24_000),
  };
}

export async function commitWorkspaceChanges(
  workspaceRoot: string,
  message: string,
  mode: DesktopCommitMode,
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

  if (mode === 'commit-and-push') {
    await runGit(workspaceRoot, ['push']);
  }
}
