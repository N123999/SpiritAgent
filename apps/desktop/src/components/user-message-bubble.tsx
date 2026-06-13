import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, PenTool } from "lucide-react";

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
  type MessageContentPart,
} from "@/lib/composer-segment-model";
import {
  formatPrDiffChipLabel,
  formatPrDiffChipTitle,
  prDiffChipClassForStatus,
} from "@/lib/github-pr-diff-chip-styles";
import type { PullRequestChipStatus } from "@/lib/pr-diff-attachment";
import { workspaceFileBasename } from "@/lib/file-picker-path";
import {
  WORKSPACE_FILE_CHIP_CLASS,
  WORKSPACE_FILE_CHIP_ICON_CLASS,
} from "@/lib/workspace-file-chip-styles";
import { workspaceExplorerIconForPath } from "@/lib/workspace-explorer-icon";
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

function WorkspaceFileCard({ path }: { path: string }) {
  const normalized = path.replace(/\\/gu, "/");
  const Icon = workspaceExplorerIconForPath(normalized);
  return (
    <span title={normalized} className={WORKSPACE_FILE_CHIP_CLASS}>
      <Icon className={cn("size-[10px] shrink-0", WORKSPACE_FILE_CHIP_ICON_CLASS)} aria-hidden />
      {workspaceFileBasename(normalized)}
    </span>
  );
}

function prDiffStatusIcon(status: PullRequestChipStatus) {
  switch (status) {
    case "closed":
      return GitPullRequestClosed;
    case "draft":
      return GitPullRequestDraft;
    case "merged":
      return GitMerge;
    case "open":
    default:
      return GitPullRequest;
  }
}

function PrDiffCard({
  part,
}: {
  part: Extract<MessageContentPart, { kind: "prDiff" }>;
}) {
  const Icon = prDiffStatusIcon(part.status);
  return (
    <span
      title={formatPrDiffChipTitle({
        id: "",
        prUrl: part.prUrl,
        filename: part.filename,
        lineStart: part.lineStart,
        lineEnd: part.lineEnd,
        diffText: part.diffText,
        status: part.status,
      })}
      className={prDiffChipClassForStatus(part.status)}
    >
      <Icon className="size-[10px] shrink-0" aria-hidden />
      {formatPrDiffChipLabel(part.filename, part.lineStart, part.lineEnd)}
    </span>
  );
}

function isInlineChipPart(
  part: MessageContentPart | null | undefined,
): part is Extract<MessageContentPart, { kind: "element" | "workspaceFile" | "prDiff" }> {
  return part?.kind === "element" || part?.kind === "workspaceFile" || part?.kind === "prDiff";
}

type ReadLocalImagePreview = (filePath: string) => Promise<string | null>;

type UserMessageBubbleProps = {
  message: ConversationMessageSnapshot;
  userBubbleClassName: string;
  canStartRewind: boolean;
  queued?: boolean;
  onRewindStart(): void;
  readLocalImagePreviewDataUrl: ReadLocalImagePreview;
};

export function UserMessageBubble({
  message,
  userBubbleClassName,
  canStartRewind,
  queued = false,
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
    (visibleText.trim().length > 0 ||
      contentParts.some(
        (p) => p.kind === "element" || p.kind === "workspaceFile" || p.kind === "prDiff",
      )) &&
    !isAttachmentOnlyDisplayText(message.content, message.localFileAttachments);
  const hasAttachments = attachmentViews.length > 0;

  if (!showText && !hasAttachments) {
    return null;
  }

  const bubbleClassName = cn(
    userBubbleClassName,
    queued && "opacity-60",
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
          className={bubbleClassName}
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
              if (part.kind === "workspaceFile") {
                return <WorkspaceFileCard key={i} path={part.path} />;
              }
              if (part.kind === "prDiff") {
                return <PrDiffCard key={i} part={part} />;
              }
              const prev = i > 0 ? contentParts[i - 1] : null;
              const next = i < contentParts.length - 1 ? contentParts[i + 1] : null;
              const display = trimMessageTextAroundElements(part.value, {
                afterElement: isInlineChipPart(prev),
                beforeElement: isInlineChipPart(next),
              });
              return display;
            })}
          </pre>
        </div>
      ) : null}
      {hasAttachments ? (
        <div
          className={cn("w-full", !showText && queued && "opacity-60", !showText && canStartRewind &&
            "cursor-pointer transition-colors hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none")}
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
