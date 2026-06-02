import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { EditFileLineDelta } from "@/lib/edit-file-line-delta";

type SlideDirection = "up" | "down" | "none";

function AnimatedCount({
  value,
  className,
}: {
  value: number;
  className: string;
}) {
  const previousRef = useRef(value);
  const [direction, setDirection] = useState<SlideDirection>("none");

  useLayoutEffect(() => {
    const previous = previousRef.current;
    if (value > previous) {
      setDirection("up");
    } else if (value < previous) {
      setDirection("down");
    } else {
      setDirection("none");
    }
    previousRef.current = value;
  }, [value]);

  return (
    <span
      className={cn(
        "relative inline-flex h-[1.125em] min-w-[1.25ch] overflow-hidden tabular-nums leading-none",
        className,
      )}
      aria-hidden
    >
      <span
        key={value}
        className={cn(
          "inline-block",
          direction === "up" && "spirit-edit-delta-slide-up",
          direction === "down" && "spirit-edit-delta-slide-down",
        )}
      >
        {value}
      </span>
    </span>
  );
}

export function EditFileLineDeltaBadge({ delta }: { delta: EditFileLineDelta }) {
  if (delta.added === 0 && delta.removed === 0) {
    return null;
  }

  return (
    <span className="shrink-0 text-xs font-medium leading-none tabular-nums">
      {delta.added > 0 ? (
        <span className="inline-flex items-center text-emerald-600 dark:text-emerald-400">
          <span aria-hidden>+</span>
          <AnimatedCount value={delta.added} className="text-emerald-600 dark:text-emerald-400" />
        </span>
      ) : null}
      {delta.added > 0 && delta.removed > 0 ? " " : null}
      {delta.removed > 0 ? (
        <span className="inline-flex items-center text-red-500 dark:text-red-400">
          <span aria-hidden>-</span>
          <AnimatedCount value={delta.removed} className="text-red-500 dark:text-red-400" />
        </span>
      ) : null}
    </span>
  );
}
