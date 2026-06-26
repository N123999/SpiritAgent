import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import {
  COMPOSER_INLINE_CHIP_CLASS,
  COMPOSER_INLINE_CHIP_ICON_CLASS,
} from "@/lib/composer-inline-chip-styles";

/** 输入框 chip、消息气泡共用 */
export const BROWSER_ELEMENT_CHIP_CLASS = COMPOSER_INLINE_CHIP_CLASS;

export const BROWSER_ELEMENT_CHIP_ICON_CLASS = COMPOSER_INLINE_CHIP_ICON_CLASS;

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
  icon.setAttribute("class", BROWSER_ELEMENT_CHIP_ICON_CLASS);
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<path d="M13 6 6.126 7.375a1 1 0 0 0-.776.746L2.028 20.765a1 1 0 0 0 1.207 1.207l12.644-3.322a1 1 0 0 0 .746-.776L18 11"/><path d="m2.3 21.7 7.286-7.286"/><path d="M21.293 8.293a1 1 0 0 1 0 1.414l-1.586 1.586a1 1 0 0 1-1.414 0l-5.586-5.586a1 1 0 0 1 0-1.414l1.586-1.586a1 1 0 0 1 1.414 0z"/><circle cx="11" cy="13" r="2"/>';
  span.appendChild(icon);
  span.appendChild(doc.createTextNode(`<${a.tagName}>`));
  return span;
}
