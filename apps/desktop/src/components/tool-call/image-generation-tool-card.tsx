import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Download, LoaderCircle, Maximize2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  LOCAL_IMAGE_FLOATING_ACTION_BUTTON_CLASS,
  LocalImagePreviewDialog,
} from "@/components/local-image-preview-dialog";
import type { ReadLocalImagePreview, SaveLocalImageAs } from "@/components/tool-call/tool-call-types";
import { isPreviewableImagePath } from "@/lib/local-file-attachments";
import { cn } from "@/lib/utils";
import type { ToolBlockSnapshot } from "@/types";

export function ImageGenerationToolCard({
  tool,
  readLocalImagePreviewDataUrl,
  saveLocalImageAs,
}: {
  tool: ToolBlockSnapshot;
  readLocalImagePreviewDataUrl: ReadLocalImagePreview;
  saveLocalImageAs: SaveLocalImageAs;
}) {
  const { t } = useTranslation();
  const previewableImagePath = tool.imagePaths?.find(isPreviewableImagePath) ?? "";
  const imagePath = tool.imagePaths?.find((path) => path.trim().length > 0) ?? "";
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [viewerOpen, setViewerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreviewDataUrl(null);
    if (!previewableImagePath) {
      setPreviewState("unavailable");
      return () => {
        cancelled = true;
      };
    }

    setPreviewState("loading");
    void readLocalImagePreviewDataUrl(previewableImagePath)
      .then((dataUrl) => {
        if (cancelled) {
          return;
        }
        setPreviewDataUrl(dataUrl);
        setPreviewState(dataUrl ? "ready" : "unavailable");
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewState("unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [previewableImagePath, readLocalImagePreviewDataUrl]);

  const loading = tool.phase === "preview" || tool.phase === "running" || previewState === "loading";
  const canInteract = Boolean(previewDataUrl && previewableImagePath);
  const floatingActionCardRevealClass =
    "opacity-0 group-hover/image-card:opacity-100 group-focus-within/image-card:opacity-100";

  const handleSaveImage = async () => {
    if (!imagePath || saving) {
      return;
    }

    setSaving(true);
    try {
      await saveLocalImageAs(imagePath);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-[min(28rem,100%)] py-1">
      <div
        className={cn(
          "group/image-card relative aspect-square overflow-hidden rounded-md border border-border/45 bg-muted/20 transition-colors duration-200",
          canInteract && "cursor-zoom-in hover:border-border/70",
          tool.phase === "failed" && "border-destructive/45 bg-destructive/5",
        )}
        role={canInteract ? "button" : undefined}
        tabIndex={canInteract ? 0 : undefined}
        onClick={canInteract ? () => setViewerOpen(true) : undefined}
        onKeyDown={
          canInteract
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setViewerOpen(true);
                }
              }
            : undefined
        }
      >
        {previewDataUrl ? (
          <img
            src={previewDataUrl}
            alt=""
            className="size-full object-cover transition-transform duration-300 group-hover/image-card:scale-[1.015]"
            draggable={false}
          />
        ) : (
          <div className="flex size-full items-center justify-center px-4 text-center">
            <span
              className={cn(
                "text-sm font-medium",
                loading ? "spirit-thinking-shimmer-text" : "text-muted-foreground",
              )}
            >
              {loading ? t('common.loading') : t('app.previewUnavailable')}
            </span>
          </div>
        )}
        {previewDataUrl ? (
          <div className="pointer-events-none absolute inset-0 z-10">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn(
                "pointer-events-auto absolute bottom-3 left-3",
                LOCAL_IMAGE_FLOATING_ACTION_BUTTON_CLASS,
                floatingActionCardRevealClass,
              )}
              onClick={(event) => {
                event.stopPropagation();
                void handleSaveImage();
              }}
              disabled={saving}
              title={t('app.downloadImage')}
              aria-label={t('app.downloadImage')}
            >
              {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn(
                "pointer-events-auto absolute right-3 bottom-3",
                LOCAL_IMAGE_FLOATING_ACTION_BUTTON_CLASS,
                floatingActionCardRevealClass,
              )}
              onClick={(event) => {
                event.stopPropagation();
                setViewerOpen(true);
              }}
              title={t('app.viewLargeImage')}
              aria-label={t('app.viewLargeImage')}
            >
              <Maximize2 className="size-4" aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>
      {!previewDataUrl && imagePath ? (
        <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground" title={imagePath}>
          {imagePath}
        </p>
      ) : null}
      {tool.phase === "failed" && tool.outputExcerpt ? (
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-destructive/20 bg-destructive/5 p-2 font-mono text-xs leading-relaxed text-destructive">
          {tool.outputExcerpt}
        </pre>
      ) : null}

      <LocalImagePreviewDialog
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        previewDataUrl={previewDataUrl}
        onSave={handleSaveImage}
        saving={saving}
      />
    </div>
  );
}
