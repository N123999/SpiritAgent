import type { TooltipSwitchSlotKey } from "@/hooks/tooltip-switch-registry";

function slotsEqual(a: TooltipSwitchSlotKey | null, b: TooltipSwitchSlotKey | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.registrationId === b.registrationId && a.itemId === b.itemId;
}

let anchorSlot: TooltipSwitchSlotKey | null = null;
let pointerHighlightSlot: TooltipSwitchSlotKey | null = null;
let activeHighlightSlot: TooltipSwitchSlotKey | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeTooltipItemInteraction(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setTooltipAnchorSlot(slot: TooltipSwitchSlotKey | null): void {
  if (slotsEqual(anchorSlot, slot)) {
    return;
  }
  anchorSlot = slot;
  notify();
}

export function setTooltipPointerHighlightSlot(slot: TooltipSwitchSlotKey | null): void {
  if (slotsEqual(pointerHighlightSlot, slot)) {
    return;
  }
  pointerHighlightSlot = slot;
  notify();
}

export function setTooltipActiveHighlightSlot(slot: TooltipSwitchSlotKey | null): void {
  if (slotsEqual(activeHighlightSlot, slot)) {
    return;
  }
  activeHighlightSlot = slot;
  notify();
}

export function clearTooltipItemInteractionSlots(): void {
  let changed = false;
  if (anchorSlot !== null) {
    anchorSlot = null;
    changed = true;
  }
  if (pointerHighlightSlot !== null) {
    pointerHighlightSlot = null;
    changed = true;
  }
  if (activeHighlightSlot !== null) {
    activeHighlightSlot = null;
    changed = true;
  }
  if (changed) {
    notify();
  }
}

export function isTooltipAnchorSlot(registrationId: string, itemId: string): boolean {
  return anchorSlot?.registrationId === registrationId && anchorSlot?.itemId === itemId;
}

export function isTooltipItemHighlighted(registrationId: string, itemId: string): boolean {
  return (
    (pointerHighlightSlot?.registrationId === registrationId
      && pointerHighlightSlot.itemId === itemId)
    || (activeHighlightSlot?.registrationId === registrationId
      && activeHighlightSlot.itemId === itemId)
  );
}

export function getTooltipAnchorSlot(): TooltipSwitchSlotKey | null {
  return anchorSlot;
}
