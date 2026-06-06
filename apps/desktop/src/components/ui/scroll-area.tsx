import * as React from "react";
import {
  Corner,
  Root,
  Scrollbar,
  Thumb,
  Viewport,
} from "@radix-ui/react-scroll-area";

import { useScrollAreaMotionSync } from "@/lib/scroll-area-motion-sync";
import { cn } from "@/lib/utils";

const ScrollBar = React.forwardRef<
  React.ComponentRef<typeof Scrollbar>,
  React.ComponentPropsWithoutRef<typeof Scrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <Scrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none p-px transition-[opacity,colors] duration-150",
      orientation === "vertical" && "h-full w-1.5 border-l border-l-transparent",
      orientation === "horizontal" && "h-1.5 border-t border-t-transparent",
      className,
    )}
    {...props}
  >
    <Thumb className="relative flex-1 rounded-full bg-foreground/12 dark:bg-foreground/10" />
  </Scrollbar>
));
ScrollBar.displayName = "ScrollBar";

const ScrollArea = React.forwardRef<
  React.ComponentRef<typeof Root>,
  React.ComponentPropsWithoutRef<typeof Root> & {
    scrollbars?: "vertical" | "horizontal" | "both";
  }
>(
  (
    {
      className,
      children,
      type = "hover",
      scrollHideDelay = 500,
      scrollbars = "vertical",
      ...props
    },
    ref,
  ) => {
    const rootRef = React.useRef<React.ComponentRef<typeof Root>>(null);
    const setRootRef = React.useCallback(
      (node: React.ComponentRef<typeof Root> | null) => {
        rootRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      },
      [ref],
    );
    useScrollAreaMotionSync(rootRef);

    const viewportChildClass =
      scrollbars === "horizontal"
        ? "[&>div]:!block [&>div]:!min-h-0 [&>div]:min-w-0 [&>div]:!w-max"
        : scrollbars === "both"
          ? "[&>div]:!block [&>div]:!min-h-0 [&>div]:min-w-0 [&>div]:!w-max [&>div]:min-h-full"
          : "[&>div]:!block [&>div]:!min-h-0 [&>div]:min-w-0 [&>div]:w-full";

    return (
      <Root
        ref={setRootRef}
        type={type}
        scrollHideDelay={scrollHideDelay}
        className={cn("relative min-w-0 overflow-hidden", className)}
        {...props}
      >
        <Viewport
          // Radix 内层默认 display:table + min-width:100% 会按「内容固有宽度」撑开，flex 内 truncate/ellipsis 失效（radix-ui/primitives#926）。
          // 用 !block + min-w-0 + 宽度约束覆盖表格格式化上下文，与官方 issue 中推荐一致。
          className={cn(
            "h-full w-full min-h-0 min-w-0 rounded-[inherit] [display:block]",
            viewportChildClass,
          )}
        >
          {children}
        </Viewport>
        {scrollbars === "vertical" || scrollbars === "both" ? <ScrollBar /> : null}
        {scrollbars === "horizontal" || scrollbars === "both" ? (
          <ScrollBar orientation="horizontal" />
        ) : null}
        <Corner className="bg-transparent" />
      </Root>
    );
  },
);
ScrollArea.displayName = "ScrollArea";

export { ScrollArea, ScrollBar };
