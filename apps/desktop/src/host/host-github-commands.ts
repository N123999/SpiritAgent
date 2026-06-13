import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  findOpenPullRequestForHead,
  getPullRequestConversation,
  getPullRequestDetail,
  getPullRequestFiles,
  getPullRequestCommits,
  getPullRequestChecks,
  GitHubOAuthError,
  parseGitHubRemoteUrl,
  type GitHubAuthStatus,
  type GitHubDeviceAuthChallenge,
  type GitHubPullRequestConversationSnapshot,
  type GitHubPullRequestDetail,
  type GitHubPullRequestFilesSnapshot,
  type GitHubPullRequestCommitsSnapshot,
  type GitHubPullRequestChecksSnapshot,
  type GitHubPullRequestForBranchResult,
} from '@spirit-agent/host-internal';

import type { DesktopGitSnapshot, GetGitHubPullRequestDetailRequest } from '../types.js';
import {
  clearGitHubOAuthCredentials,
  getGitHubAuthStatusFromStorage,
  loadGitHubAccessToken,
} from './github-auth-storage.js';
import {
  beginGitHubDeviceLogin,
  cancelGitHubDeviceLogin,
  completeGitHubDeviceLogin,
} from './github-oauth-bridge.js';

const execFileAsync = promisify(execFile);

export interface HostGitHubCommandContext {
  workspaceRoot: string;
  git: DesktopGitSnapshot;
}

export async function getGitHubAuthStatusCommand(): Promise<GitHubAuthStatus> {
  return getGitHubAuthStatusFromStorage();
}

export async function beginGitHubDeviceLoginCommand(): Promise<GitHubDeviceAuthChallenge> {
  return beginGitHubDeviceLogin();
}

export async function completeGitHubDeviceLoginCommand(): Promise<GitHubAuthStatus> {
  const result = await completeGitHubDeviceLogin();
  return {
    connected: true,
    login: result.login,
  };
}

export function cancelGitHubDeviceLoginCommand(): void {
  cancelGitHubDeviceLogin();
}

export async function disconnectGitHubCommand(): Promise<GitHubAuthStatus> {
  cancelGitHubDeviceLogin();
  await clearGitHubOAuthCredentials();
  return { connected: false };
}

async function readGitOriginRemoteUrl(workspaceRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      cwd: workspaceRoot,
      windowsHide: true,
    });
    const trimmed = stdout.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function resolveCurrentBranch(git: DesktopGitSnapshot): string | null {
  const branch = git.selectedBranch?.trim() || git.branch?.trim();
  return branch || null;
}

async function handleGitHubApiError(error: unknown): Promise<Error> {
  if (!(error instanceof GitHubOAuthError)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  if (error.status === 401) {
    await clearGitHubOAuthCredentials();
    return new Error('GitHub authentication expired or is invalid. Connect GitHub again.');
  }
  if (error.status === 403) {
    await clearGitHubOAuthCredentials();
    return new Error(
      'GitHub denied access. If this repository belongs to an organization with SSO, authorize the token for that organization on GitHub.',
    );
  }
  return error;
}

async function requireGitHubAccessToken(): Promise<string> {
  const accessToken = await loadGitHubAccessToken();
  if (!accessToken) {
    throw new Error('Connect GitHub before querying pull requests.');
  }
  return accessToken;
}

export async function getGitHubPullRequestForCurrentBranchCommand(
  ctx: HostGitHubCommandContext,
): Promise<GitHubPullRequestForBranchResult> {
  const branch = resolveCurrentBranch(ctx.git);
  if (!ctx.git.isRepository || !branch) {
    return {
      repository: null,
      branch,
      pullRequest: null,
    };
  }

  const remoteUrl = await readGitOriginRemoteUrl(ctx.workspaceRoot);
  const repository = remoteUrl ? parseGitHubRemoteUrl(remoteUrl) : null;
  if (!repository) {
    return {
      repository: null,
      branch,
      pullRequest: null,
    };
  }

  try {
    const accessToken = await requireGitHubAccessToken();
    const pullRequest = await findOpenPullRequestForHead(accessToken, repository, branch);
    return {
      repository,
      branch,
      pullRequest,
    };
  } catch (error) {
    throw await handleGitHubApiError(error);
  }
}

export async function getGitHubPullRequestDetailCommand(
  request: GetGitHubPullRequestDetailRequest,
): Promise<GitHubPullRequestDetail> {
  const owner = request.owner.trim();
  const repo = request.repo.trim();
  const number = request.number;
  if (!owner || !repo || !Number.isFinite(number) || number <= 0) {
    throw new Error('Pull request owner, repository, and number are required.');
  }

  try {
    const accessToken = await requireGitHubAccessToken();
    return await getPullRequestDetail(accessToken, { owner, repo }, number);
  } catch (error) {
    throw await handleGitHubApiError(error);
  }
}

export async function getGitHubPullRequestConversationCommand(
  request: GetGitHubPullRequestDetailRequest,
): Promise<GitHubPullRequestConversationSnapshot> {
  const owner = request.owner.trim();
  const repo = request.repo.trim();
  const number = request.number;
  if (!owner || !repo || !Number.isFinite(number) || number <= 0) {
    throw new Error('Pull request owner, repository, and number are required.');
  }

  try {
    const accessToken = await requireGitHubAccessToken();
    return await getPullRequestConversation(accessToken, { owner, repo }, number);
  } catch (error) {
    throw await handleGitHubApiError(error);
  }
}

export async function getGitHubPullRequestFilesCommand(
  request: GetGitHubPullRequestDetailRequest,
): Promise<GitHubPullRequestFilesSnapshot> {
  const owner = request.owner.trim();
  const repo = request.repo.trim();
  const number = request.number;
  if (!owner || !repo || !Number.isFinite(number) || number <= 0) {
    throw new Error('Pull request owner, repository, and number are required.');
  }

  try {
    const accessToken = await requireGitHubAccessToken();
    return await getPullRequestFiles(accessToken, { owner, repo }, number);
  } catch (error) {
    throw await handleGitHubApiError(error);
  }
}

export async function getGitHubPullRequestCommitsCommand(
  request: GetGitHubPullRequestDetailRequest,
): Promise<GitHubPullRequestCommitsSnapshot> {
  const owner = request.owner.trim();
  const repo = request.repo.trim();
  const number = request.number;
  if (!owner || !repo || !Number.isFinite(number) || number <= 0) {
    throw new Error('Pull request owner, repository, and number are required.');
  }

  try {
    const accessToken = await requireGitHubAccessToken();
    return await getPullRequestCommits(accessToken, { owner, repo }, number);
  } catch (error) {
    throw await handleGitHubApiError(error);
  }
}

export async function getGitHubPullRequestChecksCommand(
  request: GetGitHubPullRequestDetailRequest,
): Promise<GitHubPullRequestChecksSnapshot> {
  const owner = request.owner.trim();
  const repo = request.repo.trim();
  const number = request.number;
  if (!owner || !repo || !Number.isFinite(number) || number <= 0) {
    throw new Error('Pull request owner, repository, and number are required.');
  }

  try {
    const accessToken = await requireGitHubAccessToken();
    return await getPullRequestChecks(accessToken, { owner, repo }, number);
  } catch (error) {
    throw await handleGitHubApiError(error);
  }
}
