import { useState } from "react";

import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AgentMarkdownMessage } from "@/components/agent-markdown-message";
import {
  AnimatedCollapse,
  AnimatedCollapseContent,
  AnimatedCollapseTrigger,
} from "@/components/ui/animated-collapse";
import {
  isGenericPendingThinkingStatusText,
} from "@/lib/subagent-display";
import { cn } from "@/lib/utils";
import type { ConversationMessageSnapshot } from "@/types";

type ReadManagedImagePreview = (reference: string) => Promise<string | null>;
type ReadManagedVideoPreview = (reference: string) => Promise<string | null>;

function ReasoningLabel({ active, activeLabel, idleLabel }: {
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

function ProcessGroupReasoningBlock({
  labelActive,
  activeLabel,
  idleLabel,
  body,
  streaming,
  readManagedImagePreviewDataUrl,
  readManagedVideoPreviewUrl,
}: {
  labelActive: boolean;
  activeLabel: string;
  idleLabel: string;
  body: string;
  streaming: boolean;
  readManagedImagePreviewDataUrl: ReadManagedImagePreview;
  readManagedVideoPreviewUrl: ReadManagedVideoPreview;
}) {
  const [open, setOpen] = useState(false);

  return (
    <AnimatedCollapse open={open} onOpenChange={setOpen} className="min-w-0 py-0.5">
      <AnimatedCollapseTrigger
        className={cn(
          "group flex w-full min-w-0 items-center gap-1 text-left outline-none",
          "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
      >
        <ReasoningLabel active={labelActive} activeLabel={activeLabel} idleLabel={idleLabel} />
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground/55 transition-all duration-150",
            "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
            open && "rotate-90",
          )}
          aria-hidden
        />
      </AnimatedCollapseTrigger>
      <AnimatedCollapseContent className="min-w-0">
        <div className="overflow-hidden pt-1.5 [&_p:last-child]:mb-0 [&_ul:last-child]:mb-0 [&_ol:last-child]:mb-0 [&_blockquote:last-child]:mb-0 [&_pre:last-child]:mb-0">
          <AgentMarkdownMessage
            content={body}
            streaming={streaming && open}
            tone="muted"
            readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
            readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
          />
        </div>
      </AnimatedCollapseContent>
    </AnimatedCollapse>
  );
}

export function ProcessGroupThinkingBlock({
  message,
  thinkingActive,
  readManagedImagePreviewDataUrl,
  readManagedVideoPreviewUrl,
}: {
  message: ConversationMessageSnapshot;
  thinkingActive: boolean;
  readManagedImagePreviewDataUrl: ReadManagedImagePreview;
  readManagedVideoPreviewUrl: ReadManagedVideoPreview;
}) {
  const { t } = useTranslation();
  const thinking = message.aux?.thinking?.trim() ?? "";
  if (!thinking || isGenericPendingThinkingStatusText(thinking)) {
    return null;
  }

  return (
    <ProcessGroupReasoningBlock
      labelActive={thinkingActive}
      activeLabel={t("app.reasoningThinkingActive")}
      idleLabel={t("app.reasoningThinkingIdle")}
      body={thinking}
      streaming={thinkingActive}
      readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
      readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
    />
  );
}
