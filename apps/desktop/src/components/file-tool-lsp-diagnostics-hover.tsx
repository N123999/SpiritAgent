import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import type { LspWriteDiagnosticsUi } from "@spirit-agent/core";

import {
  Tooltip,
  TooltipContent,
  TooltipItem,
  useTooltipContext,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function LspDiagnosticsDetailPanel({ diagnostics }: { diagnostics: LspWriteDiagnosticsUi }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-medium text-muted-foreground/70">
        {diagnostics.relativePath}
      </p>
      <ul className="max-h-64 space-y-1.5 overflow-y-auto text-xs leading-relaxed">
        {diagnostics.items.map((item, index) => (
          <li key={`${item.severity}:${item.line}:${item.column}:${index}`} className="min-w-0 break-words">
            <span
              className={cn(
                "font-mono text-[11px]",
                item.severity === "error"
                  ? "text-red-500 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-500",
              )}
            >
              L{item.line}:{item.column}
            </span>
            <span className="text-muted-foreground">
              {item.source ? ` (${item.source})` : ""}
              {item.code !== undefined ? ` [${String(item.code)}]` : ""}
              {": "}
              {item.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FileToolLspDiagnosticsHoverTrigger({
  diagnostics,
  children,
}: {
  itemId: string;
  diagnostics: LspWriteDiagnosticsUi;
  children: ReactElement<{ className?: string; onPointerEnter?: () => void }>;
}) {
  const { getTriggerProps } = useTooltipContext<LspWriteDiagnosticsUi>();
  const { onPointerEnter } = getTriggerProps(diagnostics);

  if (!isValidElement(children)) {
    return children;
  }

  return (
    <Tooltip.Item item={diagnostics}>
      {cloneElement(children, {
        onPointerEnter: () => {
          onPointerEnter();
        },
      })}
    </Tooltip.Item>
  );
}

export function FileToolLspDiagnosticsHover({
  itemId,
  diagnostics,
  children,
}: {
  itemId: string;
  diagnostics: LspWriteDiagnosticsUi;
  children: ReactNode;
}) {
  return (
    <Tooltip<LspWriteDiagnosticsUi> getItemId={() => itemId} delayDuration={300}>
      <Tooltip.Zone className="min-w-0">{children}</Tooltip.Zone>
      <TooltipContent
        appearance="detail"
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className="z-[100] w-80 max-w-[min(20rem,calc(100vw-2rem))] p-3"
      >
        {(activeItem) => {
          const active = activeItem as LspWriteDiagnosticsUi | null;
          return active ? <LspDiagnosticsDetailPanel diagnostics={active} /> : null;
        }}
      </TooltipContent>
    </Tooltip>
  );
}
