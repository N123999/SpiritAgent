import {
  WEB_FETCH_ACCEPT_HEADER,
  WEB_FETCH_TIMEOUT_MS,
  WEB_FETCH_USER_AGENT,
} from './constants.js';
import {
  collectLinksFromHtml,
  collectLinksFromMarkdown,
  extractWebContent,
} from './extract-markdown.js';
import { buildWebFetchOutput } from './format-output.js';
import { looksLikeHtml, normalizeMimeType } from './resolve-url.js';

export interface FetchedWebPage {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  raw: string;
}

export async function fetchWebPage(url: string, fetchImpl: typeof fetch = fetch): Promise<FetchedWebPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': WEB_FETCH_USER_AGENT,
        Accept: WEB_FETCH_ACCEPT_HEADER,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });

    const raw = await response.text();
    return {
      url,
      finalUrl: response.url || url,
      status: response.status,
      contentType: response.headers.get('content-type') ?? 'unknown',
      raw,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function mergeLinks(
  primary: ReadonlyArray<{ text: string; url: string }>,
  secondary: ReadonlyArray<{ text: string; url: string }>,
): Array<{ text: string; url: string }> {
  const merged: Array<{ text: string; url: string }> = [];
  const seen = new Set<string>();
  for (const link of [...primary, ...secondary]) {
    if (seen.has(link.url)) {
      continue;
    }
    seen.add(link.url);
    merged.push(link);
  }
  return merged;
}

export function convertFetchedPageToToolText(page: FetchedWebPage): string {
  const extracted = extractWebContent(page.raw, page.contentType, page.finalUrl);
  const mime = normalizeMimeType(page.contentType);

  let links = collectLinksFromMarkdown(extracted.markdown);
  if (mime.includes('html') || looksLikeHtml(page.raw)) {
    links = mergeLinks(collectLinksFromHtml(page.raw, page.finalUrl), links);
  }

  return buildWebFetchOutput({
    url: page.url,
    finalUrl: page.finalUrl,
    status: page.status,
    contentType: page.contentType,
    extracted,
    links,
  });
}
