import { githubApiHeaders, githubHasNextPage, readGitHubJson } from './github-api.js';
import { GITHUB_API_BASE_URL } from './oauth-config.js';

export interface GitHubAutomationRepositoryItem {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
  private: boolean;
  updatedAt: string;
}

interface GitHubUserRepoApiItem {
  name: string;
  full_name: string;
  html_url: string;
  private?: boolean;
  updated_at?: string | null;
  owner?: { login?: string | null } | null;
}

interface GitHubSearchRepositoriesResponse {
  total_count: number;
  items: GitHubUserRepoApiItem[];
}

function mapRepositoryItem(item: GitHubUserRepoApiItem): GitHubAutomationRepositoryItem | undefined {
  const fullName = item.full_name?.trim();
  const name = item.name?.trim();
  const owner = item.owner?.login?.trim() ?? fullName?.split('/')[0]?.trim();
  if (!owner || !name || !fullName) {
    return undefined;
  }
  return {
    owner,
    repo: name,
    fullName,
    htmlUrl: item.html_url?.trim() || `https://github.com/${fullName}`,
    private: item.private === true,
    updatedAt: item.updated_at?.trim() || new Date(0).toISOString(),
  };
}

export async function listUserGitHubRepositories(
  accessToken: string,
  options?: { page?: number; perPage?: number },
): Promise<{ items: GitHubAutomationRepositoryItem[]; hasNextPage: boolean }> {
  const page = options?.page ?? 1;
  const perPage = options?.perPage ?? 100;
  const url = new URL(`${GITHUB_API_BASE_URL}/user/repos`);
  url.searchParams.set('affiliation', 'owner,collaborator,organization_member');
  url.searchParams.set('sort', 'updated');
  url.searchParams.set('direction', 'desc');
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('page', String(page));

  const response = await fetch(url, { headers: githubApiHeaders(accessToken) });
  const payload = await readGitHubJson<GitHubUserRepoApiItem[]>(response);
  const items = payload
    .map((item) => mapRepositoryItem(item))
    .filter((item): item is GitHubAutomationRepositoryItem => item !== undefined);

  return {
    items,
    hasNextPage: githubHasNextPage(response),
  };
}

export async function searchGitHubRepositories(
  accessToken: string,
  query: string,
  login: string,
  options?: { page?: number; perPage?: number },
): Promise<{ items: GitHubAutomationRepositoryItem[]; totalCount: number }> {
  const trimmedQuery = query.trim();
  const page = options?.page ?? 1;
  const perPage = options?.perPage ?? 30;
  const url = new URL(`${GITHUB_API_BASE_URL}/search/repositories`);
  const q = trimmedQuery
    ? `${trimmedQuery} in:name user:${login}`
    : `user:${login}`;
  url.searchParams.set('q', q);
  url.searchParams.set('sort', 'updated');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('page', String(page));

  const response = await fetch(url, { headers: githubApiHeaders(accessToken) });
  const payload = await readGitHubJson<GitHubSearchRepositoriesResponse>(response);
  const items = payload.items
    .map((item) => mapRepositoryItem(item))
    .filter((item): item is GitHubAutomationRepositoryItem => item !== undefined);

  return {
    items,
    totalCount: payload.total_count,
  };
}
