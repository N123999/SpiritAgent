import * as React from "react";
import {
  Corner,
  Root,
  Scrollbar,
  Thumb,
  Viewport,
} from "@radix-ui/react-scroll-area";

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
  React.ComponentPropsWithoutRef<typeof Root>
>(
  (
    { className, children, type = "hover", scrollHideDelay = 500, ...props },
    ref,
  ) => (
    <Root
      ref={ref}
      type={type}
      scrollHideDelay={scrollHideDelay}
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <Viewport
        // Radix 在 Viewport 内会包一层，保证子代可滚动且 min-height 不撑破 flex
        className="h-full w-full min-h-0 rounded-[inherit] [display:block] [&>div]:!min-h-0"
      >
        {children}
      </Viewport>
      <ScrollBar />
      <Corner className="bg-transparent" />
    </Root>
  ),
);
ScrollArea.displayName = "ScrollArea";

export { ScrollArea, ScrollBar };
