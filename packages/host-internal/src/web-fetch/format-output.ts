import type { ExtractedWebContent } from './extract-markdown.js';
import { WEB_FETCH_MAX_CHARS, WEB_FETCH_MAX_LINKS, WEB_FETCH_USER_AGENT } from './constants.js';

export interface WebFetchOutputMeta {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title?: string;
  siteName?: string;
  excerpt?: string;
  extraction: ExtractedWebContent['extraction'];
  jsonKeys?: string;
  truncated: boolean;
  linksTruncated: boolean;
  contentChars: number;
}

export interface TruncateMarkdownResult {
  text: string;
  truncated: boolean;
}

export function sanitizeWebFetchMetaValue(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function formatMetaLine(key: string, value: string): string {
  return `${key}: ${sanitizeWebFetchMetaValue(value)}`;
}

export function escapeMarkdownLinkLabel(text: string): string {
  return text.replace(/\\/gu, '\\\\').replace(/\[/gu, '\\[').replace(/\]/gu, '\\]');
}

export function truncateMarkdownAtHeadingBoundary(
  markdown: string,
  maxChars: number,
): TruncateMarkdownResult {
  const chars = [...markdown];
  if (chars.length <= maxChars) {
    return { text: markdown, truncated: false };
  }

  const slice = chars.slice(0, maxChars).join('');
  const headingPattern = /\n#{1,6} /gu;
  let lastHeadingIndex = -1;
  for (const match of slice.matchAll(headingPattern)) {
    const index = match.index;
    if (index !== undefined && index > 0) {
      lastHeadingIndex = index;
    }
  }

  if (lastHeadingIndex > 0) {
    return {
      text: slice.slice(0, lastHeadingIndex).trimEnd(),
      truncated: true,
    };
  }

  const paragraphBreak = slice.lastIndexOf('\n\n');
  if (paragraphBreak > maxChars * 0.5) {
    return {
      text: slice.slice(0, paragraphBreak).trimEnd(),
      truncated: true,
    };
  }

  return {
    text: slice.trimEnd(),
    truncated: true,
  };
}

function formatLinksSection(
  links: ReadonlyArray<{ text: string; url: string }>,
): { section: string; truncated: boolean } {
  if (links.length === 0) {
    return { section: '', truncated: false };
  }

  const limited = links.slice(0, WEB_FETCH_MAX_LINKS);
  const lines = limited.map((link) => `- [${escapeMarkdownLinkLabel(link.text)}](${link.url})`);
  const truncated = links.length > WEB_FETCH_MAX_LINKS;
  if (truncated) {
    lines.push(`- … (${links.length - WEB_FETCH_MAX_LINKS} more links omitted)`);
  }
  return {
    section: `## links\n${lines.join('\n')}`,
    truncated,
  };
}

export function formatWebFetchToolOutput(input: {
  meta: WebFetchOutputMeta;
  contentMarkdown: string;
  links: ReadonlyArray<{ text: string; url: string }>;
}): string {
  const { meta, contentMarkdown, links } = input;
  const { section: linksSection, truncated: linksTruncated } = formatLinksSection(links);

  const headerLines = [
    '[web]',
    `url: ${meta.url}`,
    `final_url: ${meta.finalUrl}`,
    `status: ${meta.status}`,
    `content_type: ${meta.contentType}`,
    `user_agent: ${WEB_FETCH_USER_AGENT}`,
    `extraction: ${meta.extraction}`,
    ...(meta.title ? [formatMetaLine('title', meta.title)] : []),
    ...(meta.siteName ? [formatMetaLine('site_name', meta.siteName)] : []),
    ...(meta.excerpt ? [formatMetaLine('excerpt', meta.excerpt)] : []),
    ...(meta.jsonKeys ? [formatMetaLine('json_keys', meta.jsonKeys)] : []),
    `content_chars: ${meta.contentChars}`,
    `truncated: ${meta.truncated}`,
    ...(linksSection.length > 0 ? [`links_truncated: ${linksTruncated || meta.linksTruncated}`] : []),
  ];

  const parts = [`${headerLines.join('\n')}\n\n## content\n${contentMarkdown}`];
  if (linksSection.length > 0) {
    parts.push('', linksSection);
  }

  return parts.join('\n');
}

export function buildWebFetchOutput(input: {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  extracted: ExtractedWebContent;
  links: ReadonlyArray<{ text: string; url: string }>;
  maxContentChars?: number;
}): string {
  const maxChars = input.maxContentChars ?? WEB_FETCH_MAX_CHARS;
  const { text: contentMarkdown, truncated } = truncateMarkdownAtHeadingBoundary(
    input.extracted.markdown,
    maxChars,
  );

  const meta: WebFetchOutputMeta = {
    url: input.url,
    finalUrl: input.finalUrl,
    status: input.status,
    contentType: input.contentType,
    extraction: input.extracted.extraction,
    truncated,
    linksTruncated: input.links.length > WEB_FETCH_MAX_LINKS,
    contentChars: [...contentMarkdown].length,
    ...(input.extracted.title ? { title: input.extracted.title } : {}),
    ...(input.extracted.siteName ? { siteName: input.extracted.siteName } : {}),
    ...(input.extracted.excerpt ? { excerpt: input.extracted.excerpt } : {}),
    ...(input.extracted.jsonKeys ? { jsonKeys: input.extracted.jsonKeys } : {}),
  };

  return formatWebFetchToolOutput({
    meta,
    contentMarkdown,
    links: input.links,
  });
}
