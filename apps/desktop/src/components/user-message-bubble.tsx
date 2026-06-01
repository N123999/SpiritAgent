import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Pen } from "lucide-react";

import { ComposerLocalFileStrip } from "@/components/composer-local-file-strip";
import { useLocalFileAttachmentPreviews } from "@/hooks/useLocalFileAttachmentPreviews";
import {
  isAttachmentOnlyDisplayText,
  localFileAttachmentsSnapshotKey,
  mergeComposerAttachmentViews,
  snapshotsToComposerAttachmentViews,
  type ComposerLocalFileAttachmentView,
} from "@/lib/local-file-attachments";
import { cn } from "@/lib/utils";
import type { ConversationMessageSnapshot } from "@/types";

type MessagePart =
  | { kind: 'text'; value: string }
  | { kind: 'element'; tagName: string; url: string };

const ELEMENT_BLOCK_RE = /Selected element from ([^\n]*):\n```html\n[\s\S]*?\n```/g;

function parseMessageContent(content: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(ELEMENT_BLOCK_RE.source, 'g');
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) parts.push({ kind: 'text', value: content.slice(last, m.index) });
    const url = m[1].trim();
    const htmlMatch = /```html\n([\s\S]*?)\n```/.exec(m[0]);
    const firstTag = htmlMatch ? (/<(\w[\w-]*)/.exec(htmlMatch[1])?.[1] ?? 'element') : 'element';
    parts.push({ kind: 'element', tagName: firstTag, url });
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push({ kind: 'text', value: content.slice(last) });
  return parts;
}

function ElementCard({ tagName, url }: { tagName: string; url: string }) {
  return (
    <span
      title={url}
      className="inline-flex items-center gap-1 rounded-md border border-blue-700/60 bg-blue-950 px-1.5 py-0.5 text-xs font-medium leading-none text-blue-400 select-none align-middle mx-0.5"
    >
      <Pen className="size-[10px] shrink-0" aria-hidden />
      {`<${tagName}>`}
    </span>
  );
}

type ReadLocalImagePreview = (filePath: string) => Promise<string | null>;

type UserMessageBubbleProps = {
  message: ConversationMessageSnapshot;
  userBubbleClassName: string;
  canStartRewind: boolean;
  onRewindStart(): void;
  readLocalImagePreviewDataUrl: ReadLocalImagePreview;
};

export function UserMessageBubble({
  message,
  userBubbleClassName,
  canStartRewind,
  onRewindStart,
  readLocalImagePreviewDataUrl,
}: UserMessageBubbleProps) {
  const attachmentSnapshotKey = localFileAttachmentsSnapshotKey(message.localFileAttachments);
  const initialViews = useMemo(
    () => snapshotsToComposerAttachmentViews(message.localFileAttachments),
    [attachmentSnapshotKey],
  );
  const [attachmentViews, setAttachmentViews] =
    useState<ComposerLocalFileAttachmentView[]>(initialViews);

  useEffect(() => {
    setAttachmentViews((previous) => mergeComposerAttachmentViews(previous, initialViews));
  }, [message.id, attachmentSnapshotKey, initialViews]);

  useLocalFileAttachmentPreviews(attachmentViews, setAttachmentViews, readLocalImagePreviewDataUrl);

  const contentParts = useMemo(() => parseMessageContent(message.content), [message.content]);
  const visibleText = contentParts.filter((p) => p.kind === 'text').map((p) => p.value).join('');
  const showText =
    (visibleText.trim().length > 0 || contentParts.some((p) => p.kind === 'element')) &&
    !isAttachmentOnlyDisplayText(message.content, message.localFileAttachments);
  const hasAttachments = attachmentViews.length > 0;

  if (!showText && !hasAttachments) {
    return null;
  }

  const rewindBubbleClassName = cn(
    canStartRewind &&
      "cursor-pointer transition-colors hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
  );

  const handleRewindKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onRewindStart();
    }
  };

  return (
    <div className="flex w-full flex-col items-end gap-1.5">
      {showText ? (
        <div
          data-spirit-surface="message-bubble"
          className={cn(userBubbleClassName, rewindBubbleClassName)}
          role={canStartRewind ? "button" : undefined}
          tabIndex={canStartRewind ? 0 : undefined}
          onClick={canStartRewind ? onRewindStart : undefined}
          onKeyDown={canStartRewind ? handleRewindKeyDown : undefined}
        >
          <pre className="m-0 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
            {contentParts.map((part, i) =>
              part.kind === 'text' ? (
                part.value
              ) : (
                <ElementCard key={i} tagName={part.tagName} url={part.url} />
              ),
            )}
          </pre>
        </div>
      ) : null}
      {hasAttachments ? (
        <div
          className={cn("w-full", !showText && rewindBubbleClassName)}
          role={!showText && canStartRewind ? "button" : undefined}
          tabIndex={!showText && canStartRewind ? 0 : undefined}
          onClick={!showText && canStartRewind ? onRewindStart : undefined}
          onKeyDown={!showText && canStartRewind ? handleRewindKeyDown : undefined}
        >
          <ComposerLocalFileStrip
            readOnly
            attachments={attachmentViews}
            className="flex flex-wrap justify-end gap-1.5"
          />
        </div>
      ) : null}
    </div>
  );
}
