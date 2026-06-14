import { useTranslation } from "react-i18next";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Mirrors comment card indent in `workspace-pr-conversation-timeline` — not tied to demo data. */
const TIMELINE_COMMENT_CARD_INDENT_CLASS = "w-7 shrink-0";
const TIMELINE_ITEMS_CLASS = "space-y-4";

const PR_DETAIL_TAB_WIDTHS = ["w-16", "w-12", "w-11", "w-14"] as const;

const CONVERSATION_ROW_VARIANTS = [
  { cardLines: ["w-full", "w-[92%]", "w-[68%]"] },
  { cardLines: ["w-[88%]", "w-[54%]"] },
  { cardLines: ["w-full", "w-[76%]"] },
  { cardLines: ["w-[95%]", "w-full", "w-[62%]", "w-[40%]"] },
] as const;

function PrSkeletonBlock({ className }: { className?: string }) {
  return <Skeleton className={className} />;
}

function PrConversationTimelineSkeletonRow({
  cardLines,
}: {
  cardLines: readonly string[];
}) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <PrSkeletonBlock className="size-5 shrink-0 rounded-full" />
        <PrSkeletonBlock className="h-3 w-20" />
        <PrSkeletonBlock className="h-2.5 w-12" />
      </div>
      <div className="mt-2 flex min-w-0">
        <div className={TIMELINE_COMMENT_CARD_INDENT_CLASS} aria-hidden />
        <div className="min-w-0 flex-1 space-y-2 rounded-lg border border-border/50 bg-muted/40 px-3 py-2">
          {cardLines.map((widthClass, index) => (
            <PrSkeletonBlock key={index} className={cn("h-3", widthClass)} />
          ))}
        </div>
      </div>
    </div>
  );
}

export type WorkspacePrDetailSkeletonProps = {
  className?: string;
  loadingLabel?: string;
};

/** Placeholder layout aligned with `WorkspacePrDetailView`; independent of PR demo fixtures. */
export function WorkspacePrDetailSkeleton({
  className,
  loadingLabel,
}: WorkspacePrDetailSkeletonProps) {
  const { t } = useTranslation();
  const ariaLabel = loadingLabel ?? t("workspace.prLoading");

  return (
    <article
      className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}
      aria-busy="true"
      aria-label={ariaLabel}
    >
      <ScrollArea className="shrink-0 overflow-hidden" type="auto" style={{ maxHeight: "38%" }}>
        <header className="space-y-2 px-3 pt-3 pb-3">
          <div className="relative min-w-0">
            <div className="min-w-0 pr-[calc(theme(spacing.28)+0.25rem)]">
              <PrSkeletonBlock className="h-4 w-[min(100%,18rem)] max-w-full" />
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <PrSkeletonBlock className="h-5 w-16 rounded-full" />
                <PrSkeletonBlock className="h-3 w-28" />
                <PrSkeletonBlock className="h-2.5 w-2.5 rounded-sm" />
                <PrSkeletonBlock className="h-3 w-20" />
              </div>
            </div>
            <PrSkeletonBlock className="absolute right-0 top-1/2 h-6 w-20 -translate-y-1/2 rounded-md" />
          </div>
          <div className="space-y-2 pt-1">
            <PrSkeletonBlock className="h-3 w-full" />
            <PrSkeletonBlock className="h-3 w-[94%]" />
            <PrSkeletonBlock className="h-3 w-[72%]" />
          </div>
        </header>
      </ScrollArea>

      <div className="h-1 shrink-0" aria-hidden />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 w-full border-b border-border/40">
          <div className="flex flex-wrap gap-3 px-3 pt-0.5 pb-3">
            {PR_DETAIL_TAB_WIDTHS.map((widthClass, index) => (
              <PrSkeletonBlock
                key={index}
                className={cn("h-4 rounded-sm", widthClass, index === 0 && "opacity-100")}
              />
            ))}
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1" type="auto">
          <div className="space-y-2 px-3 pt-3 pb-3">
            <div className={TIMELINE_ITEMS_CLASS}>
              {CONVERSATION_ROW_VARIANTS.map((variant, index) => (
                <PrConversationTimelineSkeletonRow
                  key={index}
                  cardLines={variant.cardLines}
                />
              ))}
            </div>
          </div>
        </ScrollArea>
      </div>
    </article>
  );
}
