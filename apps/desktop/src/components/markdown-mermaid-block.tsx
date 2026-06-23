import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2, X } from "lucide-react";
import type { MermaidConfig } from "mermaid";
import type { CustomRendererProps } from "streamdown";

import {
  LOCAL_IMAGE_FLOATING_ACTION_BUTTON_CLASS,
} from "@/components/local-image-preview-dialog";
import { SpiritMermaidChart } from "@/components/spirit-mermaid-chart";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { getSpiritMermaidConfig } from "@/lib/markdown-mermaid-theme";
import { cn } from "@/lib/utils";

function MermaidChartSkeleton() {
  return (
    <div className="flex min-h-32 w-full items-center justify-center">
      <Spinner className="size-4 text-muted-foreground" />
    </div>
  );
}

function MermaidPreviewDialog({
  open,
  onOpenChange,
  chart,
  mermaidConfig,
  resolvedDark,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  chart: string;
  mermaidConfig: MermaidConfig;
  resolvedDark: boolean;
}) {
  const { t } = useTranslation();
  const closeLabel = t("app.closeDiagramPreview");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-background/40 backdrop-blur-md"
        className="w-auto max-w-none gap-0 border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-none"
      >
        <div
          data-spirit-mermaid-preview
          className={cn(
            "pointer-events-auto relative inline-flex overflow-hidden rounded-[1.1rem] border border-border/45 bg-background",
            "h-[min(calc(100dvh-4rem),48rem)] w-[min(calc(100dvw-4rem),70rem)] max-h-[calc(100dvh-2rem)] max-w-[calc(100dvw-2rem)]",
          )}
        >
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn("absolute top-3 right-3 z-[1]", LOCAL_IMAGE_FLOATING_ACTION_BUTTON_CLASS)}
              title={closeLabel}
              aria-label={closeLabel}
            >
              <X className="size-4" aria-hidden />
              <span className="sr-only">{closeLabel}</span>
            </Button>
          </DialogClose>
          <div className="flex size-full flex-col p-4 pt-12">
            <SpiritMermaidChart
              chart={chart}
              mermaidConfig={mermaidConfig}
              resolvedDark={resolvedDark}
              fullscreen
              showControls
              controlsAlwaysVisible
              eager
              className="min-h-0 flex-1"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MarkdownMermaidBlock({
  code,
  isIncomplete,
  resolvedDark,
}: CustomRendererProps & { resolvedDark: boolean }) {
  const { t } = useTranslation();
  const [viewerOpen, setViewerOpen] = useState(false);
  const mermaidConfig = getSpiritMermaidConfig(resolvedDark);
  const expandLabel = t("app.viewLargeDiagram");

  if (isIncomplete) {
    return <MermaidChartSkeleton />;
  }

  const openPreview = () => {
    setViewerOpen(true);
  };

  return (
    <>
      <div
        className="group relative my-2 flex w-full flex-col gap-0 overflow-hidden rounded-md border border-border/40 bg-muted/30"
        data-incomplete={isIncomplete || undefined}
        data-streamdown="mermaid-block"
      >
        <div
          className="pointer-events-none absolute top-2 right-2 z-[1]"
          data-streamdown="mermaid-block-actions"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "pointer-events-auto opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100",
              LOCAL_IMAGE_FLOATING_ACTION_BUTTON_CLASS,
            )}
            onClick={openPreview}
            title={expandLabel}
            aria-label={expandLabel}
          >
            <Maximize2 className="size-4" aria-hidden />
          </Button>
        </div>
        <div className="min-w-0">
          <SpiritMermaidChart
            chart={code}
            mermaidConfig={mermaidConfig}
            resolvedDark={resolvedDark}
            showControls
          />
        </div>
      </div>

      <MermaidPreviewDialog
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        chart={code}
        mermaidConfig={mermaidConfig}
        resolvedDark={resolvedDark}
      />
    </>
  );
}

export function createMarkdownMermaidRenderer(resolvedDark: boolean) {
  return {
    language: "mermaid" as const,
    component: (props: CustomRendererProps) => (
      <MarkdownMermaidBlock {...props} resolvedDark={resolvedDark} />
    ),
  };
}
