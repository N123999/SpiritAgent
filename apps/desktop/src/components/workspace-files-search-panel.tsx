import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  FileText,
  LoaderCircle,
  Regex,
  Search,
  WholeWord,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DESKTOP_CHROME_TOGGLE_ICON_BTN, DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL } from "@/lib/desktop-chrome";
import { resolveWorkspaceFilesTabIcon } from "@/lib/workspace-explorer-icon";
import { normalizeWorkspaceEntryRel } from "@/lib/workspace-entry-path-sync";
import {
  groupWorkspaceSearchMatches,
  truncateSearchLinePreview,
} from "@/lib/workspace-files-search";
import type { EditorFileRevealLocation } from "@/lib/workspace-editor-navigation";
import { cn } from "@/lib/utils";
import type {
  WorkspaceContentSearchMatch,
  WorkspaceContentSearchRequest,
  WorkspaceContentSearchResult,
} from "@/types";

function pathBasename(rel: string): string {
  const n = rel.replace(/\\/g, "/");
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) || rel : rel;
}

export type WorkspaceFilesSearchPanelProps = {
  searchWorkspaceContent: (
    request: WorkspaceContentSearchRequest,
  ) => Promise<WorkspaceContentSearchResult>;
  onOpenSearchMatch: (
    relativePath: string,
    reveal: EditorFileRevealLocation,
  ) => void;
  onSearchSessionChange?: (session: {
    query: string;
    matchesByPath: Map<string, WorkspaceContentSearchMatch[]>;
  } | null) => void;
};

const SEARCH_DEBOUNCE_MS = 300;

export function WorkspaceFilesSearchPanel({
  searchWorkspaceContent,
  onOpenSearchMatch,
  onSearchSessionChange,
}: WorkspaceFilesSearchPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [isRegexp, setIsRegexp] = useState(false);
  const [matches, setMatches] = useState<WorkspaceContentSearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery) {
      setMatches([]);
      setSearchError("");
      setSearching(false);
      onSearchSessionChange?.(null);
      return;
    }

    let cancelled = false;
    setSearching(true);
    setSearchError("");

    void searchWorkspaceContent({
      query: debouncedQuery,
      caseSensitive,
      wholeWord,
      isRegexp,
    })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setMatches(result.matches);
        const matchesByPath = new Map<string, WorkspaceContentSearchMatch[]>();
        for (const group of groupWorkspaceSearchMatches(result.matches)) {
          matchesByPath.set(group.relativePath, group.matches);
        }
        onSearchSessionChange?.({ query: debouncedQuery, matchesByPath });
        setExpandedPaths(new Set(matchesByPath.keys()));
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setMatches([]);
        onSearchSessionChange?.(null);
        setSearchError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setSearching(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    caseSensitive,
    debouncedQuery,
    isRegexp,
    onSearchSessionChange,
    searchWorkspaceContent,
    wholeWord,
  ]);

  const groups = useMemo(() => groupWorkspaceSearchMatches(matches), [matches]);

  const toggleExpanded = useCallback((relativePath: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(relativePath)) {
        next.delete(relativePath);
      } else {
        next.add(relativePath);
      }
      return next;
    });
  }, []);

  const openMatch = useCallback(
    (match: WorkspaceContentSearchMatch) => {
      const column = (match.submatches[0]?.start ?? 0) + 1;
      onOpenSearchMatch(match.relativePath, {
        line: match.lineNumber,
        column,
      });
    },
    [onOpenSearchMatch],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="shrink-0 px-2 pb-2 pt-1">
        <div className={cn("relative", DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL)}>
          <Search
            className="pointer-events-none absolute left-2 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("workspace.fileSearchPlaceholder")}
            className="h-8 rounded-none border-0 bg-transparent pl-8 pr-[5.5rem] text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
            aria-label={t("workspace.fileSearch")}
          />
          <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(DESKTOP_CHROME_TOGGLE_ICON_BTN, caseSensitive && "bg-muted/60")}
              aria-pressed={caseSensitive}
              title={t("workspace.matchCase")}
              aria-label={t("workspace.matchCase")}
              onClick={() => setCaseSensitive((value) => !value)}
            >
              <CaseSensitive className="size-3.5" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(DESKTOP_CHROME_TOGGLE_ICON_BTN, wholeWord && "bg-muted/60")}
              aria-pressed={wholeWord}
              title={t("workspace.matchWholeWord")}
              aria-label={t("workspace.matchWholeWord")}
              onClick={() => setWholeWord((value) => !value)}
            >
              <WholeWord className="size-3.5" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(DESKTOP_CHROME_TOGGLE_ICON_BTN, isRegexp && "bg-muted/60")}
              aria-pressed={isRegexp}
              title={t("workspace.useRegex")}
              aria-label={t("workspace.useRegex")}
              onClick={() => setIsRegexp((value) => !value)}
            >
              <Regex className="size-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {searching ? (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            {t("workspace.fileSearchSearching")}
          </div>
        ) : null}
        {searchError ? (
          <p className="px-3 py-2 text-xs text-destructive/90">{searchError}</p>
        ) : null}
        {!searching && !searchError && debouncedQuery && groups.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">{t("workspace.fileSearchNoResults")}</p>
        ) : null}
        {!debouncedQuery ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">{t("workspace.fileSearchPlaceholder")}</p>
        ) : null}

        <ScrollArea className="h-full min-h-0 w-full">
          <ul className="space-y-1 px-1 pb-2">
            {groups.map((group) => {
              const normalizedPath = normalizeWorkspaceEntryRel(group.relativePath);
              const expanded = expandedPaths.has(normalizedPath);
              const Icon = resolveWorkspaceFilesTabIcon(pathBasename(group.relativePath)) ?? FileText;
              return (
                <li key={normalizedPath}>
                  <button
                    type="button"
                    className="flex w-full min-w-0 items-center gap-1 rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
                    onClick={() => toggleExpanded(normalizedPath)}
                  >
                    {expanded ? (
                      <ChevronDown className="size-3 shrink-0 opacity-70" aria-hidden />
                    ) : (
                      <ChevronRight className="size-3 shrink-0 opacity-70" aria-hidden />
                    )}
                    <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {pathBasename(group.relativePath)}
                    </span>
                    <span className="shrink-0 text-muted-foreground">{group.matches.length}</span>
                  </button>
                  {expanded ? (
                    <ul className="mb-1 ml-5 border-l border-border/40 pl-2">
                      {group.matches.map((match) => {
                        const segments = truncateSearchLinePreview(match.lineText, match.submatches);
                        return (
                          <li key={`${match.lineNumber}:${match.submatches[0]?.start ?? 0}`}>
                            <button
                              type="button"
                              className="flex w-full min-w-0 items-baseline gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
                              onClick={() => openMatch(match)}
                            >
                              <span className="w-8 shrink-0 text-muted-foreground tabular-nums">
                                {match.lineNumber}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-relaxed">
                                {segments.map((segment, index) =>
                                  segment.highlighted ? (
                                    <mark
                                      key={index}
                                      className="rounded-sm bg-primary/20 text-foreground"
                                    >
                                      {segment.text}
                                    </mark>
                                  ) : (
                                    <span key={index}>{segment.text}</span>
                                  ),
                                )}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </div>
    </div>
  );
}
