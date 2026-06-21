import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { File, X } from "lucide-react";

import { LocalImagePreviewDialog } from "@/components/local-image-preview-dialog";
import type { SaveLocalImageAs } from "@/components/tool-call/tool-call-types";
import {
  canPreviewComposerLocalFileAttachment,
  type ComposerLocalFileAttachmentView,
} from "../lib/local-file-attachments.js";
import { cn } from "@/lib/utils";

export type { ComposerLocalFileAttachmentView };

const ATTACHMENT_VISUAL_CLASS = "size-[18px]";

type ComposerLocalFileStripProps = {
  attachments: readonly ComposerLocalFileAttachmentView[];
  readOnly?: boolean;
  className?: string;
  onRemove?(path: string): void;
  saveLocalImageAs?: SaveLocalImageAs;
};

function ComposerLocalFileCard({
  attachment,
  readOnly,
  onRemove,
  saveLocalImageAs,
}: {
  attachment: ComposerLocalFileAttachmentView;
  readOnly: boolean;
  onRemove?(path: string): void;
  saveLocalImageAs?: SaveLocalImageAs;
}) {
  const { t } = useTranslation();
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const showImage = attachment.isImage && !imageLoadFailed && Boolean(attachment.previewDataUrl);
  const canPreview = canPreviewComposerLocalFileAttachment(attachment) && !imageLoadFailed;

  const openPreview = (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
    setViewerOpen(true);
  };

  const handleSaveImage = async () => {
    if (!saveLocalImageAs || saving) {
      return;
    }

    setSaving(true);
    try {
      await saveLocalImageAs(attachment.path);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          "inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border/30 bg-input/40 pl-1 pr-1.5 py-0.75 dark:border-white/[0.07] dark:bg-white/[0.03]",
          canPreview && "cursor-zoom-in",
        )}
        role={canPreview ? "button" : undefined}
        tabIndex={canPreview ? 0 : undefined}
        aria-label={canPreview ? t('app.viewLargeImage') : undefined}
        onClick={canPreview ? openPreview : undefined}
        onKeyDown={
          canPreview
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openPreview(event);
                }
              }
            : undefined
        }
      >
        {!readOnly && onRemove ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRemove(attachment.path);
            }}
            className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            aria-label={t('composer.removeAttachment', { name: attachment.name })}
          >
            <X className="size-3" aria-hidden />
          </button>
        ) : null}
        {showImage ? (
          <img
            src={attachment.previewDataUrl ?? undefined}
            alt=""
            className={`${ATTACHMENT_VISUAL_CLASS} ${readOnly ? "" : "-ml-0.25"} shrink-0 rounded-sm object-cover`}
            onError={() => setImageLoadFailed(true)}
          />
        ) : (
          <div
            className={`${readOnly ? "" : "-ml-0.25"} inline-flex shrink-0 items-center justify-center rounded-sm text-muted-foreground`}
          >
            <File className={`${ATTACHMENT_VISUAL_CLASS} shrink-0`} aria-hidden />
          </div>
        )}
        <div className="min-w-0 pr-0.5">
          <div
            className="truncate text-xs leading-4 font-medium text-foreground/90"
            title={attachment.path}
          >
            {attachment.name}
          </div>
        </div>
      </div>
      <LocalImagePreviewDialog
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        previewDataUrl={canPreview ? attachment.previewDataUrl ?? null : null}
        onSave={saveLocalImageAs ? handleSaveImage : undefined}
        saving={saving}
      />
    </>
  );
}

export function ComposerLocalFileStrip({
  attachments,
  readOnly = false,
  className,
  onRemove,
  saveLocalImageAs,
}: ComposerLocalFileStripProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className={className ?? "flex flex-wrap gap-1.5 pl-2 pr-3 pt-2 pb-1"}>
      {attachments.map((attachment) => (
        <ComposerLocalFileCard
          key={attachment.id}
          attachment={attachment}
          readOnly={readOnly}
          onRemove={onRemove}
          saveLocalImageAs={saveLocalImageAs}
        />
      ))}
    </div>
  );
}
