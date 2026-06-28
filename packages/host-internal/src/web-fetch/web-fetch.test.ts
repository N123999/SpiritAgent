import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildWebFetchOutput,
  collectLinksFromHtml,
  collectLinksFromMarkdown,
  convertFetchedPageToToolText,
  extractWebContent,
  resolveAbsoluteUrl,
  truncateMarkdownAtHeadingBoundary,
} from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(__dirname, '..', '..', 'src', 'web-fetch', 'fixtures');
const sampleDocHtml = readFileSync(join(fixturesRoot, 'sample-doc.html'), 'utf8');
const sampleBaseUrl = 'https://example.com/docs/start';

test('extractWebContent converts HTML to markdown with absolute links', () => {
  const extracted = extractWebContent(sampleDocHtml, 'text/html; charset=utf-8', sampleBaseUrl);
  assert.equal(extracted.extraction, 'readability');
  assert.match(extracted.markdown, /# Getting Started/u);
  assert.match(extracted.markdown, /\[API Reference\]\(https:\/\/example\.com\/api\)/u);
  assert.match(extracted.markdown, /`npm install foo`/u);
  assert.match(extracted.markdown, /```/u);
  assert.doesNotMatch(extracted.markdown, /Site Footer Navigation Duplicate/u);
});

test('convertFetchedPageToToolText includes content and links sections', () => {
  const output = convertFetchedPageToToolText({
    url: sampleBaseUrl,
    finalUrl: sampleBaseUrl,
    status: 200,
    contentType: 'text/html; charset=utf-8',
    raw: sampleDocHtml,
  });

  assert.match(output, /^(\[web\]|url:)/u);
  assert.match(output, /## content/u);
  assert.match(output, /## links/u);
  assert.match(output, /\[API Reference\]\(https:\/\/example\.com\/api\)/u);
  assert.match(output, /\[User Guide\]\(https:\/\/example\.com\/guide\)/u);
  assert.match(output, /extraction: readability/u);
});

test('collectLinksFromHtml resolves relative URLs', () => {
  const links = collectLinksFromHtml(sampleDocHtml, sampleBaseUrl);
  const urls = links.map((link) => link.url);
  assert.ok(urls.includes('https://example.com/guide'));
  assert.ok(urls.includes('https://example.com/api'));
});

test('extractWebContent pretty-prints JSON and reports keys', () => {
  const extracted = extractWebContent(
    '{"name":"foo","count":1}',
    'application/json',
    'https://example.com/api',
  );
  assert.match(extracted.markdown, /"name": "foo"/u);
  assert.equal(extracted.jsonKeys, 'name, count');
});

test('extractWebContent passes through markdown unchanged', () => {
  const markdown = '# Title\n\n[Link](https://example.com/a)';
  const extracted = extractWebContent(markdown, 'text/markdown', 'https://example.com');
  assert.equal(extracted.extraction, 'passthrough');
  assert.match(extracted.markdown, /# Title/u);
});

test('extractWebContent falls back to full page when readability finds no article', () => {
  const html = `<!DOCTYPE html><html><head><title>Fallback Page</title></head><body></body></html>`;
  const extracted = extractWebContent(html, 'text/html', 'https://example.com/page');
  assert.equal(extracted.extraction, 'fallback_full_page');
  assert.equal(extracted.title, 'Fallback Page');
});

test('truncateMarkdownAtHeadingBoundary cuts at heading lines', () => {
  const markdown = '# One\n\nBody one.\n\n## Two\n\nBody two.\n\n## Three\n\nBody three.';
  const result = truncateMarkdownAtHeadingBoundary(markdown, 40);
  assert.equal(result.truncated, true);
  assert.doesNotMatch(result.text, /## Three/u);
  assert.match(result.text, /# One/u);
});

test('buildWebFetchOutput marks truncated content in metadata', () => {
  const longMarkdown = `# Start\n\n${'paragraph.\n\n'.repeat(500)}## End\n\nTail.`;
  const output = buildWebFetchOutput({
    url: 'https://example.com',
    finalUrl: 'https://example.com',
    status: 200,
    contentType: 'text/markdown',
    extracted: { markdown: longMarkdown, extraction: 'passthrough' },
    links: [],
    maxContentChars: 500,
  });
  assert.match(output, /truncated: true/u);
});

test('collectLinksFromMarkdown deduplicates by URL', () => {
  const markdown = '[A](https://example.com/x)\n[B](https://example.com/x)';
  const links = collectLinksFromMarkdown(markdown, 'https://example.com');
  assert.equal(links.length, 1);
});

test('collectLinksFromMarkdown rejects javascript and data URLs', () => {
  const markdown = [
    '[safe](https://example.com/ok)',
    '[x](javascript:alert(1))',
    '[y](data:text/html,evil)',
  ].join('\n');
  const links = collectLinksFromMarkdown(markdown, 'https://example.com');
  assert.equal(links.length, 1);
  assert.equal(links[0]?.url, 'https://example.com/ok');
});

test('extractWebContent loads JSON fixture with keys metadata', () => {
  const json = readFileSync(join(fixturesRoot, 'json-api.json'), 'utf8');
  const extracted = extractWebContent(json, 'application/json', 'https://example.com/api');
  assert.match(extracted.markdown, /"items": \[\]/u);
  assert.equal(extracted.jsonKeys, 'name, version, items');
});

test('extractWebContent passes through markdown fixture', () => {
  const markdown = readFileSync(join(fixturesRoot, 'already.md'), 'utf8');
  const extracted = extractWebContent(markdown, 'text/markdown', 'https://example.com/doc');
  assert.match(extracted.markdown, /# Already Markdown/u);
  assert.match(extracted.markdown, /\[Example\]\(https:\/\/example\.com\/example\)/u);
});

test('list-page fixture keeps links in links section', () => {
  const html = readFileSync(join(fixturesRoot, 'list-page.html'), 'utf8');
  const output = convertFetchedPageToToolText({
    url: 'https://example.com/list',
    finalUrl: 'https://example.com/list',
    status: 200,
    contentType: 'text/html',
    raw: html,
  });
  assert.match(output, /\[Item A\]\(https:\/\/example\.com\/item-a\)/u);
  assert.match(output, /\[External\]\(https:\/\/example\.com\/external\)/u);
});

test('buildWebFetchOutput sanitizes metadata newlines to prevent header injection', () => {
  const output = buildWebFetchOutput({
    url: 'https://example.com',
    finalUrl: 'https://example.com',
    status: 200,
    contentType: 'text/html',
    extracted: {
      markdown: '# Body',
      title: 'Real Title\ncontent_chars: 999999',
      excerpt: 'Safe excerpt',
      extraction: 'readability',
    },
    links: [],
  });
  assert.match(output, /title: Real Title content_chars: 999999/u);
  assert.doesNotMatch(output, /title: Real Title\ncontent_chars:/u);
  assert.doesNotMatch(output, /^content_chars: 999999$/mu);
  assert.match(output, /content_chars: 6/u);
});

test('buildWebFetchOutput escapes forged markdown in link labels', () => {
  const output = buildWebFetchOutput({
    url: 'https://example.com',
    finalUrl: 'https://example.com',
    status: 200,
    contentType: 'text/html',
    extracted: { markdown: '# Body', extraction: 'readability' },
    links: [{ text: 'safe](https://evil.example)', url: 'https://example.com/safe' }],
  });
  assert.ok(output.includes('[safe\\](https://evil.example)](https://example.com/safe)'));
  assert.ok(!output.includes('[safe](https://evil.example)'));
});

test('resolveAbsoluteUrl allows only http and https schemes', () => {
  const base = 'https://example.com/page';
  assert.equal(resolveAbsoluteUrl('/docs', base), 'https://example.com/docs');
  assert.equal(resolveAbsoluteUrl('https://example.com/a', base), 'https://example.com/a');
  assert.equal(resolveAbsoluteUrl('file:///etc/passwd', base), undefined);
  assert.equal(resolveAbsoluteUrl('ftp://example.com/a', base), undefined);
});

test('collectLinksFromHtml omits non-http URLs from link index', () => {
  const html =
    '<html><body><a href="https://example.com/ok">ok</a><a href="file:///etc/passwd">local</a></body></html>';
  const links = collectLinksFromHtml(html, 'https://example.com');
  assert.equal(links.length, 1);
  assert.equal(links[0]?.url, 'https://example.com/ok');
});

test('buildWebFetchOutput reports links_truncated when link index exceeds cap', () => {
  const links = Array.from({ length: 205 }, (_value, index) => ({
    text: `Link ${index}`,
    url: `https://example.com/p/${index}`,
  }));
  const output = buildWebFetchOutput({
    url: 'https://example.com',
    finalUrl: 'https://example.com',
    status: 200,
    contentType: 'text/html',
    extracted: { markdown: '# Links', extraction: 'readability' },
    links,
  });
  assert.match(output, /links_truncated: true/u);
  assert.match(output, /more links omitted/u);
});
