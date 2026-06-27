import type { ComponentProps, ReactNode } from "react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DESKTOP_OVERLAY_LIST_ITEM } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";

type ComposerSuggestionMenuItemProps = {
  selected?: boolean;
  children: ReactNode;
  onClick?: () => void;
} & Pick<
  ComponentProps<typeof DropdownMenuItem>,
  "onMouseDown" | "onMouseEnter" | "onFocus" | "title"
> & {
  "data-skill-slash-index"?: number;
  "data-workspace-file-reference-index"?: number;
};

export function ComposerSuggestionMenuItem({
  selected = false,
  children,
  className,
  onClick,
  ...props
}: ComposerSuggestionMenuItemProps & { className?: string }) {
  return (
    <DropdownMenuItem
      className={cn(
        "items-start",
        DESKTOP_OVERLAY_LIST_ITEM,
        selected && "bg-accent text-accent-foreground",
        className,
      )}
      onSelect={(event) => {
        event.preventDefault();
        onClick?.();
      }}
      {...props}
    >
      {children}
    </DropdownMenuItem>
  );
}
