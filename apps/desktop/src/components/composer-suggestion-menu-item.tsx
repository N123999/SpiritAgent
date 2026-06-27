import type { ButtonHTMLAttributes, ReactNode } from "react";

import { DESKTOP_OVERLAY_LIST_ITEM, instantHoverMotionClass } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";

type ComposerSuggestionMenuItemProps = {
  selected?: boolean;
  children: ReactNode;
} & Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onMouseDown" | "onMouseEnter" | "onFocus" | "onClick" | "title" | "data-skill-slash-index" | "data-workspace-file-reference-index"
>;

export function ComposerSuggestionMenuItem({
  selected = false,
  children,
  className,
  ...props
}: ComposerSuggestionMenuItemProps & { className?: string }) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full min-w-0 cursor-pointer select-none items-start rounded-sm text-left outline-none",
        DESKTOP_OVERLAY_LIST_ITEM,
        instantHoverMotionClass,
        "hover:bg-accent focus-visible:bg-accent",
        selected && "bg-accent/40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
