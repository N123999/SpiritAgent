import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";

/** 输入框 chip、附件条、消息气泡共用 */
export const BROWSER_ELEMENT_CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-blue-200/90 bg-blue-50 px-1.5 py-0.5 text-xs font-medium leading-none text-blue-800 select-none align-middle mx-0.5 dark:border-blue-700/60 dark:bg-blue-950 dark:text-blue-400";

export const BROWSER_ELEMENT_CARD_SHELL_CLASS =
  "inline-flex min-w-0 max-w-[12rem] items-center gap-1 rounded-md border border-blue-200/90 bg-blue-50 pl-1 pr-1.5 py-0.75 dark:border-blue-700/60 dark:bg-blue-950";

export const BROWSER_ELEMENT_CHIP_ICON_CLASS = "text-blue-600 dark:text-blue-400";

export const BROWSER_ELEMENT_CHIP_REMOVE_CLASS =
  "inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-blue-600 transition-colors hover:bg-blue-100 hover:text-blue-900 dark:text-blue-400 dark:hover:bg-blue-900 dark:hover:text-blue-200";

export function makeChipNode(a: BrowserElementAttachment, doc: Document): HTMLElement {
  const span = doc.createElement("span");
  span.contentEditable = "false";
  span.dataset.elementId = a.id;
  span.dataset.elementTag = a.tagName;
  span.dataset.elementHtml = a.outerHtml;
  span.dataset.elementUrl = a.pageUrl;
  span.setAttribute("data-element-chip", "true");
  span.className = BROWSER_ELEMENT_CHIP_CLASS;
  const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", "10");
  icon.setAttribute("height", "10");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<path d="M13 6 6.126 7.375a1 1 0 0 0-.776.746L2.028 20.765a1 1 0 0 0 1.207 1.207l12.644-3.322a1 1 0 0 0 .746-.776L18 11"/><path d="m2.3 21.7 7.286-7.286"/><path d="M21.293 8.293a1 1 0 0 1 0 1.414l-1.586 1.586a1 1 0 0 1-1.414 0l-5.586-5.586a1 1 0 0 1 0-1.414l1.586-1.586a1 1 0 0 1 1.414 0z"/><circle cx="11" cy="13" r="2"/>';
  span.appendChild(icon);
  span.appendChild(doc.createTextNode(`<${a.tagName}>`));
  return span;
}
