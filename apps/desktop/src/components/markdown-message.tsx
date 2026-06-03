import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  createMarkdownMessageComponents,
  markdownMessageRootClassName,
  type MarkdownTone,
} from "@/lib/markdown-message-components";
import { reactMarkdownUrlTransform } from "@/lib/markdown-url-transform";

import type { ReadManagedImagePreviewDataUrl } from "@/components/markdown-image";

export type { ReadManagedImagePreviewDataUrl } from "@/components/markdown-image";
export type { MarkdownTone } from "@/lib/markdown-message-components";

export function MarkdownMessage({
  content,
  className,
  tone = "default",
  readManagedImagePreviewDataUrl,
}: {
  content: string;
  className?: string;
  tone?: MarkdownTone;
  readManagedImagePreviewDataUrl?: ReadManagedImagePreviewDataUrl;
}) {
  const markdownComponents = useMemo(
    () => createMarkdownMessageComponents(readManagedImagePreviewDataUrl, tone),
    [readManagedImagePreviewDataUrl, tone],
  );

  return (
    <div className={markdownMessageRootClassName(tone, className)}>
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
