import { githubApiHeaders, githubHasNextPage, readGitHubJson } from './github-api.js';
import { commitSubject } from './commit-subject.js';
import { GITHUB_API_BASE_URL } from './oauth-config.js';
import type {
  GitHubPullRequestCommit,
  GitHubPullRequestCommitsSnapshot,
  GitHubRepositoryRef,
} from './types.js';

const COMMITS_PAGE_SIZE = 100;

interface GitHubUserRef {
  login?: string | null;
  avatar_url?: string | null;
}

interface GitHubPullRequestCommitApiItem {
  sha?: string | null;
  html_url?: string | null;
  commit?: {
    message?: string | null;
    author?: {
      name?: string | null;
      date?: string | null;
    } | null;
  } | null;
  author?: GitHubUserRef | null;
}

function resolveLogin(user: GitHubUserRef | null | undefined, fallbackName: string): string {
  const login = user?.login?.trim();
  if (login) {
    return login;
  }
  const name = fallbackName.trim();
  return name || 'unknown';
}

function resolveAvatarUrl(user: GitHubUserRef | null | undefined, login: string): string {
  const url = user?.avatar_url?.trim();
  if (url) {
    return url;
  }
  return `https://github.com/${login}.png?size=40`;
}

export function mapPullRequestCommit(
  item: GitHubPullRequestCommitApiItem,
): GitHubPullRequestCommit | null {
  const sha = item.sha?.trim();
  if (!sha) {
    return null;
  }

  const message = item.commit?.message ?? '';
  const authorName = item.commit?.author?.name?.trim() || '';
  const authorLogin = resolveLogin(item.author, authorName);
  const createdAt = item.commit?.author?.date?.trim() || new Date(0).toISOString();
  const url = item.html_url?.trim() || '';

  return {
    sha,
    subject: commitSubject(message),
    authorLogin,
    avatarUrl: resolveAvatarUrl(item.author, authorLogin),
    createdAt,
    ...(url ? { url } : {}),
  };
}

export function mapPullRequestCommits(
  items: GitHubPullRequestCommitApiItem[],
): GitHubPullRequestCommit[] {
  return items
    .map((item) => mapPullRequestCommit(item))
    .filter((item): item is GitHubPullRequestCommit => item != null);
}

export interface GetPullRequestCommitsOptions {
  page?: number;
  perPage?: number;
}

export async function getPullRequestCommits(
  accessToken: string,
  repository: GitHubRepositoryRef,
  number: number,
  options: GetPullRequestCommitsOptions = {},
): Promise<GitHubPullRequestCommitsSnapshot> {
  const page = options.page ?? 1;
  const perPage = options.perPage ?? COMMITS_PAGE_SIZE;
  const params = new URLSearchParams({
    per_page: String(perPage),
    page: String(page),
  });
  const url = `${GITHUB_API_BASE_URL}/repos/${repository.owner}/${repository.repo}/pulls/${number}/commits?${params.toString()}`;
  const response = await fetch(url, { headers: githubApiHeaders(accessToken) });
  const items = await readGitHubJson<GitHubPullRequestCommitApiItem[]>(response);

  return {
    commits: mapPullRequestCommits(items),
    hasMore: githubHasNextPage(response),
  };
}
