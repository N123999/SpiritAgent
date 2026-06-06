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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useAnchoredItemSwitch,
  type AnchoredItemSwitchTriggerProps,
  type UseAnchoredItemSwitchOptions,
} from "@/hooks/use-anchored-item-switch";
import { cn } from "@/lib/utils";

const ANCHORED_SUB_MENU_ANCHOR_ATTR = "data-anchored-sub-menu-anchor";

type AnchoredDropdownSubMenuContextValue<TItem> = {
  getTriggerProps: (item: TItem) => AnchoredItemSwitchTriggerProps;
  anchorItemId: string | null;
  triggerZoneRef: ReturnType<typeof useAnchoredItemSwitch<TItem>>["triggerZoneRef"];
  onTriggerZonePointerLeave: ReturnType<typeof useAnchoredItemSwitch<TItem>>["onTriggerZonePointerLeave"];
  contentRef: ReturnType<typeof useAnchoredItemSwitch<TItem>>["contentRef"];
  contentInteractionProps: ReturnType<typeof useAnchoredItemSwitch<TItem>>["contentInteractionProps"];
  activeItem: TItem | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AnchoredDropdownSubMenuContext = createContext<AnchoredDropdownSubMenuContextValue<any> | null>(
  null,
);

export function useAnchoredDropdownSubMenuContext<TItem>(): AnchoredDropdownSubMenuContextValue<TItem> {
  const value = useContext(AnchoredDropdownSubMenuContext);
  if (!value) {
    throw new Error(
      "AnchoredDropdownSubMenu subcomponents must be used within AnchoredDropdownSubMenu",
    );
  }
  return value as AnchoredDropdownSubMenuContextValue<TItem>;
}

export type AnchoredDropdownSubMenuProps<TItem> = UseAnchoredItemSwitchOptions<TItem> & {
  children: ReactNode;
};

function AnchoredDropdownSubMenuRoot<TItem>({
  getItemId,
  openDelayMs,
  closeDelayMs,
  anchorLingerMs,
  children,
}: AnchoredDropdownSubMenuProps<TItem>) {
  const {
    open,
    dismissActiveItem,
    getTriggerProps,
    anchorItemId,
    triggerZoneRef,
    onTriggerZonePointerLeave,
    contentRef,
    contentInteractionProps,
    activeItem,
  } = useAnchoredItemSwitch({
    getItemId,
    openDelayMs,
    closeDelayMs,
    anchorLingerMs,
  });

  const handleSubOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && open) {
        dismissActiveItem();
      }
    },
    [dismissActiveItem, open],
  );

  const contextValue = useMemo(
    (): AnchoredDropdownSubMenuContextValue<TItem> => ({
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
    <AnchoredDropdownSubMenuContext.Provider value={contextValue}>
      <DropdownMenuSub open={open} onOpenChange={handleSubOpenChange}>
        {children}
      </DropdownMenuSub>
    </AnchoredDropdownSubMenuContext.Provider>
  );
}

type AnchoredDropdownSubMenuTriggerZoneProps = ComponentProps<"div">;

function AnchoredDropdownSubMenuTriggerZone({
  ref,
  className,
  onPointerLeave,
  ...props
}: AnchoredDropdownSubMenuTriggerZoneProps) {
  const { triggerZoneRef, onTriggerZonePointerLeave } = useAnchoredDropdownSubMenuContext();

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

type AnchoredDropdownSubMenuAnchorProps = {
  itemId: string;
  children: ReactElement;
};

function AnchoredDropdownSubMenuAnchor({ itemId, children }: AnchoredDropdownSubMenuAnchorProps) {
  const { anchorItemId } = useAnchoredDropdownSubMenuContext();
  // SubTrigger must merge onto the row itself. An extra wrapper div would stack SubTrigger
  // padding (py-1.5 px-2) on top of DESKTOP_OVERLAY_LIST_SUB_TRIGGER and double row height.
  if (anchorItemId === itemId) {
    return (
      <DropdownMenuSubTrigger asChild {...{ [ANCHORED_SUB_MENU_ANCHOR_ATTR]: itemId }}>
        {children}
      </DropdownMenuSubTrigger>
    );
  }
  return children;
}

type AnchoredDropdownSubMenuContentProps = Omit<
  ComponentProps<typeof DropdownMenuSubContent>,
  "children" | "ref"
> & {
  children: (activeItem: unknown) => ReactNode;
};

function AnchoredDropdownSubMenuContent({
  className,
  children,
  ...props
}: AnchoredDropdownSubMenuContentProps) {
  const { activeItem, contentRef, contentInteractionProps } = useAnchoredDropdownSubMenuContext();

  return (
    <DropdownMenuSubContent
      ref={contentRef}
      className={cn(className)}
      onPointerEnter={contentInteractionProps.onPointerEnter}
      onPointerDownOutside={contentInteractionProps.onPointerDownOutside}
      onInteractOutside={contentInteractionProps.onInteractOutside}
      {...props}
    >
      {children(activeItem)}
    </DropdownMenuSubContent>
  );
}

export const AnchoredDropdownSubMenu = Object.assign(AnchoredDropdownSubMenuRoot, {
  TriggerZone: AnchoredDropdownSubMenuTriggerZone,
  Anchor: AnchoredDropdownSubMenuAnchor,
  Content: AnchoredDropdownSubMenuContent,
});
