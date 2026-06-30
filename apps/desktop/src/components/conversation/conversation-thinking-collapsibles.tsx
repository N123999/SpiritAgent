import { useEffect, useRef, useState } from "react";

import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AgentMarkdownMessage } from "@/components/agent-markdown-message";
import {
  AnimatedCollapse,
  AnimatedCollapseContent,
  AnimatedCollapseTrigger,
} from "@/components/ui/animated-collapse";
import type { ReadManagedImagePreview, ReadManagedVideoPreview } from "@/components/tool-call/tool-call-types";
import { assistantCompactionLive } from "@/lib/conversation-compaction-ui";
import {
  isAssistantReasoningLive,
} from "@/lib/conversation-thinking-ui";
import {
  isGenericPendingCompactionStatusText,
  isGenericPendingThinkingStatusText,
} from "@/lib/subagent-display";
import { cn } from "@/lib/utils";
import type { ConversationMessageSnapshot, PendingAssistantAux } from "@/types";

/** 随 `active` 切换 `.spirit-thinking-shimmer-text`（样式与动画在 `styles.css`）。 */
export function ReasoningLabelWithShimmer({
  active,
  activeLabel,
  idleLabel,
}: {
  active: boolean;
  activeLabel: string;
  idleLabel: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 text-xs font-medium tracking-wide",
        active ? "spirit-thinking-shimmer-text" : "text-muted-foreground",
      )}
    >
      {active ? activeLabel : idleLabel}
    </span>
  );
}

export function ThinkingLabelWithShimmer({ active }: { active: boolean }) {
  const { t } = useTranslation();
  return (
    <ReasoningLabelWithShimmer
      active={active}
      activeLabel={t("app.reasoningThinkingActive")}
      idleLabel={t("app.reasoningThinkingIdle")}
    />
  );
}

export function CompactionLabelWithShimmer({ active }: { active: boolean }) {
  return (
    <ReasoningLabelWithShimmer active={active} activeLabel="Compacting" idleLabel="Compacted" />
  );
}

export function AssistantThinkingCollapsible({
  message,
  pendingAuxState,
  messages,
  listIndex,
  collapseDuringToolPreview,
  readManagedImagePreviewDataUrl,
  readManagedVideoPreviewUrl,
}: {
  message: ConversationMessageSnapshot;
  pendingAuxState?: PendingAssistantAux;
  messages: readonly ConversationMessageSnapshot[];
  listIndex: number;
  collapseDuringToolPreview: boolean;
  readManagedImagePreviewDataUrl: ReadManagedImagePreview;
  readManagedVideoPreviewUrl: ReadManagedVideoPreview;
}) {
  const thinking = message.aux?.thinking?.trim() ?? "";
  const reasoningLive = isAssistantReasoningLive(message, pendingAuxState, messages, listIndex);
  const showThinkingBody = Boolean(thinking && !isGenericPendingThinkingStatusText(thinking));
  const thinkingActive = reasoningLive && !collapseDuringToolPreview;
  if (!thinking && !reasoningLive) {
    return null;
  }
  if (!showThinkingBody && !thinkingActive) {
    return null;
  }
  const autoExpanded = thinkingActive && showThinkingBody;
  const [manualOpen, setManualOpen] = useState(false);
  const prevAutoExpandedRef = useRef(autoExpanded);

  useEffect(() => {
    if (prevAutoExpandedRef.current && !autoExpanded) {
      setManualOpen(false);
    }
    prevAutoExpandedRef.current = autoExpanded;
  }, [autoExpanded]);

  const expanded = autoExpanded || manualOpen;
  const interactive = !autoExpanded;

  return (
    <AnimatedCollapse
      open={expanded}
      onOpenChange={(open) => {
        if (!interactive) {
          return;
        }
        setManualOpen(open);
      }}
      className="min-w-0 py-0.5"
    >
      <AnimatedCollapseTrigger
        className={cn(
          "group flex w-full min-w-0 items-center gap-1 text-left outline-none",
          interactive ? "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50" : "cursor-default",
        )}
      >
        <ThinkingLabelWithShimmer active={thinkingActive} />
        {interactive ? (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground/55 transition-all duration-150",
              "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
              expanded && "rotate-90",
            )}
            aria-hidden
          />
        ) : null}
      </AnimatedCollapseTrigger>
      {showThinkingBody ? (
        <AnimatedCollapseContent className="min-w-0">
          <div className="overflow-hidden pt-1.5 [&_p:last-child]:mb-0 [&_ul:last-child]:mb-0 [&_ol:last-child]:mb-0 [&_blockquote:last-child]:mb-0 [&_pre:last-child]:mb-0">
            <AgentMarkdownMessage
              content={thinking}
              streaming={thinkingActive && expanded}
              tone="muted"
              readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
              readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
            />
          </div>
        </AnimatedCollapseContent>
      ) : null}
    </AnimatedCollapse>
  );
}

export function AssistantCompactionCollapsible({
  message,
  pendingAuxState,
  readManagedImagePreviewDataUrl,
  readManagedVideoPreviewUrl,
}: {
  message: ConversationMessageSnapshot;
  pendingAuxState?: PendingAssistantAux;
  readManagedImagePreviewDataUrl: ReadManagedImagePreview;
  readManagedVideoPreviewUrl: ReadManagedVideoPreview;
}) {
  const compaction = message.aux?.compaction?.trim() ?? "";
  const compactionLive = assistantCompactionLive(message, pendingAuxState);
  const showCompactionBody = Boolean(
    compaction && !isGenericPendingCompactionStatusText(compaction),
  );
  const compactionActive = compactionLive;
  const autoExpanded = compactionActive && showCompactionBody;
  const [manualOpen, setManualOpen] = useState(false);
  const prevAutoExpandedRef = useRef(autoExpanded);

  useEffect(() => {
    if (prevAutoExpandedRef.current && !autoExpanded) {
      setManualOpen(false);
    }
    prevAutoExpandedRef.current = autoExpanded;
  }, [autoExpanded]);

  const expanded = autoExpanded || manualOpen;
  const interactive = !autoExpanded;

  return (
    <AnimatedCollapse
      open={expanded}
      onOpenChange={(open) => {
        if (!interactive) {
          return;
        }
        setManualOpen(open);
      }}
      className="min-w-0 py-0.5"
    >
      <AnimatedCollapseTrigger
        className={cn(
          "group flex w-full min-w-0 items-center gap-1 text-left outline-none",
          interactive ? "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50" : "cursor-default",
        )}
      >
        <CompactionLabelWithShimmer active={compactionActive} />
        {interactive ? (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground/55 transition-all duration-150",
              "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
              expanded && "rotate-90",
            )}
            aria-hidden
          />
        ) : null}
      </AnimatedCollapseTrigger>
      {showCompactionBody ? (
        <AnimatedCollapseContent className="min-w-0">
          <div className="overflow-hidden pt-1.5 [&_p:last-child]:mb-0 [&_ul:last-child]:mb-0 [&_ol:last-child]:mb-0 [&_blockquote:last-child]:mb-0 [&_pre:last-child]:mb-0">
            <AgentMarkdownMessage
              content={compaction}
              streaming={compactionActive}
              tone="muted"
              readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
              readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
            />
          </div>
        </AnimatedCollapseContent>
      ) : null}
    </AnimatedCollapse>
  );
}
