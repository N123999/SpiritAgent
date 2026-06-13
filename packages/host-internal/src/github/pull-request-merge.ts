import { githubApiHeaders, readGitHubJson } from './github-api.js';
import { GITHUB_API_BASE_URL } from './oauth-config.js';
import type {
  GitHubPullRequestMergeMethod,
  GitHubPullRequestMergeResult,
  GitHubRepositoryRef,
} from './types.js';

const MERGE_METHODS = new Set<GitHubPullRequestMergeMethod>(['merge', 'squash', 'rebase']);

export function assertGitHubPullRequestMergeMethod(
  value: string,
): GitHubPullRequestMergeMethod {
  const normalized = value.trim() as GitHubPullRequestMergeMethod;
  if (!MERGE_METHODS.has(normalized)) {
    throw new Error(`Unsupported pull request merge method: ${value}`);
  }
  return normalized;
}

export async function mergePullRequest(
  accessToken: string,
  repository: GitHubRepositoryRef,
  number: number,
  options: { mergeMethod: GitHubPullRequestMergeMethod },
): Promise<GitHubPullRequestMergeResult> {
  const url = `${GITHUB_API_BASE_URL}/repos/${repository.owner}/${repository.repo}/pulls/${number}/merge`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: githubApiHeaders(accessToken),
    body: JSON.stringify({ merge_method: options.mergeMethod }),
  });
  const payload = await readGitHubJson<{ sha?: string | null; merged?: boolean | null }>(response);
  const sha = payload.sha?.trim();
  if (!sha) {
    throw new Error('GitHub merge response did not include a commit SHA.');
  }
  return {
    sha,
    merged: payload.merged !== false,
  };
}
