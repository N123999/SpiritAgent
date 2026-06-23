import { useMemo, memo } from "react";
import ReactMarkdown from "react-markdown";

import { spiritRemarkPluginsForReactMarkdown } from "@/lib/markdown-remark-plugins";

import {
  createMarkdownMessageComponents,
  markdownMessageRootClassName,
  type MarkdownSize,
  type MarkdownTone,
} from "@/lib/markdown-message-components";
import { useWorkspaceMarkdownLinkClick } from "@/components/workspace-markdown-link-context";
import { reactMarkdownUrlTransform } from "@/lib/markdown-url-transform";
import { githubHtmlRehypePlugins } from "@/lib/markdown-github-html";

import type { ReadManagedImagePreviewDataUrl } from "@/components/markdown-image";

export type { ReadManagedImagePreviewDataUrl } from "@/components/markdown-image";
export type { MarkdownSize, MarkdownTone } from "@/lib/markdown-message-components";

export const MarkdownMessage = memo(function MarkdownMessage({
  content,
  className,
  tone = "default",
  size = "default",
  allowHtml = false,
  readManagedImagePreviewDataUrl,
}: {
  content: string;
  className?: string;
  tone?: MarkdownTone;
  size?: MarkdownSize;
  allowHtml?: boolean;
  readManagedImagePreviewDataUrl?: ReadManagedImagePreviewDataUrl;
}) {
  const onMarkdownLinkClick = useWorkspaceMarkdownLinkClick();
  const markdownComponents = useMemo(
    () =>
      createMarkdownMessageComponents(
        readManagedImagePreviewDataUrl,
        tone,
        undefined,
        onMarkdownLinkClick,
        size,
        allowHtml,
      ),
    [allowHtml, onMarkdownLinkClick, readManagedImagePreviewDataUrl, size, tone],
  );

  return (
    <div className={markdownMessageRootClassName(tone, className, size)}>
      <ReactMarkdown
        remarkPlugins={spiritRemarkPluginsForReactMarkdown}
        rehypePlugins={allowHtml ? githubHtmlRehypePlugins : undefined}
        components={markdownComponents}
        urlTransform={reactMarkdownUrlTransform}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
