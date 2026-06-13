import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  createMarkdownMessageComponents,
  markdownMessageRootClassName,
  type MarkdownSize,
  type MarkdownTone,
} from "@/lib/markdown-message-components";
import { useWorkspaceMarkdownLinkClick } from "@/components/workspace-markdown-link-context";
import { reactMarkdownUrlTransform } from "@/lib/markdown-url-transform";

import type { ReadManagedImagePreviewDataUrl } from "@/components/markdown-image";

export type { ReadManagedImagePreviewDataUrl } from "@/components/markdown-image";
export type { MarkdownSize, MarkdownTone } from "@/lib/markdown-message-components";

export function MarkdownMessage({
  content,
  className,
  tone = "default",
  size = "default",
  readManagedImagePreviewDataUrl,
}: {
  content: string;
  className?: string;
  tone?: MarkdownTone;
  size?: MarkdownSize;
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
      ),
    [onMarkdownLinkClick, readManagedImagePreviewDataUrl, size, tone],
  );

  return (
    <div className={markdownMessageRootClassName(tone, className, size)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
        urlTransform={reactMarkdownUrlTransform}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
