import { githubApiHeaders, githubHasNextPage, readGitHubJson } from './github-api.js';
import { GITHUB_API_BASE_URL } from './oauth-config.js';
import type {
  GitHubPullRequestChangedFile,
  GitHubPullRequestFileStatus,
  GitHubPullRequestFilesSnapshot,
  GitHubRepositoryRef,
} from './types.js';

const FILES_PAGE_SIZE = 100;

interface GitHubPullRequestFileApiItem {
  filename?: string | null;
  status?: string | null;
  previous_filename?: string | null;
  additions?: number | null;
  deletions?: number | null;
  changes?: number | null;
  patch?: string | null;
  blob_url?: string | null;
  raw_url?: string | null;
}

function normalizeFileStatus(status: string | null | undefined): GitHubPullRequestFileStatus {
  switch (status?.trim().toLowerCase()) {
    case 'added':
      return 'added';
    case 'removed':
      return 'removed';
    case 'modified':
      return 'modified';
    case 'renamed':
      return 'renamed';
    case 'copied':
      return 'copied';
    case 'changed':
      return 'changed';
    case 'unchanged':
      return 'unchanged';
    default:
      return 'modified';
  }
}

export function mapPullRequestChangedFile(
  item: GitHubPullRequestFileApiItem,
): GitHubPullRequestChangedFile | null {
  const filename = item.filename?.trim();
  if (!filename) {
    return null;
  }

  const previousFilename = item.previous_filename?.trim();
  const patch = item.patch?.trim();

  return {
    filename,
    status: normalizeFileStatus(item.status),
    ...(previousFilename ? { previousFilename } : {}),
    additions: item.additions ?? 0,
    deletions: item.deletions ?? 0,
    changes: item.changes ?? 0,
    ...(patch ? { patch } : {}),
    ...(item.blob_url?.trim() ? { blobUrl: item.blob_url.trim() } : {}),
    ...(item.raw_url?.trim() ? { rawUrl: item.raw_url.trim() } : {}),
  };
}

export function mapPullRequestChangedFiles(
  items: GitHubPullRequestFileApiItem[],
): GitHubPullRequestChangedFile[] {
  return items
    .map((item) => mapPullRequestChangedFile(item))
    .filter((item): item is GitHubPullRequestChangedFile => item != null);
}

export interface GetPullRequestFilesOptions {
  page?: number;
  perPage?: number;
}

export async function getPullRequestFiles(
  accessToken: string,
  repository: GitHubRepositoryRef,
  number: number,
  options: GetPullRequestFilesOptions = {},
): Promise<GitHubPullRequestFilesSnapshot> {
  const page = options.page ?? 1;
  const perPage = options.perPage ?? FILES_PAGE_SIZE;
  const params = new URLSearchParams({
    per_page: String(perPage),
    page: String(page),
  });
  const url = `${GITHUB_API_BASE_URL}/repos/${repository.owner}/${repository.repo}/pulls/${number}/files?${params.toString()}`;
  const response = await fetch(url, { headers: githubApiHeaders(accessToken) });
  const items = await readGitHubJson<GitHubPullRequestFileApiItem[]>(response);

  return {
    files: mapPullRequestChangedFiles(items),
    hasMore: githubHasNextPage(response),
  };
}
