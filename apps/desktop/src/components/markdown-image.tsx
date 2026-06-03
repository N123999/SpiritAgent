import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import { useTranslation } from "react-i18next";

import { isManagedGeneratedImageRef } from "@/lib/managed-generated-image";
import { cn } from "@/lib/utils";

export type ReadManagedImagePreviewDataUrl = (reference: string) => Promise<string | null>;
type ManagedImageLoadState = "idle" | "loading" | "unavailable";

export function MarkdownImage({
  className,
  src,
  alt,
  readManagedImagePreviewDataUrl,
  ...props
}: ComponentPropsWithoutRef<"img"> & {
  readManagedImagePreviewDataUrl?: ReadManagedImagePreviewDataUrl;
}) {
  const { t } = useTranslation();
  const normalizedSrc = typeof src === "string" && src.trim().length > 0 ? src.trim() : null;
  const managedRef = normalizedSrc && isManagedGeneratedImageRef(normalizedSrc) ? normalizedSrc : null;
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(managedRef ? null : normalizedSrc);
  const [managedLoadState, setManagedLoadState] = useState<ManagedImageLoadState>("idle");

  useEffect(() => {
    let cancelled = false;

    if (!normalizedSrc) {
      setResolvedSrc(null);
      setManagedLoadState("idle");
      return () => {
        cancelled = true;
      };
    }

    if (!managedRef) {
      setResolvedSrc(normalizedSrc);
      setManagedLoadState("idle");
      return () => {
        cancelled = true;
      };
    }

    if (!readManagedImagePreviewDataUrl) {
      setResolvedSrc(null);
      setManagedLoadState("unavailable");
      return () => {
        cancelled = true;
      };
    }

    setResolvedSrc(null);
    setManagedLoadState("loading");
    void readManagedImagePreviewDataUrl(managedRef)
      .then((dataUrl: string | null) => {
        if (!cancelled) {
          if (dataUrl) {
            setResolvedSrc(dataUrl);
            setManagedLoadState("idle");
            return;
          }
          setResolvedSrc(null);
          setManagedLoadState("unavailable");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedSrc(null);
          setManagedLoadState("unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [managedRef, normalizedSrc, readManagedImagePreviewDataUrl]);

  if (managedRef && !readManagedImagePreviewDataUrl) {
    return (
      <div className="my-3 flex min-h-28 w-full items-center justify-center rounded-md border border-dashed border-border/50 bg-muted/20 px-3 text-xs text-muted-foreground">
        {t("error.hostNotSupported")}
      </div>
    );
  }

  if (managedRef && managedLoadState === "loading") {
    return (
      <div className="my-3 flex min-h-28 w-full items-center justify-center rounded-md border border-dashed border-border/50 bg-muted/20 px-3 text-xs text-muted-foreground">
        {t("error.loading")}
      </div>
    );
  }

  if (managedRef && managedLoadState === "unavailable") {
    return (
      <div className="my-3 flex min-h-28 w-full items-center justify-center rounded-md border border-dashed border-border/50 bg-muted/20 px-3 text-xs text-muted-foreground">
        {t("error.unavailable")}
      </div>
    );
  }

  if (!resolvedSrc) {
    return null;
  }

  return (
    <img
      className={cn(
        "my-3 block max-h-[28rem] w-auto max-w-full rounded-md border border-border/40 bg-background/40 object-contain shadow-sm",
        className,
      )}
      src={resolvedSrc}
      alt={alt}
      loading="lazy"
      {...props}
    />
  );
}
