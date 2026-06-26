export const ASK_CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-emerald-200/90 bg-emerald-50 px-1.5 py-0.5 text-xs font-medium leading-none text-emerald-900 select-none align-middle mx-0.5 dark:border-emerald-700/60 dark:bg-emerald-950 dark:text-emerald-300";

export const ASK_CHIP_ICON_CLASS = "text-emerald-600 dark:text-emerald-400";

export function makeAskChipNode(doc: Document, label = "Ask"): HTMLElement {
  const span = doc.createElement("span");
  span.contentEditable = "false";
  span.setAttribute("data-ask-chip", "true");
  span.dataset.askChip = "true";
  span.className = ASK_CHIP_CLASS;
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
  icon.setAttribute("class", ASK_CHIP_ICON_CLASS);
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>';

  span.appendChild(icon);
  span.appendChild(doc.createTextNode(label));
  return span;
}
