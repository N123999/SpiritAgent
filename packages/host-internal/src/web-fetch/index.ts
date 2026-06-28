import {
  WEB_FETCH_ACCEPT_HEADER,
  WEB_FETCH_MAX_CHARS,
  WEB_FETCH_MAX_LINKS,
  WEB_FETCH_TIMEOUT_MS,
  WEB_FETCH_USER_AGENT,
} from './constants.js';
import {
  collectLinksFromHtml,
  collectLinksFromMarkdown,
  extractWebContent,
  normalizeLineEndings,
  normalizeMarkdownWhitespace,
  type ExtractedWebContent,
  type WebPageExtraction,
} from './extract-markdown.js';
import {
  buildWebFetchOutput,
  formatWebFetchToolOutput,
  truncateMarkdownAtHeadingBoundary,
  type TruncateMarkdownResult,
  type WebFetchOutputMeta,
} from './format-output.js';
import {
  fetchWebPage,
  convertFetchedPageToToolText,
  type FetchedWebPage,
} from './fetch-page.js';
import {
  looksLikeHtml,
  normalizeMimeType,
  resolveAbsoluteUrl,
} from './resolve-url.js';

export {
  WEB_FETCH_ACCEPT_HEADER,
  WEB_FETCH_MAX_CHARS,
  WEB_FETCH_MAX_LINKS,
  WEB_FETCH_TIMEOUT_MS,
  WEB_FETCH_USER_AGENT,
  buildWebFetchOutput,
  collectLinksFromHtml,
  collectLinksFromMarkdown,
  convertFetchedPageToToolText,
  extractWebContent,
  fetchWebPage,
  formatWebFetchToolOutput,
  looksLikeHtml,
  normalizeLineEndings,
  normalizeMarkdownWhitespace,
  normalizeMimeType,
  resolveAbsoluteUrl,
  truncateMarkdownAtHeadingBoundary,
  type ExtractedWebContent,
  type FetchedWebPage,
  type TruncateMarkdownResult,
  type WebFetchOutputMeta,
  type WebPageExtraction,
};
