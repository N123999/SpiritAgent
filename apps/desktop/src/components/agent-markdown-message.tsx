import { useMemo } from "react";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { Streamdown } from "streamdown";

import type { ReadManagedImagePreviewDataUrl } from "@/components/markdown-image";
import {
  createMarkdownMessageComponents,
  markdownMessageRootClassName,
  type MarkdownTone,
} from "@/lib/markdown-message-components";
import { streamdownUrlTransform } from "@/lib/markdown-url-transform";

const streamdownPlugins = { code, math, mermaid };

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
  const components = useMemo(
    () => createMarkdownMessageComponents(readManagedImagePreviewDataUrl, tone),
    [readManagedImagePreviewDataUrl, tone],
  );

  return (
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
      isAnimating={false}
    >
      {content}
    </Streamdown>
  );
}
