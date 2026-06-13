import { githubApiHeaders, readGitHubJson } from './github-api.js';
import {
  fetchViewerMergeHeadlineText,
  resolveViewerCanMerge,
} from './pull-request-viewer-merge.js';
import {
  getRepositoryPermissions,
} from './repository-permissions.js';
import { GITHUB_API_BASE_URL } from './oauth-config.js';
import type {
  GitHubPullRequestDetail,
  GitHubPullRequestMergeableState,
  GitHubPullRequestSummary,
  GitHubRepositoryRef,
} from './types.js';

interface GitHubPullRequestApiItem {
  number: number;
  title: string;
  state: 'open' | 'closed';
  html_url: string;
  node_id?: string | null;
  draft?: boolean;
  merged_at?: string | null;
  mergeable?: boolean | null;
  mergeable_state?: string | null;
  body?: string | null;
  user?: { login?: string | null } | null;
  head?: { ref?: string | null; sha?: string | null } | null;
  base?: { ref?: string | null } | null;
  labels?: Array<{ name?: string | null }> | null;
}

export function normalizeMergeableState(
  value: string | null | undefined,
): GitHubPullRequestMergeableState | null {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case 'clean':
    case 'dirty':
    case 'blocked':
    case 'behind':
    case 'unstable':
    case 'draft':
      return normalized;
    case 'has_hooks':
    case 'unknown':
      return 'unknown';
    default:
      return null;
  }
}

function mapPullRequestSummary(item: GitHubPullRequestApiItem): GitHubPullRequestSummary {
  return {
    number: item.number,
    title: item.title,
    state: item.state,
    url: item.html_url,
    authorLogin: item.user?.login?.trim() || 'unknown',
    headRef: item.head?.ref?.trim() || '',
    headSha: item.head?.sha?.trim() || '',
    baseRef: item.base?.ref?.trim() || '',
    draft: Boolean(item.draft),
  };
}

export function mapPullRequestDetail(
  item: GitHubPullRequestApiItem,
  options?: { viewerCanMerge?: boolean },
): GitHubPullRequestDetail {
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
    nodeId: item.node_id?.trim() || '',
    viewerCanMerge: options?.viewerCanMerge ?? false,
    mergeableState: normalizeMergeableState(item.mergeable_state),
  };
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
  const pullUrl = `${GITHUB_API_BASE_URL}/repos/${repository.owner}/${repository.repo}/pulls/${number}`;
  const [pullResponse, permissions, viewerMergeHeadlineText] = await Promise.all([
    fetch(pullUrl, { headers: githubApiHeaders(accessToken) }),
    getRepositoryPermissions(accessToken, repository).catch(() => null),
    fetchViewerMergeHeadlineText(accessToken, repository, number),
  ]);
  const item = await readGitHubJson<GitHubPullRequestApiItem>(pullResponse);
  return mapPullRequestDetail(item, {
    viewerCanMerge: resolveViewerCanMerge(viewerMergeHeadlineText, permissions),
  });
}

export { mapPullRequestSummary };
