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
  const links = collectLinksFromMarkdown(markdown);
  assert.equal(links.length, 1);
});
