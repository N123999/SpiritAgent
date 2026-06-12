import { GITHUB_API_BASE_URL } from './oauth-config.js';
import { GitHubOAuthError } from './oauth.js';
import type {
  GitHubPullRequestDetail,
  GitHubPullRequestSummary,
  GitHubRepositoryRef,
} from './types.js';

interface GitHubPullRequestApiItem {
  number: number;
  title: string;
  state: 'open' | 'closed';
  html_url: string;
  draft?: boolean;
  merged_at?: string | null;
  mergeable?: boolean | null;
  body?: string | null;
  user?: { login?: string | null } | null;
  head?: { ref?: string | null } | null;
  base?: { ref?: string | null } | null;
  labels?: Array<{ name?: string | null }> | null;
}

function githubApiHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function mapPullRequestSummary(item: GitHubPullRequestApiItem): GitHubPullRequestSummary {
  return {
    number: item.number,
    title: item.title,
    state: item.state,
    url: item.html_url,
    authorLogin: item.user?.login?.trim() || 'unknown',
    headRef: item.head?.ref?.trim() || '',
    baseRef: item.base?.ref?.trim() || '',
    draft: Boolean(item.draft),
  };
}

function mapPullRequestDetail(item: GitHubPullRequestApiItem): GitHubPullRequestDetail {
  const summary = mapPullRequestSummary(item);
  const body = item.body?.trim();
  return {
    ...summary,
    ...(body ? { body } : {}),
    labels: (item.labels ?? [])
      .map((label) => label.name?.trim())
      .filter((label): label is string => Boolean(label)),
    mergeable: item.mergeable ?? null,
    merged: Boolean(item.merged_at),
  };
}

async function readGitHubJson<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  let detail = `HTTP ${response.status}`;
  try {
    const payload = (await response.json()) as { message?: string };
    if (payload.message?.trim()) {
      detail = payload.message.trim();
    }
  } catch {
    /* ignore malformed error body */
  }

  throw new GitHubOAuthError(`GitHub API request failed: ${detail}`, response.status);
}

export async function findOpenPullRequestForHead(
  accessToken: string,
  repository: GitHubRepositoryRef,
  branch: string,
): Promise<GitHubPullRequestSummary | null> {
  const params = new URLSearchParams({
    state: 'open',
    head: `${repository.owner}:${branch}`,
    per_page: '1',
  });
  const url = `${GITHUB_API_BASE_URL}/repos/${repository.owner}/${repository.repo}/pulls?${params.toString()}`;
  const response = await fetch(url, { headers: githubApiHeaders(accessToken) });
  const items = await readGitHubJson<GitHubPullRequestApiItem[]>(response);
  const first = items[0];
  return first ? mapPullRequestSummary(first) : null;
}

export async function getPullRequestDetail(
  accessToken: string,
  repository: GitHubRepositoryRef,
  number: number,
): Promise<GitHubPullRequestDetail> {
  const url = `${GITHUB_API_BASE_URL}/repos/${repository.owner}/${repository.repo}/pulls/${number}`;
  const response = await fetch(url, { headers: githubApiHeaders(accessToken) });
  const item = await readGitHubJson<GitHubPullRequestApiItem>(response);
  return mapPullRequestDetail(item);
}

export { mapPullRequestDetail, mapPullRequestSummary };
