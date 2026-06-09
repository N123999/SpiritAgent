export const DEBUG_CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-purple-200/90 bg-purple-50 px-1.5 py-0.5 text-xs font-medium leading-none text-purple-900 select-none align-middle mx-0.5 dark:border-purple-700/60 dark:bg-purple-950 dark:text-purple-300";

export const DEBUG_CHIP_ICON_CLASS = "text-purple-600 dark:text-purple-400";

export function makeDebugChipNode(doc: Document, label = "Debug"): HTMLElement {
  const span = doc.createElement("span");
  span.contentEditable = "false";
  span.setAttribute("data-debug-chip", "true");
  span.dataset.debugChip = "true";
  span.className = DEBUG_CHIP_CLASS;
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
  icon.setAttribute("class", DEBUG_CHIP_ICON_CLASS);
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<path d="M12 12h.01"/><path d="M8 21V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v16"/><path d="M3 7h18"/><path d="M3 11h18"/><path d="M3 15h18"/>';

  span.appendChild(icon);
  span.appendChild(doc.createTextNode(label));
  return span;
}
