export const PLAN_CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-orange-200/90 bg-orange-50 px-1.5 py-0.5 text-xs font-medium leading-none text-orange-900 select-none align-middle mx-0.5 dark:border-orange-700/60 dark:bg-orange-950 dark:text-orange-300";

export const PLAN_CHIP_ICON_CLASS = "text-orange-600 dark:text-orange-400";

export function makePlanChipNode(doc: Document, label = "Plan"): HTMLElement {
  const span = doc.createElement("span");
  span.contentEditable = "false";
  span.setAttribute("data-plan-chip", "true");
  span.dataset.planChip = "true";
  span.className = PLAN_CHIP_CLASS;
  span.setAttribute("aria-label", label);

  const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", "10");
  icon.setAttribute("height", "10");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("class", PLAN_CHIP_ICON_CLASS);
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z"/><path d="M8 12h8"/><path d="M8 16h8"/><path d="M8 8h8"/>';

  span.appendChild(icon);
  span.appendChild(doc.createTextNode(label));
  return span;
}
