const OUTER_HTML_MAX_BYTES = 4096;

export interface BrowserElementAttachment {
  id: string;
  tagName: string;
  outerHtml: string;
  screenshotDataUrl: string;
  pageUrl: string;
}

export function truncateOuterHtml(html: string): string {
  if (html.length <= OUTER_HTML_MAX_BYTES) return html;
  return html.slice(0, OUTER_HTML_MAX_BYTES) + '…';
}

export { browserElementContextText } from "./composer-segment-model";
