import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { Download, LoaderCircle, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// backdrop-filter 在祖先 opacity 动画期间无法正确合成；卡片 hover 渐显须与 blur 写在同一元素上。
export const LOCAL_IMAGE_FLOATING_ACTION_BUTTON_CLASS = "spirit-floating-action-button";

export function useImagePreviewAspectRatio(previewDataUrl: string | null): CSSProperties | undefined {
  const [previewAspectRatio, setPreviewAspectRatio] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreviewAspectRatio(null);
    if (!previewDataUrl) {
      return () => {
        cancelled = true;
      };
    }

    const image = new Image();
    image.onload = () => {
      if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setPreviewAspectRatio(image.naturalWidth / image.naturalHeight);
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setPreviewAspectRatio(null);
      }
    };
    image.src = previewDataUrl;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [previewDataUrl]);

  return previewAspectRatio
    ? {
        aspectRatio: String(previewAspectRatio),
        width: `min(calc(100dvw - 5rem), calc((100dvh - 6rem) * ${previewAspectRatio}), 70rem)`,
      }
    : undefined;
}

export function LocalImagePreviewDialog({
  open,
  onOpenChange,
  previewDataUrl,
  onSave,
  saving = false,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  previewDataUrl: string | null;
  onSave?(): void;
  saving?: boolean;
}) {
  const { t } = useTranslation();
  const viewerFrameStyle = useImagePreviewAspectRatio(previewDataUrl);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-background/40 backdrop-blur-md"
        className="w-auto max-w-none gap-0 border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-none"
      >
        {previewDataUrl ? (
          <div
            className="pointer-events-auto relative inline-flex max-h-[calc(100dvh-2rem)] max-w-[calc(100dvw-2rem)] items-center justify-center overflow-hidden rounded-[1.1rem] border border-border/45"
            style={viewerFrameStyle}
          >
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn("absolute top-3 right-3 z-20", LOCAL_IMAGE_FLOATING_ACTION_BUTTON_CLASS)}
                title={t('app.closeImagePreview')}
                aria-label={t('app.closeImagePreview')}
              >
                <X className="size-4" aria-hidden />
                <span className="sr-only">{t('app.closeImagePreview')}</span>
              </Button>
            </DialogClose>
            <img
              src={previewDataUrl}
              alt=""
              className="block size-full object-contain"
              draggable={false}
            />
            {onSave ? (
              <div className="pointer-events-none absolute top-3 left-3 z-10">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className={cn("pointer-events-auto", LOCAL_IMAGE_FLOATING_ACTION_BUTTON_CLASS)}
                  onClick={() => void onSave()}
                  disabled={saving}
                  title={t('app.downloadImage')}
                  aria-label={t('app.downloadImage')}
                >
                  {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
