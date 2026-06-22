import * as React from "react";
import { Check, ChevronRight } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

import {
  DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
} from "@/lib/desktop-chrome";
import { isEventTargetWithinTooltipCompanionOverlays } from "@/hooks/tooltip-switch-registry";
import { radixAnchoredOverlayMotion } from "@/lib/overlay-motion";
import { cn } from "@/lib/utils";

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
  );
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto size-4 text-muted-foreground/80" aria-hidden />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        data-slot="dropdown-menu-sub-content"
        sideOffset={sideOffset}
        className={cn(
          radixAnchoredOverlayMotion("dropdown-menu"),
          "spirit-scroll z-50 max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] min-w-32 overflow-y-auto overflow-x-hidden",
          DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

type DropdownMenuContentProps = React.ComponentProps<
  typeof DropdownMenuPrimitive.Content
> & {
  /** Menu Content mount focus hook; omitted from upstream DropdownMenu types. */
  onOpenAutoFocus?: (event: Event) => void;
  /** Menu roving-focus entry hook; omitted from upstream DropdownMenu types. */
  onEntryFocus?: (event: Event) => void;
};

function preventDropdownDismissForTooltipCompanion(
  event: { target: EventTarget | null; preventDefault(): void },
): void {
  if (!isEventTargetWithinTooltipCompanionOverlays(event.target)) {
    return;
  }
  event.preventDefault();
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  onPointerDownOutside,
  onInteractOutside,
  onFocusOutside,
  ...props
}: DropdownMenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          radixAnchoredOverlayMotion("dropdown-menu"),
          "spirit-scroll z-50 max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] min-w-32 overflow-y-auto overflow-x-hidden",
          DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
          className,
        )}
        onPointerDownOutside={(event) => {
          preventDropdownDismissForTooltipCompanion(event);
          onPointerDownOutside?.(event);
        }}
        onInteractOutside={(event) => {
          preventDropdownDismissForTooltipCompanion(event);
          onInteractOutside?.(event);
        }}
        onFocusOutside={(event) => {
          preventDropdownDismissForTooltipCompanion(event);
          onFocusOutside?.(event);
        }}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      checked={checked}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pr-2 pl-8 text-xs outline-none",
        "focus:bg-accent focus:text-accent-foreground",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-4" aria-hidden />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
};
