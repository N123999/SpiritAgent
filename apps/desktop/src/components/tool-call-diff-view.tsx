import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';

import {
  Diff,
  Hunk,
  parseDiff,
  type HunkTokens,
} from 'react-diff-view';
import type { HunkData } from 'react-diff-view';
import 'react-diff-view/style/index.css';

import { ScrollArea } from '@/components/ui/scroll-area';
import { tokenizeDiffHunks } from '@/lib/diff-view-tokens';
import { buildToolCallUnifiedDiff } from '@/lib/tool-call-unified-diff';

import '@/styles/tool-call-diff-view.css';

function scrollAreaViewport(root: ComponentRef<typeof ScrollArea> | null): HTMLElement | null {
  return root?.querySelector('[data-radix-scroll-area-viewport]') ?? null;
}

const TOKENIZE_DEBOUNCE_MS = 32;

export type ToolCallDiffViewProps = {
  relativePath: string;
  languageId: string;
  original: string;
  modified: string;
  /** 流式写入时滚到末行 */
  followTail?: boolean;
};

function tokenizeHunks(
  hunks: HunkData[],
  original: string,
  languageId: string,
): HunkTokens | null {
  return tokenizeDiffHunks(hunks, languageId, original);
}

export function ToolCallDiffView({
  relativePath,
  languageId,
  original,
  modified,
  followTail = false,
}: ToolCallDiffViewProps) {
  const scrollAreaRef = useRef<ComponentRef<typeof ScrollArea>>(null);

  const parsedFile = useMemo(() => {
    const diffText = buildToolCallUnifiedDiff(relativePath, original, modified);
    const files = parseDiff(diffText, { nearbySequences: 'zip' });
    return files[0];
  }, [relativePath, original, modified]);

  const hunks = parsedFile?.hunks ?? [];
  const diffType = parsedFile?.type ?? 'modify';

  const [tokens, setTokens] = useState<HunkTokens | null>(() =>
    tokenizeHunks(hunks, original, languageId),
  );

  useEffect(() => {
    if (followTail) {
      const timer = window.setTimeout(() => {
        setTokens(tokenizeHunks(hunks, original, languageId));
      }, TOKENIZE_DEBOUNCE_MS);
      return () => window.clearTimeout(timer);
    }
    setTokens(tokenizeHunks(hunks, original, languageId));
    return undefined;
  }, [followTail, hunks, original, languageId]);

  useEffect(() => {
    if (!followTail) {
      return;
    }
    const viewport = scrollAreaViewport(scrollAreaRef.current);
    if (!viewport) {
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
  }, [followTail, modified, tokens]);

  if (hunks.length === 0) {
    return (
      <pre className="overflow-x-auto whitespace-pre rounded-md border border-border/20 bg-background p-2 font-mono text-xs leading-relaxed text-muted-foreground">
        {modified || original}
      </pre>
    );
  }

  return (
    <ScrollArea
      ref={scrollAreaRef}
      type="always"
      scrollbars="both"
      className="tool-call-diff h-[min(420px,50vh)] min-h-[120px] w-full min-w-0 rounded-md border border-border/20 bg-background pr-2 [&>[data-radix-scroll-area-viewport]]:h-full [&>[data-radix-scroll-area-viewport]]:overscroll-contain"
      data-tool-diff-path={relativePath}
      onWheel={(event) => {
        event.stopPropagation();
      }}
      onTouchMove={(event) => {
        event.stopPropagation();
      }}
    >
      <Diff
        viewType="unified"
        diffType={diffType}
        hunks={hunks}
        tokens={tokens}
        gutterType="none"
      >
        {(renderedHunks) =>
          renderedHunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)
        }
      </Diff>
    </ScrollArea>
  );
}
