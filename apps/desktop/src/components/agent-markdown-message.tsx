import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";
import { createCodePlugin } from "@streamdown/code";
import { math } from "@streamdown/math";
import { Block, parseMarkdownIntoBlocks, Streamdown, type BlockProps } from "streamdown";
import type { Pluggable } from "unified";

import type { ReadManagedImagePreviewDataUrl } from "@/components/markdown-image";
import type { ReadManagedVideoPreviewUrl } from "@/components/markdown-video";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { useTheme } from "@/hooks/useTheme";
import {
  createStreamdownMessageComponents,
  markdownMessageRootClassName,
  type MarkdownTone,
} from "@/lib/markdown-message-components";
import { streamdownRehypePlugins } from "@/lib/markdown-streamdown-plugins";
import { spiritRemarkPluginsForStreamdown } from "@/lib/markdown-remark-plugins";
import { streamdownUrlTransform } from "@/lib/markdown-url-transform";
import { createSpiritMermaidPlugin } from "@/lib/markdown-mermaid-theme";
import { createMarkdownMermaidRenderer } from "@/components/markdown-mermaid-block";
import { useWorkspaceMarkdownLinkClick } from "@/components/workspace-markdown-link-context";

const streamdownMathPlugin = math;

/** VS Code Default Light+ / Dark+（Shiki bundled） */
const STREAMDOWN_SHIKI_THEMES = ["light-plus", "dark-plus"] as const;

const spiritStreamdownCodePlugin = createCodePlugin({
  themes: [...STREAMDOWN_SHIKI_THEMES],
});

/** Char-level + zero stagger: each stream delta animates in parallel (not serial / per-paragraph batch). */
const streamingAnimateOptions = {
  animation: "slideUp" as const,
  duration: 160,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  sep: "char" as const,
  stagger: 0,
};

function isAnimateRehypePlugin(entry: Pluggable): boolean {
  const fn = Array.isArray(entry) ? entry[0] : entry;
  return typeof fn === "function" && /^rehypeAnimate/.test(fn.name ?? "");
}

type StreamBlockAnimateContextValue = {
  lastBlockIndex: number;
  /** Tail-block char length committed after the previous paint (used instead of getLastRenderCharCount). */
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
  readManagedVideoPreviewUrl,
}: {
  content: string;
  streaming?: boolean;
  className?: string;
  tone?: MarkdownTone;
  readManagedImagePreviewDataUrl?: ReadManagedImagePreviewDataUrl;
  readManagedVideoPreviewUrl?: ReadManagedVideoPreviewUrl;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const { resolvedDark } = useTheme();
  const onMarkdownLinkClick = useWorkspaceMarkdownLinkClick();
  const streamdownPlugins = useMemo(
    () => ({
      code: spiritStreamdownCodePlugin,
      math: streamdownMathPlugin,
      mermaid: createSpiritMermaidPlugin(resolvedDark),
      renderers: [createMarkdownMermaidRenderer(resolvedDark)],
    }),
    [resolvedDark],
  );

  const components = useMemo(
    () =>
      createStreamdownMessageComponents(
        readManagedImagePreviewDataUrl,
        tone,
        readManagedVideoPreviewUrl,
        onMarkdownLinkClick,
      ),
    [onMarkdownLinkClick, readManagedImagePreviewDataUrl, readManagedVideoPreviewUrl, tone],
  );

  const motionActive = streaming && !prefersReducedMotion;

  const streamBlocks = useMemo(() => {
    if (!motionActive) return [];
    return parseMarkdownIntoBlocks(content);
  }, [content, motionActive]);

  const lastBlockIndex = Math.max(0, streamBlocks.length - 1);
  const tailBlockLength = motionActive
    ? streamBlocks[lastBlockIndex]?.length ?? 0
    : 0;

  // Multi-block streaming: only the tail block animates new chars, so prev-length must
  // track the tail block (not the whole doc). Reset to 0 when a new tail block begins
  // (its content is entirely new) so its first chars animate; updated to the committed
  // tail length after each paint so subsequent growth only animates the delta.
  const frozenCharCountRef = useRef(0);
  const prevTailIndexRef = useRef(-1);
  if (motionActive && lastBlockIndex !== prevTailIndexRef.current) {
    prevTailIndexRef.current = lastBlockIndex;
    frozenCharCountRef.current = 0;
  }

  useLayoutEffect(() => {
    frozenCharCountRef.current = motionActive ? tailBlockLength : 0;
  }, [tailBlockLength, motionActive]);

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
        remarkPlugins={spiritRemarkPluginsForStreamdown}
        components={components}
        urlTransform={streamdownUrlTransform}
        rehypePlugins={streamdownRehypePlugins}
        controls={{
          code: { copy: false, download: false },
          mermaid: { copy: false, download: false, fullscreen: false, panZoom: true },
          table: { copy: true, download: true, fullscreen: true },
        }}
        lineNumbers={false}
        parseIncompleteMarkdown={streaming}
        isAnimating={motionActive}
        animated={motionActive ? streamingAnimateOptions : false}
        BlockComponent={motionActive ? StreamingAnimateBlock : undefined}
      >
        {content}
      </Streamdown>
    </StreamBlockAnimateContext.Provider>
  );
}
