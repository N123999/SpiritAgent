import { useMemo, type ComponentProps, type ComponentType } from "react";
import { createCodePlugin } from "@streamdown/code";
import { math } from "@streamdown/math";
import { Streamdown, type BlockProps } from "streamdown";

import type { ReadManagedImagePreviewDataUrl } from "@/components/markdown-image";
import type { ReadManagedVideoPreviewUrl } from "@/components/markdown-video";
import { createMarkdownMermaidRenderer } from "@/components/markdown-mermaid-block";
import { useWorkspaceMarkdownLinkClick } from "@/components/workspace-markdown-link-context";
import { useTheme } from "@/hooks/useTheme";
import {
  createStreamdownMessageComponents,
  markdownMessageRootClassName,
  type MarkdownSize,
  type MarkdownTone,
} from "@/lib/markdown-message-components";
import { createSpiritMermaidPlugin } from "@/lib/markdown-mermaid-theme";
import { spiritRemarkPluginsForStreamdown } from "@/lib/markdown-remark-plugins";
import { streamdownRehypePlugins } from "@/lib/markdown-streamdown-plugins";
import { streamdownUrlTransform } from "@/lib/markdown-url-transform";

const streamdownMathPlugin = math;

/** VS Code Default Light+ / Dark+（Shiki bundled） */
const STREAMDOWN_SHIKI_THEMES = ["light-plus", "dark-plus"] as const;

const spiritStreamdownCodePlugin = createCodePlugin({
  themes: [...STREAMDOWN_SHIKI_THEMES],
});

export const spiritStreamdownControls = {
  code: { copy: false, download: false },
  mermaid: { copy: false, download: false, fullscreen: false, panZoom: true },
  table: { copy: true, download: true, fullscreen: true },
} as const;

export type SpiritStreamdownMarkdownProps = {
  content: string;
  streaming?: boolean;
  className?: string;
  tone?: MarkdownTone;
  size?: MarkdownSize;
  allowHtml?: boolean;
  readManagedImagePreviewDataUrl?: ReadManagedImagePreviewDataUrl;
  readManagedVideoPreviewUrl?: ReadManagedVideoPreviewUrl;
  BlockComponent?: ComponentType<BlockProps>;
  isAnimating?: boolean;
  animated?: ComponentProps<typeof Streamdown>["animated"];
};

export function SpiritStreamdownMarkdown({
  content,
  streaming = false,
  className,
  tone = "default",
  size = "default",
  allowHtml = false,
  readManagedImagePreviewDataUrl,
  readManagedVideoPreviewUrl,
  BlockComponent,
  isAnimating = false,
  animated = false,
}: SpiritStreamdownMarkdownProps) {
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
        size,
        allowHtml,
      ),
    [
      allowHtml,
      onMarkdownLinkClick,
      readManagedImagePreviewDataUrl,
      readManagedVideoPreviewUrl,
      size,
      tone,
    ],
  );

  return (
    <Streamdown
      className={markdownMessageRootClassName(tone, className, size)}
      mode={streaming ? "streaming" : "static"}
      plugins={streamdownPlugins}
      remarkPlugins={spiritRemarkPluginsForStreamdown}
      components={components}
      urlTransform={streamdownUrlTransform}
      rehypePlugins={streamdownRehypePlugins}
      controls={spiritStreamdownControls}
      lineNumbers={false}
      parseIncompleteMarkdown={streaming}
      isAnimating={isAnimating}
      animated={animated}
      BlockComponent={BlockComponent}
    >
      {content}
    </Streamdown>
  );
}
