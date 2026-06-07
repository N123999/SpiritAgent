import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  useAnchoredItemSwitch,
  type AnchoredItemSwitchTriggerProps,
  type UseAnchoredItemSwitchOptions,
} from "@/hooks/use-anchored-item-switch";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const HOVER_DETAIL_ANCHOR_ATTR = "data-hover-detail-anchor";

/** @deprecated Use `AnchoredItemSwitchTriggerProps` from `@/hooks/use-anchored-item-switch`. */
export type HoverDetailTooltipTriggerProps = AnchoredItemSwitchTriggerProps;

type HoverDetailTooltipContextValue<TItem> = {
  getTriggerProps: (item: TItem) => HoverDetailTooltipTriggerProps;
  anchorItemId: string | null;
  triggerZoneRef: ReturnType<typeof useAnchoredItemSwitch<TItem>>["triggerZoneRef"];
  onTriggerZonePointerLeave: ReturnType<typeof useAnchoredItemSwitch<TItem>>["onTriggerZonePointerLeave"];
  contentRef: ReturnType<typeof useAnchoredItemSwitch<TItem>>["contentRef"];
  contentInteractionProps: ReturnType<typeof useAnchoredItemSwitch<TItem>>["contentInteractionProps"];
  activeItem: TItem | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HoverDetailTooltipContext = createContext<HoverDetailTooltipContextValue<any> | null>(
  null,
);

export function useHoverDetailTooltipContext<TItem>(): HoverDetailTooltipContextValue<TItem> {
  const value = useContext(HoverDetailTooltipContext);
  if (!value) {
    throw new Error("HoverDetailTooltip subcomponents must be used within HoverDetailTooltip");
  }
  return value as HoverDetailTooltipContextValue<TItem>;
}

/** @deprecated Use `UseAnchoredItemSwitchOptions` from `@/hooks/use-anchored-item-switch`. */
export type UseHoverDetailTooltipStateOptions<TItem> = UseAnchoredItemSwitchOptions<TItem>;

/** @deprecated Use `useAnchoredItemSwitch` from `@/hooks/use-anchored-item-switch`. */
export function useHoverDetailTooltipState<TItem>(options: UseHoverDetailTooltipStateOptions<TItem>) {
  const state = useAnchoredItemSwitch(options);
  return {
    popoverOpen: state.open,
    activeItem: state.activeItem,
    anchorItemId: state.anchorItemId,
    getTriggerProps: state.getTriggerProps,
    triggerZoneRef: state.triggerZoneRef,
    onTriggerZonePointerLeave: state.onTriggerZonePointerLeave,
    contentRef: state.contentRef,
    contentInteractionProps: state.contentInteractionProps,
  };
}

export type HoverDetailTooltipProps<TItem> = UseAnchoredItemSwitchOptions<TItem> & {
  children: ReactNode;
};

function HoverDetailTooltipRoot<TItem>({
  getItemId,
  openDelayMs,
  closeDelayMs,
  anchorLingerMs,
  children,
}: HoverDetailTooltipProps<TItem>) {
  const {
    open,
    activeItem,
    anchorItemId,
    getTriggerProps,
    triggerZoneRef,
    onTriggerZonePointerLeave,
    contentRef,
    contentInteractionProps,
    dismissActiveItem,
  } = useAnchoredItemSwitch({
    getItemId,
    openDelayMs,
    closeDelayMs,
    anchorLingerMs,
  });

  const handlePopoverOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && open) {
        dismissActiveItem();
      }
    },
    [dismissActiveItem, open],
  );

  const contextValue = useMemo(
    (): HoverDetailTooltipContextValue<TItem> => ({
      getTriggerProps,
      anchorItemId,
      triggerZoneRef,
      onTriggerZonePointerLeave,
      contentRef,
      contentInteractionProps,
      activeItem,
    }),
    [
      activeItem,
      anchorItemId,
      contentInteractionProps,
      contentRef,
      getTriggerProps,
      onTriggerZonePointerLeave,
      triggerZoneRef,
    ],
  );

  return (
    <HoverDetailTooltipContext.Provider value={contextValue}>
      <Popover open={open} onOpenChange={handlePopoverOpenChange} modal={false}>
        {children}
      </Popover>
    </HoverDetailTooltipContext.Provider>
  );
}

type HoverDetailTooltipTriggerZoneProps = ComponentProps<"div">;

function HoverDetailTooltipTriggerZone({
  ref,
  className,
  onPointerLeave,
  ...props
}: HoverDetailTooltipTriggerZoneProps) {
  const { triggerZoneRef, onTriggerZonePointerLeave } = useHoverDetailTooltipContext();

  return (
    <div
      ref={(node) => {
        triggerZoneRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      }}
      className={className}
      onPointerLeave={(event) => {
        onTriggerZonePointerLeave(event);
        onPointerLeave?.(event);
      }}
      {...props}
    />
  );
}

type HoverDetailTooltipAnchorProps = {
  itemId: string;
  children: ReactElement;
};

function HoverDetailTooltipAnchor({ itemId, children }: HoverDetailTooltipAnchorProps) {
  const { anchorItemId } = useHoverDetailTooltipContext();
  const rowMarker = (
    <div className="block w-full" {...{ [HOVER_DETAIL_ANCHOR_ATTR]: itemId }}>
      {children}
    </div>
  );
  if (anchorItemId === itemId) {
    return <PopoverAnchor asChild>{rowMarker}</PopoverAnchor>;
  }
  return rowMarker;
}

type HoverDetailTooltipContentProps = Omit<
  ComponentProps<typeof PopoverContent>,
  "children" | "ref"
> & {
  children: (activeItem: unknown) => ReactNode;
};

function HoverDetailTooltipContent({
  className,
  children,
  ...props
}: HoverDetailTooltipContentProps) {
  const { activeItem, contentRef, contentInteractionProps } = useHoverDetailTooltipContext();

  return (
    <PopoverContent
      ref={contentRef}
      className={cn(className)}
      onOpenAutoFocus={contentInteractionProps.onOpenAutoFocus}
      onCloseAutoFocus={contentInteractionProps.onCloseAutoFocus}
      onFocusOutside={contentInteractionProps.onFocusOutside}
      onPointerEnter={contentInteractionProps.onPointerEnter}
      onPointerDownOutside={contentInteractionProps.onPointerDownOutside}
      onInteractOutside={contentInteractionProps.onInteractOutside}
      {...props}
    >
      {children(activeItem)}
    </PopoverContent>
  );
}

export const HoverDetailTooltip = Object.assign(HoverDetailTooltipRoot, {
  TriggerZone: HoverDetailTooltipTriggerZone,
  Anchor: HoverDetailTooltipAnchor,
  Content: HoverDetailTooltipContent,
});
