import { useCallback, useEffect, useRef, useState } from "react";

import {
  readGitHubAutomationRepositoriesListCache,
  readGitHubAutomationRepositoriesSearchCache,
  writeGitHubAutomationRepositoriesListCache,
  writeGitHubAutomationRepositoriesSearchCache,
} from "@/lib/github-automation-repositories-cache";
import type {
  DesktopGitHubAutomationRepositoryItem,
  GitHubAutomationRepositoriesSnapshot,
  SearchGitHubAutomationRepositoriesSnapshot,
} from "@/types";

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_PAGE_SIZE = 30;

type UseGitHubAutomationRepositoriesOptions = {
  open: boolean;
  listGitHubRepositories(page?: number): Promise<GitHubAutomationRepositoriesSnapshot>;
  searchGitHubRepositories(
    query: string,
    page?: number,
  ): Promise<SearchGitHubAutomationRepositoriesSnapshot>;
};

export function useGitHubAutomationRepositories({
  open,
  listGitHubRepositories,
  searchGitHubRepositories,
}: UseGitHubAutomationRepositoriesOptions) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [items, setItems] = useState<DesktopGitHubAutomationRepositoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextPage, setNextPage] = useState<number | undefined>(undefined);
  const [error, setError] = useState(false);
  const fetchGenerationRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);

  useEffect(() => {
    const timerId = window.setTimeout(
      () => setDebouncedQuery(query.trim()),
      query.trim() ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => window.clearTimeout(timerId);
  }, [query]);

  const fetchPage = useCallback(
    async (searchQuery: string, page: number, append: boolean) => {
      const generation = fetchGenerationRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        if (searchQuery) {
          const snapshot = await searchGitHubRepositories(searchQuery, page);
          if (generation !== fetchGenerationRef.current) {
            return;
          }
          writeGitHubAutomationRepositoriesSearchCache(searchQuery, {
            items: snapshot.items,
            totalCount: snapshot.totalCount,
          }, page);
          let nextLength = 0;
          setItems((current) => {
            const nextItems = append ? [...current, ...snapshot.items] : snapshot.items;
            nextLength = nextItems.length;
            return nextItems;
          });
          const hasMoreSearch =
            snapshot.items.length >= SEARCH_PAGE_SIZE && nextLength < snapshot.totalCount;
          setHasMore(hasMoreSearch);
          setNextPage(hasMoreSearch ? page + 1 : undefined);
          setError(false);
          return;
        }

        const snapshot = await listGitHubRepositories(page);
        if (generation !== fetchGenerationRef.current) {
          return;
        }
        writeGitHubAutomationRepositoriesListCache(
          {
            items: snapshot.items,
            hasNextPage: snapshot.hasNextPage,
          },
          page,
        );
        setItems((current) => (append ? [...current, ...snapshot.items] : snapshot.items));
        setHasMore(snapshot.hasNextPage);
        setNextPage(snapshot.hasNextPage ? page + 1 : undefined);
        setError(false);
      } catch {
        if (generation !== fetchGenerationRef.current) {
          return;
        }
        if (!append) {
          setItems([]);
          setHasMore(false);
          setNextPage(undefined);
          setError(true);
        }
      } finally {
        if (generation === fetchGenerationRef.current) {
          setLoading(false);
          setLoadingMore(false);
          loadMoreInFlightRef.current = false;
        }
      }
    },
    [listGitHubRepositories, searchGitHubRepositories],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    fetchGenerationRef.current += 1;
    const searchQuery = debouncedQuery;
    const cached = searchQuery
      ? readGitHubAutomationRepositoriesSearchCache(searchQuery)
      : readGitHubAutomationRepositoriesListCache();

    if (cached && !searchQuery) {
      const listCached = cached as { items: DesktopGitHubAutomationRepositoryItem[]; hasNextPage: boolean };
      setItems(listCached.items);
      setHasMore(listCached.hasNextPage);
      setNextPage(listCached.hasNextPage ? 2 : undefined);
      setLoading(false);
      setLoadingMore(false);
      setError(false);
      return;
    }

    if (cached && searchQuery) {
      const searchCached = cached as { items: DesktopGitHubAutomationRepositoryItem[]; totalCount: number };
      setItems(searchCached.items);
      const hasMoreSearch =
        searchCached.items.length >= SEARCH_PAGE_SIZE
        && searchCached.items.length < searchCached.totalCount;
      setHasMore(hasMoreSearch);
      setNextPage(hasMoreSearch ? 2 : undefined);
      setLoading(false);
      setLoadingMore(false);
      setError(false);
      return;
    }

    setItems([]);
    setHasMore(false);
    setNextPage(undefined);
    setError(false);
    void fetchPage(searchQuery, 1, false);
  }, [debouncedQuery, fetchPage, open]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading || !nextPage || loadMoreInFlightRef.current) {
      return;
    }
    loadMoreInFlightRef.current = true;
    void fetchPage(debouncedQuery, nextPage, true);
  }, [debouncedQuery, fetchPage, hasMore, loading, loadingMore, nextPage]);

  return {
    query,
    setQuery,
    items,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    error,
  };
}
