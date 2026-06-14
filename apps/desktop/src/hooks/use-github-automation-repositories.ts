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
  const fetchGenerationRef = useRef(0);

  useEffect(() => {
    const timerId = window.setTimeout(
      () => setDebouncedQuery(query.trim()),
      query.trim() ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => window.clearTimeout(timerId);
  }, [query]);

  const fetchRepositories = useCallback(
    async (searchQuery: string) => {
      const generation = fetchGenerationRef.current;
      setLoading(true);
      try {
        if (searchQuery) {
          const snapshot = await searchGitHubRepositories(searchQuery);
          if (generation !== fetchGenerationRef.current) {
            return;
          }
          writeGitHubAutomationRepositoriesSearchCache(searchQuery, {
            items: snapshot.items,
            totalCount: snapshot.totalCount,
          });
          setItems(snapshot.items);
          return;
        }

        const snapshot = await listGitHubRepositories();
        if (generation !== fetchGenerationRef.current) {
          return;
        }
        writeGitHubAutomationRepositoriesListCache({
          items: snapshot.items,
          hasNextPage: snapshot.hasNextPage,
        });
        setItems(snapshot.items);
      } catch {
        if (generation !== fetchGenerationRef.current) {
          return;
        }
        setItems([]);
      } finally {
        if (generation === fetchGenerationRef.current) {
          setLoading(false);
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

    if (cached) {
      setItems(cached.items);
      setLoading(false);
      return;
    }

    setItems([]);
    void fetchRepositories(searchQuery);
  }, [debouncedQuery, fetchRepositories, open]);

  return {
    query,
    setQuery,
    items,
    loading,
  };
}
