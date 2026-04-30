import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { DesktopCommitMode, DesktopGitSnapshot } from '../types.js';

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
    throw new Error(`git ${args.join(' ')} 失败：${message}`);
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

async function readBranchName(workspaceRoot: string): Promise<string | undefined> {
  const { stdout } = await runGit(workspaceRoot, ['branch', '--show-current']);
  const branch = stdout.trim();
  return branch || undefined;
}

export async function readWorkspaceGitSnapshot(
  workspaceRoot: string,
): Promise<DesktopGitSnapshot> {
  try {
    const [{ stdout: repoFlag }, { stdout: statusOutput }, branch] = await Promise.all([
      runGit(workspaceRoot, ['rev-parse', '--is-inside-work-tree']),
      runGit(workspaceRoot, ['status', '--porcelain', '--untracked-files=all']),
      readBranchName(workspaceRoot),
    ]);

    if (repoFlag.trim() !== 'true') {
      return {
        isRepository: false,
        hasChanges: false,
      };
    }

    return {
      isRepository: true,
      hasChanges: statusOutput.trim().length > 0,
      ...(branch ? { branch } : {}),
    };
  } catch {
    return {
      isRepository: false,
      hasChanges: false,
    };
  }
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
    throw new Error('提交信息不能为空。');
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