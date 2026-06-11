import { useState, type ReactNode } from "react";

import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  ProcessGroupCompactionBlock,
  ProcessGroupThinkingBlock,
} from "@/components/process-group-blocks";
import {
  AnimatedCollapse,
  AnimatedCollapseContent,
  AnimatedCollapseTrigger,
} from "@/components/ui/animated-collapse";
import { formatProcessGroupSummary } from "@/lib/process-summary-format";
import type { ProcessToolCounts } from "@/lib/process-tool-category";
import { assistantCompactionLive } from "@/lib/conversation-compaction-ui";
import { isAssistantReasoningLive } from "@/lib/conversation-thinking-ui";
import { cn } from "@/lib/utils";
import type { ConversationMessageSnapshot, PendingAssistantAux } from "@/types";

type ReadManagedImagePreview = (reference: string) => Promise<string | null>;
type ReadManagedVideoPreview = (reference: string) => Promise<string | null>;

export function ProcessCardCollapsible({
  groupId,
  messageIndices,
  messages,
  sealed,
  toolCounts,
  pendingAuxState,
  manualOpen,
  onManualOpenChange,
  renderToolBlock,
  readManagedImagePreviewDataUrl,
  readManagedVideoPreviewUrl,
}: {
  groupId: string;
  messageIndices: readonly number[];
  messages: readonly ConversationMessageSnapshot[];
  sealed: boolean;
  toolCounts: ProcessToolCounts;
  pendingAuxState?: PendingAssistantAux;
  manualOpen?: boolean;
  onManualOpenChange?(open: boolean): void;
  renderToolBlock: (message: ConversationMessageSnapshot, messageIndex: number) => ReactNode;
  readManagedImagePreviewDataUrl: ReadManagedImagePreview;
  readManagedVideoPreviewUrl: ReadManagedVideoPreview;
}) {
  const { t } = useTranslation();
  const summary = formatProcessGroupSummary(t, toolCounts, messages, messageIndices);
  const [localManualOpen, setLocalManualOpen] = useState(false);
  const manualOpenControlled = manualOpen !== undefined;
  const manualOpenValue = manualOpenControlled ? manualOpen : localManualOpen;
  const setManualOpenValue = (open: boolean) => {
    if (manualOpenControlled) {
      onManualOpenChange?.(open);
      return;
    }
    setLocalManualOpen(open);
  };
  const expanded = manualOpenValue;
  const interactive = sealed;

  if (!summary) {
    return null;
  }

  return (
    <AnimatedCollapse
      open={expanded}
      onOpenChange={(open) => {
        if (!interactive) {
          return;
        }
        setManualOpenValue(open);
      }}
      className="min-w-0 py-0.5"
      data-process-group-id={groupId}
    >
      <AnimatedCollapseTrigger
        className={cn(
          "group flex w-full min-w-0 items-center gap-1 text-left outline-none",
          interactive ? "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50" : "cursor-default",
        )}
      >
        <span className="min-w-0 truncate text-xs font-medium tracking-wide text-muted-foreground">
          {summary}
        </span>
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
      <AnimatedCollapseContent className="min-w-0">
        <div className="space-y-3 pt-6">
          {messageIndices.map((messageIndex) => {
            const message = messages[messageIndex];
            if (!message) {
              return null;
            }

            const thinkingNode = message.aux?.thinking?.trim() ? (
              <ProcessGroupThinkingBlock
                message={message}
                thinkingActive={isAssistantReasoningLive(
                  message,
                  pendingAuxState,
                  messages,
                  messageIndex,
                )}
                readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
                readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
              />
            ) : null;

            const compactionNode = message.aux?.compaction?.trim() ? (
              <ProcessGroupCompactionBlock
                message={message}
                compactionActive={assistantCompactionLive(message, pendingAuxState)}
                readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
                readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
              />
            ) : null;

            const standaloneThinkingOrCompaction =
              !message.tool && !message.content.trim() && (thinkingNode || compactionNode);

            if (standaloneThinkingOrCompaction) {
              return (
                <div key={`${groupId}-${messageIndex}-aux`} className="pb-3 last:pb-0">
                  {thinkingNode}
                  {compactionNode}
                </div>
              );
            }

            if (message.tool) {
              return (
                <div key={`${groupId}-${messageIndex}-tool`} className="pb-3 last:pb-0">
                  {renderToolBlock(message, messageIndex)}
                </div>
              );
            }

            if (thinkingNode || compactionNode) {
              return (
                <div key={`${groupId}-${messageIndex}-inline-aux`} className="pb-3 last:pb-0">
                  {thinkingNode}
                  {compactionNode}
                </div>
              );
            }

            return null;
          })}
        </div>
      </AnimatedCollapseContent>
    </AnimatedCollapse>
  );
}
