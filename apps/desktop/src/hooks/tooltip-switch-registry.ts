/** Matches `RADIX_OVERLAY_CLOSE_MS` in overlay-motion (Radix popover exit animation). */
export const TOOLTIP_SWITCH_CONTENT_LINGER_MS = 100;

const ANCHORED_ITEM_SWITCH_RELATED_OVERLAY_SELECTOR = '[data-slot="select-content"]';

function isDomNode(target: EventTarget | null): target is Node {
  if (target === null || typeof target !== "object") {
    return false;
  }
  return "nodeType" in target && typeof (target as Node).contains === "function";
}

function domTargetClosest(target: EventTarget, selector: string): Element | null {
  const element =
    "closest" in target && typeof (target as Element).closest === "function"
      ? (target as Element)
      : "parentElement" in target
        ? (target as Node).parentElement
        : null;
  return element?.closest(selector) ?? null;
}

function isWithinAnchoredItemSwitchRelatedTarget(
  target: EventTarget | null,
  refs: { triggerZone: HTMLDivElement | null; content: HTMLDivElement | null },
): boolean {
  if (!isDomNode(target)) {
    return false;
  }
  if (refs.triggerZone?.contains(target) || refs.content?.contains(target)) {
    return true;
  }
  return domTargetClosest(target, ANCHORED_ITEM_SWITCH_RELATED_OVERLAY_SELECTOR) !== null;
}

function deriveAnchoredItemSwitchOpen(activeItem: unknown): boolean {
  return activeItem !== null;
}

function deriveAnchoredItemSwitchContentItem<TItem>(
  activeItem: TItem | null,
  lingerActiveItem: TItem | null,
): TItem | null {
  return activeItem ?? lingerActiveItem;
}

export type TooltipSwitchSlotKey = {
  registrationId: string;
  itemId: string;
};

export function tooltipSwitchSlotKey(
  registrationId: string,
  itemId: string,
): TooltipSwitchSlotKey {
  return { registrationId, itemId };
}

export function tooltipSwitchSlotsEqual(
  a: TooltipSwitchSlotKey | null,
  b: TooltipSwitchSlotKey | null,
): boolean {
  return (
    a !== null &&
    b !== null &&
    a.registrationId === b.registrationId &&
    a.itemId === b.itemId
  );
}

export function deriveTooltipSwitchAnchorSlot(
  activeSlot: TooltipSwitchSlotKey | null,
  lingerAnchorSlot: TooltipSwitchSlotKey | null,
): TooltipSwitchSlotKey | null {
  return activeSlot ?? lingerAnchorSlot;
}

/** Pure cross-registration state transitions for tests and the global switch hook. */
export class GlobalTooltipSwitchStateModel {
  activeSlot: TooltipSwitchSlotKey | null = null;
  activeItem: unknown | null = null;
  pointerSlot: TooltipSwitchSlotKey | null = null;
  lingerAnchorSlot: TooltipSwitchSlotKey | null = null;
  lingerActiveItem: unknown | null = null;

  get open(): boolean {
    return deriveAnchoredItemSwitchOpen(this.activeItem);
  }

  get anchorSlot(): TooltipSwitchSlotKey | null {
    return deriveTooltipSwitchAnchorSlot(this.activeSlot, this.lingerAnchorSlot);
  }

  get contentActiveItem(): unknown | null {
    return deriveAnchoredItemSwitchContentItem(this.activeItem, this.lingerActiveItem);
  }

  clearPointerHighlight(): void {
    this.pointerSlot = null;
  }

  onTriggerEnter(
    registrationId: string,
    itemId: string,
    item: unknown,
  ): "instant-switch" | "schedule-open" {
    this.lingerAnchorSlot = null;
    this.lingerActiveItem = null;
    this.pointerSlot = tooltipSwitchSlotKey(registrationId, itemId);

    if (this.activeItem !== null) {
      this.activeSlot = tooltipSwitchSlotKey(registrationId, itemId);
      this.activeItem = item;
      return "instant-switch";
    }

    return "schedule-open";
  }

  openScheduledItem(
    registrationId: string,
    itemId: string,
    item: unknown,
    pointerSlot: TooltipSwitchSlotKey | null,
  ): boolean {
    const slot = tooltipSwitchSlotKey(registrationId, itemId);
    if (!pointerSlot || !tooltipSwitchSlotsEqual(pointerSlot, slot)) {
      return false;
    }
    this.activeSlot = slot;
    this.activeItem = item;
    return true;
  }

  beginClose(): TooltipSwitchSlotKey | null {
    if (!this.activeSlot) {
      this.clearPointerHighlight();
      return null;
    }
    const closingSlot = this.activeSlot;
    this.clearPointerHighlight();
    this.lingerAnchorSlot = closingSlot;
    this.lingerActiveItem = this.activeItem;
    this.activeSlot = null;
    this.activeItem = null;
    return closingSlot;
  }

  clearLingerAnchor(): void {
    this.lingerAnchorSlot = null;
  }

  clearLingerContent(): void {
    this.lingerActiveItem = null;
  }
}

export function isWithinGlobalTooltipRelatedTarget(
  target: EventTarget | null,
  refs: {
    triggerZones: Iterable<HTMLDivElement | null>;
    triggerElements: Iterable<HTMLElement | null>;
    content: HTMLDivElement | null;
  },
): boolean {
  if (isEventTargetWithinTooltipCompanionOverlays(target)) {
    return true;
  }
  if (target !== null && typeof target === "object" && "nodeType" in target) {
    const node = target as Node;
    for (const element of refs.triggerElements) {
      if (element?.contains(node)) {
        return true;
      }
    }
  }
  for (const zone of refs.triggerZones) {
    if (isWithinAnchoredItemSwitchRelatedTarget(target, { triggerZone: zone, content: null })) {
      return true;
    }
  }
  return isWithinAnchoredItemSwitchRelatedTarget(target, {
    triggerZone: null,
    content: refs.content,
  });
}

const TOOLTIP_COMPANION_OVERLAY_SELECTORS = [
  '[data-slot="tooltip-content"]',
  '[data-slot="select-content"]',
] as const;

/** Detail tooltip / nested Select portals sit outside DropdownMenuContent but belong to the picker. */
export function isEventTargetWithinTooltipCompanionOverlays(
  target: EventTarget | null,
): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return TOOLTIP_COMPANION_OVERLAY_SELECTORS.some(
    (selector) => target.closest(selector) !== null,
  );
}

export function isPointerOverTooltipCompanionOverlays(
  clientX: number,
  clientY: number,
): boolean {
  const nodes =
    typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(clientX, clientY)
      : [document.elementFromPoint(clientX, clientY)].filter(
          (node): node is Element => node instanceof Element,
        );
  for (const node of nodes) {
    if (isEventTargetWithinTooltipCompanionOverlays(node)) {
      return true;
    }
  }
  return false;
}

export function isActiveTooltipAnchorSlot(
  anchorSlot: TooltipSwitchSlotKey | null,
  registrationId: string,
  itemId: string,
): boolean {
  return (
    anchorSlot !== null &&
    anchorSlot.registrationId === registrationId &&
    anchorSlot.itemId === itemId
  );
}
