import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { Spinner } from "@/components/ui/spinner";
import { isModShortcutPressed } from "@/lib/desktop-shell";
import { resolveUiLayoutZoomShortcutAction } from "@/lib/ui-layout-scale";
import { cn } from "@/lib/utils";

const DRAG_CLICK_THRESHOLD_PX = 4;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;
/** 单击在当前预览区内相对放大 20%。 */
const CLICK_ZOOM_FACTOR = 1.2;

export type WorkspaceImagePreviewState = "loading" | "ready" | "unavailable";

export function WorkspaceImagePreviewPane({
  previewState,
  previewDataUrl,
  fileLabel,
  className,
}: {
  previewState: WorkspaceImagePreviewState;
  previewDataUrl: string | null;
  fileLabel: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const movedDuringDragRef = useRef(false);

  const canInteract = previewState === "ready" && Boolean(previewDataUrl);

  const adjustZoom = useCallback((delta: number) => {
    setZoom((current) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current + delta)));
  }, []);

  const zoomInByClick = useCallback(() => {
    setZoom((current) => Math.min(MAX_ZOOM, current * CLICK_ZOOM_FACTOR));
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    resetView();
  }, [previewDataUrl, resetView]);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (!canInteract) {
        return;
      }
      event.preventDefault();
      adjustZoom(event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
    },
    [adjustZoom, canInteract],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canInteract || event.button !== 0 || event.isPrimary === false) {
        return;
      }
      movedDuringDragRef.current = false;
      setIsDragging(true);
      dragStartRef.current = { x: event.clientX, y: event.clientY };
      panStartRef.current = pan;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [canInteract, pan],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      if (!isDragging) {
        return;
      }
      event.preventDefault();
      const dx = event.clientX - dragStartRef.current.x;
      const dy = event.clientY - dragStartRef.current.y;
      if (
        Math.abs(dx) > DRAG_CLICK_THRESHOLD_PX ||
        Math.abs(dy) > DRAG_CLICK_THRESHOLD_PX
      ) {
        movedDuringDragRef.current = true;
      }
      setPan({
        x: panStartRef.current.x + dx,
        y: panStartRef.current.y + dy,
      });
    },
    [isDragging],
  );

  const handlePointerEnd = useCallback(
    (event: PointerEvent) => {
      const wasDragging = isDragging;
      setIsDragging(false);
      const target = contentRef.current;
      if (target instanceof HTMLElement) {
        target.releasePointerCapture(event.pointerId);
      }
      if (wasDragging && canInteract && !movedDuringDragRef.current) {
        zoomInByClick();
      }
    },
    [canInteract, isDragging, zoomInByClick],
  );

  useEffect(() => {
    const content = contentRef.current;
    if (!content || !isDragging) {
      return;
    }
    document.body.style.userSelect = "none";
    content.addEventListener("pointermove", handlePointerMove, { passive: false });
    content.addEventListener("pointerup", handlePointerEnd);
    content.addEventListener("pointercancel", handlePointerEnd);
    return () => {
      document.body.style.userSelect = "";
      content.removeEventListener("pointermove", handlePointerMove);
      content.removeEventListener("pointerup", handlePointerEnd);
      content.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [handlePointerEnd, handlePointerMove, isDragging]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!canInteract) {
        return;
      }
      const action = resolveUiLayoutZoomShortcutAction({
        defaultPrevented: event.defaultPrevented,
        modPressed: isModShortcutPressed(event.nativeEvent),
        altKey: event.altKey,
        key: event.key,
      });
      if (!action) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          zoomInByClick();
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (action === "in") {
        adjustZoom(ZOOM_STEP);
        return;
      }
      if (action === "out") {
        adjustZoom(-ZOOM_STEP);
        return;
      }
      resetView();
    },
    [adjustZoom, canInteract, resetView, zoomInByClick],
  );

  return (
    <div
        ref={containerRef}
        data-spirit-surface="workspace-image-preview"
        tabIndex={canInteract ? 0 : undefined}
        role={canInteract ? "button" : undefined}
        aria-label={canInteract ? fileLabel : undefined}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative flex h-full min-h-0 w-full flex-col overflow-hidden outline-none",
          canInteract && (isDragging ? "cursor-grabbing" : "cursor-zoom-in"),
          className,
        )}
      >
        {previewState === "loading" ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        ) : previewState === "unavailable" || !previewDataUrl ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-xs leading-relaxed text-muted-foreground">
            {t("workspace.imagePreviewUnavailable")}
          </div>
        ) : (
          <div
            ref={contentRef}
            className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden"
            onPointerDown={handlePointerDown}
          >
            <img
              src={previewDataUrl}
              alt={fileLabel}
              draggable={false}
              className="max-h-full max-w-full select-none object-contain"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
              }}
            />
          </div>
        )}
    </div>
  );
}
