import { githubApiHeaders, readGitHubJson } from './github-api.js';
import { GITHUB_API_BASE_URL } from './oauth-config.js';
import type { HostAutomationGitHubEvent } from '../automations.js';

export interface GitHubAutomationIssueItem {
  number: number;
  htmlUrl: string;
  isPullRequest: boolean;
  createdAt: string;
}

interface GitHubIssueApiItem {
  number: number;
  html_url: string;
  created_at?: string | null;
  pull_request?: { url?: string | null } | null;
}

function mapIssueItem(item: GitHubIssueApiItem): GitHubAutomationIssueItem | undefined {
  if (typeof item.number !== 'number' || !Number.isInteger(item.number) || item.number <= 0) {
    return undefined;
  }
  const htmlUrl = item.html_url?.trim();
  if (!htmlUrl) {
    return undefined;
  }
  return {
    number: item.number,
    htmlUrl,
    isPullRequest: Boolean(item.pull_request),
    createdAt: item.created_at?.trim() || new Date(0).toISOString(),
  };
}

export async function listRepositoryIssuesForAutomation(
  accessToken: string,
  owner: string,
  repo: string,
  options?: { sinceNumber?: number; perPage?: number; maxPages?: number },
): Promise<GitHubAutomationIssueItem[]> {
  const sinceNumber = options?.sinceNumber ?? 0;
  const perPage = options?.perPage ?? 100;
  const maxPages = options?.maxPages ?? 10;
  const allItems: GitHubAutomationIssueItem[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(`${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`);
    url.searchParams.set('state', 'all');
    url.searchParams.set('sort', 'created');
    url.searchParams.set('direction', 'desc');
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));

    const response = await fetch(url, { headers: githubApiHeaders(accessToken) });
    const payload = await readGitHubJson<GitHubIssueApiItem[]>(response);
    const pageItems = payload
      .map((item) => mapIssueItem(item))
      .filter((item): item is GitHubAutomationIssueItem => item !== undefined);
    if (pageItems.length === 0) {
      break;
    }
    allItems.push(...pageItems);
    if (!shouldFetchNextIssuePage(pageItems, sinceNumber, perPage)) {
      break;
    }
  }

  return allItems;
}

export function shouldFetchNextIssuePage(
  pageItems: GitHubAutomationIssueItem[],
  sinceNumber: number,
  perPage: number,
): boolean {
  if (pageItems.length === 0) {
    return false;
  }
  const minNumber = Math.min(...pageItems.map((item) => item.number));
  return minNumber > sinceNumber && pageItems.length >= perPage;
}

export async function fetchRepositoryMaxIssueNumber(
  accessToken: string,
  owner: string,
  repo: string,
): Promise<number> {
  const url = new URL(`${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`);
  url.searchParams.set('state', 'all');
  url.searchParams.set('sort', 'created');
  url.searchParams.set('direction', 'desc');
  url.searchParams.set('per_page', '1');

  const response = await fetch(url, { headers: githubApiHeaders(accessToken) });
  const payload = await readGitHubJson<GitHubIssueApiItem[]>(response);
  const first = payload[0];
  if (!first || typeof first.number !== 'number') {
    return 0;
  }
  return first.number;
}

export function matchesGitHubAutomationEvent(
  item: GitHubAutomationIssueItem,
  event: HostAutomationGitHubEvent,
): boolean {
  if (event === 'pull_request_created') {
    return item.isPullRequest;
  }
  return !item.isPullRequest;
}

export function filterNewGitHubAutomationEvents(
  items: GitHubAutomationIssueItem[],
  event: HostAutomationGitHubEvent,
  lastSeenNumber: number,
): GitHubAutomationIssueItem[] {
  return items
    .filter((item) => item.number > lastSeenNumber && matchesGitHubAutomationEvent(item, event))
    .sort((left, right) => left.number - right.number);
}

export function githubAutomationRepoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}
