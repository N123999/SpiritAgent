import type { DesktopGitHubAutomationRepositoryItem } from "@/types";

type ListCacheEntry = {
  items: DesktopGitHubAutomationRepositoryItem[];
  hasNextPage: boolean;
};

type SearchCacheEntry = {
  items: DesktopGitHubAutomationRepositoryItem[];
  totalCount: number;
};

const listCache = new Map<string, ListCacheEntry>();
const searchCache = new Map<string, SearchCacheEntry>();

function listCacheKey(page = 1): string {
  return String(page);
}

function searchCacheKey(query: string, page = 1): string {
  return `${query}\0${page}`;
}

export function readGitHubAutomationRepositoriesListCache(
  page = 1,
): ListCacheEntry | undefined {
  return listCache.get(listCacheKey(page));
}

export function writeGitHubAutomationRepositoriesListCache(
  entry: ListCacheEntry,
  page = 1,
): void {
  listCache.set(listCacheKey(page), entry);
}

export function readGitHubAutomationRepositoriesSearchCache(
  query: string,
  page = 1,
): SearchCacheEntry | undefined {
  return searchCache.get(searchCacheKey(query, page));
}

export function writeGitHubAutomationRepositoriesSearchCache(
  query: string,
  entry: SearchCacheEntry,
  page = 1,
): void {
  searchCache.set(searchCacheKey(query, page), entry);
}

export function clearGitHubAutomationRepositoriesCache(): void {
  listCache.clear();
  searchCache.clear();
}
