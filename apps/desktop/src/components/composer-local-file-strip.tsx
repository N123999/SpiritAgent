import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { File, X } from "lucide-react";

import {
  LOCAL_IMAGE_FLOATING_ACTION_BUTTON_CLASS,
  LocalImagePreviewDialog,
} from "@/components/local-image-preview-dialog";
import { Button } from "@/components/ui/button";
import type { SaveLocalImageAs } from "@/components/tool-call/tool-call-types";
import {
  canPreviewComposerLocalFileAttachment,
  type ComposerLocalFileAttachmentView,
} from "../lib/local-file-attachments.js";
import { cn } from "@/lib/utils";

export type { ComposerLocalFileAttachmentView };

const MEDIA_THUMB_SIZE_CLASS = "size-14";

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
  const removable = !readOnly && Boolean(onRemove);

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
          "group relative shrink-0 overflow-hidden rounded-lg border border-border/30 bg-input/40 dark:border-white/[0.07] dark:bg-white/[0.03]",
          MEDIA_THUMB_SIZE_CLASS,
          canPreview && "cursor-zoom-in",
        )}
        title={attachment.name}
        role={canPreview ? "button" : undefined}
        tabIndex={canPreview ? 0 : undefined}
        aria-label={canPreview ? t("app.viewLargeImage") : attachment.name}
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
        {showImage ? (
          <img
            src={attachment.previewDataUrl ?? undefined}
            alt=""
            className="size-full object-cover"
            onError={() => setImageLoadFailed(true)}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <File className="size-5 shrink-0" aria-hidden />
          </div>
        )}
        {removable ? (
          <div className="pointer-events-none absolute top-1 right-1 z-10">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "pointer-events-auto !size-5 !min-w-5",
                LOCAL_IMAGE_FLOATING_ACTION_BUTTON_CLASS,
                "opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100",
              )}
              onClick={(event) => {
                event.stopPropagation();
                onRemove?.(attachment.path);
              }}
              aria-label={t("composer.removeAttachment", { name: attachment.name })}
            >
              <X className="size-3" aria-hidden />
            </Button>
          </div>
        ) : null}
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
    <div className={className ?? "flex flex-wrap gap-2 pl-2 pr-3 pt-2 pb-1"}>
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
