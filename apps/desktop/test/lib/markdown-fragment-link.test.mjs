import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeMarkdownFragmentId,
  isMarkdownFragmentHref,
} from '../../src/lib/markdown-fragment-link.ts';
import { slugifyMarkdownHeadingText } from '../../src/lib/markdown-heading-slug.ts';

test('slugifyMarkdownHeadingText matches GitHub-style section anchors', () => {
  assert.equal(slugifyMarkdownHeadingText('Desktop'), 'desktop');
  assert.equal(slugifyMarkdownHeadingText('ACP Server'), 'acp-server');
  assert.equal(slugifyMarkdownHeadingText('Agent Core'), 'agent-core');
});

test('isMarkdownFragmentHref recognizes same-document anchors', () => {
  assert.equal(isMarkdownFragmentHref('#desktop'), true);
  assert.equal(isMarkdownFragmentHref(' #acp-server '), true);
  assert.equal(isMarkdownFragmentHref('https://example.com'), false);
  assert.equal(isMarkdownFragmentHref('#'), false);
  assert.equal(decodeMarkdownFragmentId('#acp-server'), 'acp-server');
});
