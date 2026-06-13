import { githubApiHeaders, githubHasNextPage, readGitHubJson } from './github-api.js';
import { executeGitHubGraphQL } from './github-graphql.js';
import { parsePullRequestBodyTaskListProgress } from './pull-request-body-task-list.js';
import { mapPullRequestSummary } from './pull-request.js';
import { GITHUB_API_BASE_URL } from './oauth-config.js';
import type {
  GitHubListPullRequestsRequest,
  GitHubPullRequestListItem,
  GitHubPullRequestListSnapshot,
  GitHubPullRequestListState,
  GitHubPullRequestTabCounts,
  GitHubRepositoryRef,
} from './types.js';

const DEFAULT_PER_PAGE = 30;

interface GitHubPullRequestListApiItem {
  number: number;
  title: string;
  state: 'open' | 'closed';
  html_url: string;
  node_id?: string | null;
  draft?: boolean;
  merged_at?: string | null;
  body?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  user?: { login?: string | null; avatar_url?: string | null } | null;
  head?: { ref?: string | null; sha?: string | null } | null;
  base?: { ref?: string | null } | null;
}

interface GitHubSearchIssueApiItem {
  number: number;
  title: string;
  state: 'open' | 'closed';
  html_url: string;
  body?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  user?: { login?: string | null; avatar_url?: string | null } | null;
  pull_request?: { url?: string | null; merged_at?: string | null } | null;
}

interface GitHubSearchIssuesResponse {
  total_count: number;
  items: GitHubSearchIssueApiItem[];
}

export function buildPullRequestSearchQuery(
  repository: GitHubRepositoryRef,
  state: GitHubPullRequestListState,
  query: string,
): string {
  const trimmedQuery = query.trim();
  const parts = [`repo:${repository.owner}/${repository.repo}`, 'is:pr', `state:${state}`];
  if (trimmedQuery) {
    parts.push(trimmedQuery);
  }
  return parts.join(' ');
}

export function mapPullRequestListItem(item: GitHubPullRequestListApiItem): GitHubPullRequestListItem {
  const summary = mapPullRequestSummary(item);
  const body = item.body ?? null;
  return {
    ...summary,
    merged: Boolean(item.merged_at),
    createdAt: item.created_at?.trim() || new Date(0).toISOString(),
    updatedAt: item.updated_at?.trim() || item.created_at?.trim() || new Date(0).toISOString(),
    ...(item.user?.avatar_url?.trim()
      ? { authorAvatarUrl: item.user.avatar_url.trim() }
      : {}),
    taskListProgress: parsePullRequestBodyTaskListProgress(body),
  };
}

function mapSearchIssueToListItem(item: GitHubSearchIssueApiItem): GitHubPullRequestListItem | null {
  if (!item.pull_request) {
    return null;
  }

  return mapPullRequestListItem({
    number: item.number,
    title: item.title,
    state: item.state,
    html_url: item.html_url,
    body: item.body ?? null,
    created_at: item.created_at ?? null,
    updated_at: item.updated_at ?? null,
    user: item.user ?? null,
    merged_at: item.pull_request?.merged_at ?? null,
    head: { ref: '', sha: '' },
    base: { ref: '' },
  });
}

async function listPullRequestsFromRest(
  accessToken: string,
  repository: GitHubRepositoryRef,
  state: GitHubPullRequestListState,
  page: number,
  perPage: number,
): Promise<GitHubPullRequestListSnapshot> {
  const params = new URLSearchParams({
    state,
    page: String(page),
    per_page: String(perPage),
    sort: 'updated',
    direction: 'desc',
  });
  const url = `${GITHUB_API_BASE_URL}/repos/${repository.owner}/${repository.repo}/pulls?${params.toString()}`;
  const response = await fetch(url, { headers: githubApiHeaders(accessToken) });
  const items = await readGitHubJson<GitHubPullRequestListApiItem[]>(response);

  const hasMore = githubHasNextPage(response);
  return {
    items: items.map(mapPullRequestListItem),
    totalCount: items.length,
    hasMore,
    ...(hasMore ? { nextPage: page + 1 } : {}),
  };
}

async function searchPullRequests(
  accessToken: string,
  repository: GitHubRepositoryRef,
  state: GitHubPullRequestListState,
  query: string,
  page: number,
  perPage: number,
): Promise<GitHubPullRequestListSnapshot> {
  const params = new URLSearchParams({
    q: buildPullRequestSearchQuery(repository, state, query),
    page: String(page),
    per_page: String(perPage),
    sort: 'updated',
    order: 'desc',
  });
  const url = `${GITHUB_API_BASE_URL}/search/issues?${params.toString()}`;
  const response = await fetch(url, { headers: githubApiHeaders(accessToken) });
  const payload = await readGitHubJson<GitHubSearchIssuesResponse>(response);

  const hasMore = githubHasNextPage(response);
  return {
    items: payload.items
      .map(mapSearchIssueToListItem)
      .filter((item): item is GitHubPullRequestListItem => item != null),
    totalCount: payload.total_count,
    hasMore,
    ...(hasMore ? { nextPage: page + 1 } : {}),
  };
}

export async function listPullRequests(
  accessToken: string,
  request: GitHubListPullRequestsRequest,
): Promise<GitHubPullRequestListSnapshot> {
  const repository: GitHubRepositoryRef = {
    owner: request.owner.trim(),
    repo: request.repo.trim(),
  };
  const page = request.page && request.page > 0 ? request.page : 1;
  const query = request.query?.trim() ?? '';

  if (query) {
    return searchPullRequests(accessToken, repository, request.state, query, page, DEFAULT_PER_PAGE);
  }

  const snapshot = await listPullRequestsFromRest(
    accessToken,
    repository,
    request.state,
    page,
    DEFAULT_PER_PAGE,
  );

  if (page === 1) {
    const counts = await getPullRequestTabCounts(accessToken, repository).catch(() => null);
    if (counts) {
      snapshot.totalCount = request.state === 'open' ? counts.open : counts.closed;
    }
  }

  return snapshot;
}

export async function getPullRequestTabCounts(
  accessToken: string,
  repository: GitHubRepositoryRef,
): Promise<GitHubPullRequestTabCounts> {
  const query = `
    query PullRequestTabCounts($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        openPullRequests: pullRequests(states: OPEN) {
          totalCount
        }
        closedPullRequests: pullRequests(states: CLOSED) {
          totalCount
        }
      }
    }
  `;

  const data = await executeGitHubGraphQL<{
    repository?: {
      openPullRequests?: { totalCount?: number | null } | null;
      closedPullRequests?: { totalCount?: number | null } | null;
    } | null;
  }>(accessToken, query, {
    owner: repository.owner,
    repo: repository.repo,
  });

  return {
    open: data.repository?.openPullRequests?.totalCount ?? 0,
    closed: data.repository?.closedPullRequests?.totalCount ?? 0,
  };
}
