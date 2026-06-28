import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { looksLikeHtml, normalizeMimeType, resolveAbsoluteUrl } from './resolve-url.js';

export type WebPageExtraction = 'readability' | 'fallback_full_page' | 'passthrough';

export interface ExtractedWebContent {
  markdown: string;
  title?: string;
  siteName?: string;
  excerpt?: string;
  jsonKeys?: string;
  extraction: WebPageExtraction;
}

function createTurndownService(baseUrl: string): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    bulletListMarker: '-',
  });
  turndown.use(gfm);

  turndown.addRule('absoluteLinks', {
    filter(node) {
      return node.nodeName === 'A';
    },
    replacement(content, node) {
      const element = node as HTMLAnchorElement;
      const href = element.getAttribute('href') ?? '';
      const absolute = resolveAbsoluteUrl(href, baseUrl);
      const label = content.trim() || href.trim();
      if (!absolute) {
        return label;
      }
      return `[${label}](${absolute})`;
    },
  });

  turndown.addRule('absoluteImages', {
    filter(node) {
      if (node.nodeName !== 'IMG') {
        return false;
      }
      const element = node as HTMLImageElement;
      const width = element.getAttribute('width');
      const height = element.getAttribute('height');
      if (width === '1' && height === '1') {
        return false;
      }
      return true;
    },
    replacement(_content, node) {
      const element = node as HTMLImageElement;
      const src = element.getAttribute('src') ?? '';
      const absolute = resolveAbsoluteUrl(src, baseUrl);
      if (!absolute) {
        return '';
      }
      const alt = element.getAttribute('alt')?.trim() ?? '';
      return `![${alt}](${absolute})`;
    },
  });

  return turndown;
}

function htmlToMarkdown(html: string, baseUrl: string): string {
  const turndown = createTurndownService(baseUrl);
  return turndown.turndown(html).trim();
}

function extractFromHtmlDocument(document: Document, baseUrl: string): ExtractedWebContent {
  const reader = new Readability(document);
  const article = reader.parse();

  if (article?.content && article.content.trim().length > 0) {
    return {
      markdown: htmlToMarkdown(article.content, baseUrl),
      ...(article.title ? { title: article.title } : {}),
      ...(article.siteName ? { siteName: article.siteName } : {}),
      ...(article.excerpt ? { excerpt: article.excerpt } : {}),
      extraction: 'readability',
    };
  }

  const bodyHtml = document.body?.innerHTML ?? document.documentElement.innerHTML;
  const docTitle = document.title.trim();
  return {
    markdown: htmlToMarkdown(bodyHtml, baseUrl),
    ...(docTitle.length > 0 ? { title: docTitle } : {}),
    extraction: 'fallback_full_page',
  };
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function normalizeMarkdownWhitespace(text: string): string {
  const normalized = normalizeLineEndings(text);
  const out: string[] = [];
  let blankRun = 0;
  for (const line of normalized.split('\n')) {
    const trimmed = line.replace(/\s+$/u, '');
    if (trimmed.trim().length === 0) {
      blankRun += 1;
      if (blankRun <= 1) {
        out.push('');
      }
      continue;
    }
    blankRun = 0;
    out.push(trimmed.replace(/^\uFEFF/u, ''));
  }
  const result = out.join('\n').trim();
  return result.length === 0 ? '（网页内容为空）' : result;
}

export function extractWebContent(
  raw: string,
  contentType: string,
  finalUrl: string,
): ExtractedWebContent {
  const mime = normalizeMimeType(contentType);

  if (mime.includes('json')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const markdown = JSON.stringify(parsed, null, 2);
      const keys =
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? Object.keys(parsed).join(', ')
          : undefined;
      return {
        markdown: normalizeMarkdownWhitespace(markdown),
        ...(keys ? { jsonKeys: keys } : {}),
        extraction: 'passthrough',
      };
    } catch {
      return {
        markdown: normalizeMarkdownWhitespace(raw),
        extraction: 'passthrough',
      };
    }
  }

  if (mime.includes('markdown') || mime.endsWith('.md')) {
    return {
      markdown: normalizeMarkdownWhitespace(raw),
      extraction: 'passthrough',
    };
  }

  if (mime.startsWith('text/plain') && !looksLikeHtml(raw)) {
    return {
      markdown: normalizeMarkdownWhitespace(raw),
      extraction: 'passthrough',
    };
  }

  if (mime.includes('html') || looksLikeHtml(raw)) {
    const dom = new JSDOM(raw, { url: finalUrl });
    return extractFromHtmlDocument(dom.window.document, finalUrl);
  }

  return {
    markdown: normalizeMarkdownWhitespace(raw),
    extraction: 'passthrough',
  };
}

export function collectLinksFromHtml(html: string, baseUrl: string): Array<{ text: string; url: string }> {
  const dom = new JSDOM(html, { url: baseUrl });
  const links: Array<{ text: string; url: string }> = [];
  const seen = new Set<string>();

  for (const anchor of dom.window.document.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') ?? '';
    const absolute = resolveAbsoluteUrl(href, baseUrl);
    if (!absolute || seen.has(absolute)) {
      continue;
    }
    seen.add(absolute);
    const text = anchor.textContent?.replace(/\s+/gu, ' ').trim() || absolute;
    links.push({ text, url: absolute });
  }

  return links;
}

export function collectLinksFromMarkdown(markdown: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  const seen = new Set<string>();
  const pattern = /\[([^\]]*)\]\(([^)]+)\)/gu;

  for (const match of markdown.matchAll(pattern)) {
    const text = match[1]?.trim() || match[2]?.trim() || '';
    const url = match[2]?.trim() ?? '';
    if (url.length === 0 || seen.has(url)) {
      continue;
    }
    seen.add(url);
    links.push({ text: text || url, url });
  }

  return links;
}
