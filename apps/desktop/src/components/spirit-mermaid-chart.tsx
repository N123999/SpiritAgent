import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import type { MermaidConfig } from "mermaid";

import { useTranslation } from "react-i18next";

import { Spinner } from "@/components/ui/spinner";
import { createSpiritMermaidPlugin } from "@/lib/markdown-mermaid-theme";
import { cn } from "@/lib/utils";

const MERMAID_SVG_LAYOUT_CLASS_FULLSCREEN =
  "[&_svg]:block [&_svg]:h-auto [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:max-w-full";

const MERMAID_SVG_LAYOUT_CLASS_INLINE =
  "[&_svg]:block [&_svg]:h-auto [&_svg]:w-auto [&_svg]:max-w-full";

function hashChart(source: string): number {
  return source.split("").reduce((acc, ch) => (acc << 5) - acc + ch.charCodeAt(0), 0) | 0;
}

function MermaidPanZoom({
  children,
  className,
  fullscreen = false,
  showControls = true,
  controlsAlwaysVisible = false,
}: {
  children: ReactNode;
  className?: string;
  fullscreen?: boolean;
  showControls?: boolean;
  controlsAlwaysVisible?: boolean;
}) {
  const { t } = useTranslation();
  const zoomInLabel = t("app.diagramZoomIn");
  const zoomOutLabel = t("app.diagramZoomOut");
  const zoomResetLabel = t("app.diagramZoomReset");
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });

  const minZoom = 0.5;
  const maxZoom = 3;
  const zoomStep = 0.1;

  const adjustZoom = useCallback(
    (delta: number) => {
      setZoom((current) => Math.max(minZoom, Math.min(maxZoom, current + delta)));
    },
    [],
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      adjustZoom(event.deltaY > 0 ? -zoomStep : zoomStep);
    },
    [adjustZoom],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || event.isPrimary === false) {
        return;
      }
      setIsDragging(true);
      dragStartRef.current = { x: event.clientX, y: event.clientY };
      panStartRef.current = pan;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [pan],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      if (!isDragging) {
        return;
      }
      event.preventDefault();
      const dx = event.clientX - dragStartRef.current.x;
      const dy = event.clientY - dragStartRef.current.y;
      setPan({
        x: panStartRef.current.x + dx,
        y: panStartRef.current.y + dy,
      });
    },
    [isDragging],
  );

  const handlePointerEnd = useCallback((event: PointerEvent) => {
    setIsDragging(false);
    const target = contentRef.current;
    if (target instanceof HTMLElement) {
      target.releasePointerCapture(event.pointerId);
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

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

  return (
    <div
      ref={containerRef}
      className={cn(
        "spirit-mermaid-pan-zoom-host relative flex flex-col",
        fullscreen ? "h-full w-full" : "min-h-28 w-full",
        className,
      )}
      style={{ cursor: isDragging ? "grabbing" : "grab" }}
    >
      {showControls ? (
        <div
          className={cn(
            "spirit-mermaid-pan-zoom-controls absolute z-[1] flex flex-col gap-1 rounded-md border border-border bg-background/80 p-1 supports-[backdrop-filter]:bg-background/70 supports-[backdrop-filter]:backdrop-blur-sm",
            fullscreen ? "bottom-4 left-4" : "bottom-2 left-2",
            controlsAlwaysVisible && "opacity-100",
          )}
        >
          <button
            type="button"
            className="flex items-center justify-center rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            disabled={zoom >= maxZoom}
            onClick={() => adjustZoom(zoomStep)}
            title={zoomInLabel}
            aria-label={zoomInLabel}
          >
            <ZoomIn className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className="flex items-center justify-center rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            disabled={zoom <= minZoom}
            onClick={() => adjustZoom(-zoomStep)}
            title={zoomOutLabel}
            aria-label={zoomOutLabel}
          >
            <ZoomOut className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className="flex items-center justify-center rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={resetView}
            title={zoomResetLabel}
            aria-label={zoomResetLabel}
          >
            <RotateCcw className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}
      <div
        ref={contentRef}
        role="application"
        className={cn(
          "flex w-full flex-1 origin-center items-center justify-center transition-transform duration-150 ease-out",
          fullscreen && "h-full",
        )}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "center center",
          touchAction: "none",
          willChange: "transform",
        }}
        onPointerDown={handlePointerDown}
      >
        {children}
      </div>
    </div>
  );
}

export function SpiritMermaidChart({
  chart,
  mermaidConfig,
  resolvedDark,
  fullscreen = false,
  showControls = true,
  controlsAlwaysVisible = false,
  className,
  eager = false,
}: {
  chart: string;
  mermaidConfig: MermaidConfig;
  resolvedDark: boolean;
  fullscreen?: boolean;
  showControls?: boolean;
  controlsAlwaysVisible?: boolean;
  className?: string;
  eager?: boolean;
}) {
  const plugin = useMemo(() => createSpiritMermaidPlugin(resolvedDark), [resolvedDark]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(eager || fullscreen);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (eager || fullscreen) {
      setShouldRender(true);
      return;
    }
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [eager, fullscreen]);

  useEffect(() => {
    if (!shouldRender) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const mermaid = plugin.getMermaid(mermaidConfig);
        const id = `spirit-mermaid-${Math.abs(hashChart(chart))}-${Date.now()}`;
        const { svg: rendered } = await mermaid.render(id, chart);
        if (!cancelled) {
          setSvg(rendered);
        }
      } catch (renderError) {
        if (!cancelled) {
          setSvg("");
          setError(
            renderError instanceof Error
              ? renderError.message
              : "Failed to render Mermaid chart",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, mermaidConfig, plugin, retryKey, shouldRender]);

  if (!shouldRender && !svg) {
    return <div className={cn("my-4 min-h-[200px]", className)} ref={containerRef} />;
  }

  if (loading && !svg) {
    return (
      <div
        ref={containerRef}
        className={cn(
          "flex items-center justify-center",
          fullscreen ? "size-full min-h-32" : "my-4 min-h-32 w-full p-4",
          className,
        )}
      >
        <Spinner className="size-4 shrink-0 text-muted-foreground" />
      </div>
    );
  }

  if (error && !svg) {
    return (
      <div className={cn("rounded-md bg-destructive/10 p-4", className)} ref={containerRef}>
        <p className="font-mono text-destructive text-sm">Mermaid Error: {error}</p>
        <button
          type="button"
          className="mt-2 text-muted-foreground text-xs underline"
          onClick={() => setRetryKey((key) => key + 1)}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(fullscreen ? "size-full" : "w-full", className)}
      data-streamdown="mermaid"
      ref={containerRef}
    >
      <MermaidPanZoom
        fullscreen={fullscreen}
        showControls={showControls}
        controlsAlwaysVisible={controlsAlwaysVisible}
      >
        <div
          aria-label="Mermaid chart"
          className={cn(
            "flex w-full justify-center",
            fullscreen && "size-full items-center",
            fullscreen ? MERMAID_SVG_LAYOUT_CLASS_FULLSCREEN : MERMAID_SVG_LAYOUT_CLASS_INLINE,
          )}
          dangerouslySetInnerHTML={{ __html: svg }}
          role="img"
        />
      </MermaidPanZoom>
    </div>
  );
}
