import { useCallback, useEffect, useMemo, useRef, useState, memo, type ComponentRef } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  Regex,
  WholeWord,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DESKTOP_OVERLAY_LIST_FILTER_INPUT_SHELL, instantHoverMotionClass } from "@/lib/desktop-chrome";
import { scrollAreaViewport } from "@/lib/scroll-area-viewport";
import { WorkspaceFileIcon } from "@/components/workspace-file-icon";
import { resolveWorkspaceFilesTabIcon } from "@/lib/workspace-explorer-icon";
import { normalizeWorkspaceEntryRel } from "@/lib/workspace-entry-path-sync";
import {
  groupWorkspaceSearchMatches,
  ripgrepSubmatchToCodeUnitRange,
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

const SEARCH_OPTION_TOGGLE_BTN = cn(
  "electron-no-drag size-7 shrink-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-muted/50 hover:text-foreground",
  "aria-pressed:bg-muted/35 aria-pressed:text-foreground aria-pressed:hover:bg-muted/50",
  "[&_svg]:size-3.5",
  instantHoverMotionClass,
);

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
const SEARCH_VIRTUAL_ROW_ESTIMATE_PX = 26;

type WorkspaceSearchVirtualRow =
  | {
      kind: "header";
      normalizedPath: string;
      relativePath: string;
      matchCount: number;
    }
  | {
      kind: "match";
      normalizedPath: string;
      match: WorkspaceContentSearchMatch;
      matchKey: string;
    };

function buildWorkspaceSearchVirtualRows(
  groups: ReturnType<typeof groupWorkspaceSearchMatches>,
  expandedPaths: ReadonlySet<string>,
): WorkspaceSearchVirtualRow[] {
  const rows: WorkspaceSearchVirtualRow[] = [];
  for (const group of groups) {
    const normalizedPath = normalizeWorkspaceEntryRel(group.relativePath);
    rows.push({
      kind: "header",
      normalizedPath,
      relativePath: group.relativePath,
      matchCount: group.matches.length,
    });
    if (!expandedPaths.has(normalizedPath)) {
      continue;
    }
    for (const match of group.matches) {
      rows.push({
        kind: "match",
        normalizedPath,
        match,
        matchKey: `${normalizedPath}:${match.lineNumber}:${match.submatches[0]?.start ?? 0}`,
      });
    }
  }
  return rows;
}

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
  const [resultsTruncated, setResultsTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const scrollAreaRef = useRef<ComponentRef<typeof ScrollArea>>(null);
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery) {
      setMatches([]);
      setResultsTruncated(false);
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
        setResultsTruncated(result.truncated === true);
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
        setResultsTruncated(false);
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

  const virtualRows = useMemo(
    () => buildWorkspaceSearchVirtualRows(groups, expandedPaths),
    [groups, expandedPaths],
  );

  const virtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => scrollAreaViewport(scrollAreaRef.current),
    estimateSize: () => SEARCH_VIRTUAL_ROW_ESTIMATE_PX,
    overscan: 12,
  });

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
      const submatch = match.submatches[0];
      const column = submatch
        ? ripgrepSubmatchToCodeUnitRange(match.lineText, submatch).start + 1
        : 1;
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
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("workspace.fileSearchPlaceholder")}
            className="h-8 rounded-none border-0 bg-transparent pl-2 pr-[5.5rem] text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
            aria-label={t("workspace.fileSearch")}
          />
          <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
            <Tooltip delayDuration={300} disableHoverableContent>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={SEARCH_OPTION_TOGGLE_BTN}
                  aria-pressed={caseSensitive}
                  aria-label={t("workspace.matchCase")}
                  onClick={() => setCaseSensitive((value) => !value)}
                >
                  <CaseSensitive className="size-3.5" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                {t("workspace.matchCase")}
              </TooltipContent>
            </Tooltip>
            <Tooltip delayDuration={300} disableHoverableContent>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={SEARCH_OPTION_TOGGLE_BTN}
                  aria-pressed={wholeWord}
                  aria-label={t("workspace.matchWholeWord")}
                  onClick={() => setWholeWord((value) => !value)}
                >
                  <WholeWord className="size-3.5" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                {t("workspace.matchWholeWord")}
              </TooltipContent>
            </Tooltip>
            <Tooltip delayDuration={300} disableHoverableContent>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={SEARCH_OPTION_TOGGLE_BTN}
                  aria-pressed={isRegexp}
                  aria-label={t("workspace.useRegex")}
                  onClick={() => setIsRegexp((value) => !value)}
                >
                  <Regex className="size-3.5" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                {t("workspace.useRegex")}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {searching ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {t("workspace.fileSearchSearching")}
          </p>
        ) : null}
        {searchError ? (
          <p className="px-3 py-2 text-xs text-destructive/90">{searchError}</p>
        ) : null}
        {!searching && !searchError && resultsTruncated ? (
          <p className="px-3 py-1.5 text-xs text-muted-foreground">
            {t("workspace.fileSearchResultsTruncated", {
              shown: matches.length,
            })}
          </p>
        ) : null}
        {!searching && !searchError && debouncedQuery && groups.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">{t("workspace.fileSearchNoResults")}</p>
        ) : null}

        <ScrollArea ref={scrollAreaRef} className="h-full min-h-0 w-full">
          <div
            className="relative w-full px-1 pb-2"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const row = virtualRows[virtualItem.index];
              if (!row) {
                return null;
              }

              if (row.kind === "header") {
                const headerName = pathBasename(row.relativePath);
                const PlanTabIcon = resolveWorkspaceFilesTabIcon(headerName);
                return (
                  <div
                    key={`header:${row.normalizedPath}`}
                    ref={virtualizer.measureElement}
                    data-index={virtualItem.index}
                    className="absolute left-0 top-0 w-full px-1"
                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                  >
                    <button
                      type="button"
                      className="flex w-full min-w-0 items-center gap-1 rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
                      onClick={() => toggleExpanded(row.normalizedPath)}
                    >
                      {expandedPaths.has(row.normalizedPath) ? (
                        <ChevronDown className="size-3 shrink-0 opacity-70" aria-hidden />
                      ) : (
                        <ChevronRight className="size-3 shrink-0 opacity-70" aria-hidden />
                      )}
                      {PlanTabIcon ? (
                        <PlanTabIcon className="size-3.5 shrink-0 opacity-80" aria-hidden />
                      ) : (
                        <WorkspaceFileIcon
                          name={headerName}
                          kind="dir"
                          className="size-3.5 shrink-0 opacity-80"
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {pathBasename(row.relativePath)}
                      </span>
                      <span className="shrink-0 text-muted-foreground">{row.matchCount}</span>
                    </button>
                  </div>
                );
              }

              return (
                <div
                  key={row.matchKey}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  className="absolute left-0 top-0 w-full px-1"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <WorkspaceSearchMatchRow match={row.match} onOpen={openMatch} />
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

const WorkspaceSearchMatchRow = memo(function WorkspaceSearchMatchRow({
  match,
  onOpen,
}: {
  match: WorkspaceContentSearchMatch;
  onOpen: (match: WorkspaceContentSearchMatch) => void;
}) {
  const segments = useMemo(
    () => truncateSearchLinePreview(match.lineText, match.submatches),
    [match.lineText, match.submatches],
  );

  return (
    <div className="min-w-0">
      <button
        type="button"
        className={cn(
          "flex w-full min-w-0 items-center rounded py-1 pl-7 pr-2 text-left text-xs",
          "text-foreground/90 hover:bg-foreground/[0.06] dark:hover:bg-foreground/10",
        )}
        onClick={() => onOpen(match)}
      >
        <span className="min-w-0 flex-1 truncate">
          {segments.map((segment, index) =>
            segment.highlighted ? (
              <mark key={index} className="rounded-sm bg-primary/20 text-foreground">
                {segment.text}
              </mark>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </span>
      </button>
    </div>
  );
});
