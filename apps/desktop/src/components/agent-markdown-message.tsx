import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import {
  Block,
  parseMarkdownIntoBlocks,
  Streamdown,
  type BlockProps,
} from "streamdown";
import type { Pluggable } from "unified";

import type { ReadManagedImagePreviewDataUrl } from "@/components/markdown-image";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import {
  createMarkdownMessageComponents,
  markdownMessageRootClassName,
  type MarkdownTone,
} from "@/lib/markdown-message-components";
import { streamdownUrlTransform } from "@/lib/markdown-url-transform";

const streamdownPlugins = { code, math, mermaid };

/** Char-level + zero stagger: each stream delta animates in parallel (not serial / per-paragraph batch). */
const streamingAnimateOptions = {
  animation: "slideUp" as const,
  duration: 160,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  sep: "char" as const,
  stagger: 0,
};

/** One block while streaming so prev-length tracks the full growing document. */
const streamingSingleBlock = (markdown: string) => [markdown];

function isAnimateRehypePlugin(entry: Pluggable): boolean {
  const fn = Array.isArray(entry) ? entry[0] : entry;
  return typeof fn === "function" && /^rehypeAnimate/.test(fn.name ?? "");
}

type StreamBlockAnimateContextValue = {
  lastBlockIndex: number;
  /** Length of markdown string committed after the previous paint (used instead of getLastRenderCharCount). */
  frozenCharCountRef: MutableRefObject<number>;
};

const StreamBlockAnimateContext = createContext<StreamBlockAnimateContextValue>({
  lastBlockIndex: 0,
  frozenCharCountRef: { current: 0 },
});

type StreamdownAnimatePlugin = NonNullable<BlockProps["animatePlugin"]>;

/**
 * Block calls getLastRenderCharCount() then setPrevContentLength(result). In practice get()
 * often returns 0 (Strict Mode / multi-instance), so every character re-animates. Return our
 * committed string length instead and drain the real counter.
 */
function wrapStreamingAnimatePlugin(
  plugin: StreamdownAnimatePlugin,
  getCommittedCharCount: () => number,
): StreamdownAnimatePlugin {
  return {
    ...plugin,
    getLastRenderCharCount() {
      plugin.getLastRenderCharCount();
      return getCommittedCharCount();
    },
    setPrevContentLength(length: number) {
      plugin.setPrevContentLength(length);
    },
  };
}

function StreamingAnimateBlock(props: BlockProps) {
  const { index, content, animatePlugin, rehypePlugins, ...rest } = props;
  const { lastBlockIndex, frozenCharCountRef } = useContext(StreamBlockAnimateContext);
  const isTailBlock = index === lastBlockIndex;

  const blockRehypePlugins = useMemo(() => {
    if (isTailBlock || !rehypePlugins) return rehypePlugins;
    return rehypePlugins.filter((entry) => !isAnimateRehypePlugin(entry));
  }, [isTailBlock, rehypePlugins]);

  const blockPlugin = useMemo(() => {
    if (!isTailBlock || !animatePlugin) return null;
    return wrapStreamingAnimatePlugin(
      animatePlugin,
      () => frozenCharCountRef.current,
    );
  }, [animatePlugin, frozenCharCountRef, isTailBlock]);

  return (
    <Block
      {...rest}
      index={index}
      content={content}
      rehypePlugins={blockRehypePlugins}
      animatePlugin={blockPlugin}
    />
  );
}

export function AgentMarkdownMessage({
  content,
  streaming = false,
  className,
  tone = "default",
  readManagedImagePreviewDataUrl,
}: {
  content: string;
  streaming?: boolean;
  className?: string;
  tone?: MarkdownTone;
  readManagedImagePreviewDataUrl?: ReadManagedImagePreviewDataUrl;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const components = useMemo(
    () => createMarkdownMessageComponents(readManagedImagePreviewDataUrl, tone),
    [readManagedImagePreviewDataUrl, tone],
  );

  const motionActive = streaming && !prefersReducedMotion;

  const frozenCharCountRef = useRef(0);

  useLayoutEffect(() => {
    frozenCharCountRef.current = motionActive ? content.length : 0;
  }, [content, motionActive]);

  const streamBlocks = useMemo(() => {
    if (!motionActive) return [];
    return parseMarkdownIntoBlocks(content);
  }, [content, motionActive]);

  const lastBlockIndex = motionActive ? 0 : Math.max(0, streamBlocks.length - 1);

  const streamBlockAnimateContext = useMemo(
    () => ({ lastBlockIndex, frozenCharCountRef }),
    [lastBlockIndex, frozenCharCountRef],
  );

  return (
    <StreamBlockAnimateContext.Provider value={streamBlockAnimateContext}>
      <Streamdown
        className={markdownMessageRootClassName(tone, className)}
        mode={streaming ? "streaming" : "static"}
        plugins={streamdownPlugins}
        components={components}
        urlTransform={streamdownUrlTransform}
        controls={{
          code: { copy: true, download: true },
          mermaid: { copy: true, download: true, fullscreen: true, panZoom: true },
          table: { copy: true, download: true, fullscreen: true },
        }}
        parseIncompleteMarkdown={streaming}
        isAnimating={motionActive}
        animated={motionActive ? streamingAnimateOptions : false}
        parseMarkdownIntoBlocksFn={motionActive ? streamingSingleBlock : undefined}
        BlockComponent={motionActive ? StreamingAnimateBlock : undefined}
      >
        {content}
      </Streamdown>
    </StreamBlockAnimateContext.Provider>
  );
}
