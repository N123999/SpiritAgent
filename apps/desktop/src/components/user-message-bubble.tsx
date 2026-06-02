import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { PenTool } from "lucide-react";

import { BROWSER_ELEMENT_CHIP_CLASS } from "@/components/browser-element-card";
import { ComposerLocalFileStrip } from "@/components/composer-local-file-strip";
import { useLocalFileAttachmentPreviews } from "@/hooks/useLocalFileAttachmentPreviews";
import {
  isAttachmentOnlyDisplayText,
  localFileAttachmentsSnapshotKey,
  mergeComposerAttachmentViews,
  snapshotsToComposerAttachmentViews,
  type ComposerLocalFileAttachmentView,
} from "@/lib/local-file-attachments";
import {
  parseMessageContentParts,
  trimMessageTextAroundElements,
} from "@/lib/composer-segment-model";
import { cn } from "@/lib/utils";
import type { ConversationMessageSnapshot } from "@/types";

function ElementCard({ tagName, url }: { tagName: string; url: string }) {
  return (
    <span
      title={url}
      className={BROWSER_ELEMENT_CHIP_CLASS}
    >
      <PenTool className="size-[10px] shrink-0" aria-hidden />
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

  const contentParts = useMemo(
    () => parseMessageContentParts(message.content),
    [message.content],
  );
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
            {contentParts.map((part, i) => {
              if (part.kind === "element") {
                return <ElementCard key={i} tagName={part.tagName} url={part.url} />;
              }
              const prev = i > 0 ? contentParts[i - 1] : null;
              const next = i < contentParts.length - 1 ? contentParts[i + 1] : null;
              const display = trimMessageTextAroundElements(part.value, {
                afterElement: prev?.kind === "element",
                beforeElement: next?.kind === "element",
              });
              return display;
            })}
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
