import test from 'node:test';
import assert from 'node:assert/strict';

import { tryHandleDesktopWorkspaceLink } from '../../src/lib/workspace-navigation-link.ts';

test('tryHandleDesktopWorkspaceLink opens GitHub PR URLs in the PR tab', () => {
  const openedPr = [];
  const openedBrowser = [];
  const handled = tryHandleDesktopWorkspaceLink(
    'https://github.com/octocat/Hello-World/pull/42',
    {
      openPullRequestInPrTab: (request) => openedPr.push(request),
      openBrowserUrlInNewTab: (url) => openedBrowser.push(url),
    },
    { hostKind: 'electron', interceptPrInApp: true },
  );

  assert.equal(handled, true);
  assert.deepEqual(openedPr, [{ owner: 'octocat', repo: 'Hello-World', number: 42 }]);
  assert.deepEqual(openedBrowser, []);
});

test('tryHandleDesktopWorkspaceLink opens non-PR http(s) URLs in the browser tab on electron', () => {
  const openedPr = [];
  const openedBrowser = [];
  const handled = tryHandleDesktopWorkspaceLink(
    'https://example.com/docs',
    {
      openPullRequestInPrTab: (request) => openedPr.push(request),
      openBrowserUrlInNewTab: (url) => openedBrowser.push(url),
    },
    { hostKind: 'electron', interceptPrInApp: true },
  );

  assert.equal(handled, true);
  assert.deepEqual(openedPr, []);
  assert.deepEqual(openedBrowser, ['https://example.com/docs']);
});

test('tryHandleDesktopWorkspaceLink falls through PR URLs to browser when interceptInApp is false', () => {
  const openedPr = [];
  const openedBrowser = [];
  const handled = tryHandleDesktopWorkspaceLink(
    'https://github.com/octocat/Hello-World/pull/42',
    {
      openPullRequestInPrTab: (request) => openedPr.push(request),
      openBrowserUrlInNewTab: (url) => openedBrowser.push(url),
    },
    { hostKind: 'electron', interceptPrInApp: false },
  );

  assert.equal(handled, true);
  assert.deepEqual(openedPr, []);
  assert.deepEqual(openedBrowser, ['https://github.com/octocat/Hello-World/pull/42']);
});

test('tryHandleDesktopWorkspaceLink ignores http(s) URLs on web host', () => {
  const openedBrowser = [];
  const handled = tryHandleDesktopWorkspaceLink(
    'https://example.com/docs',
    {
      openPullRequestInPrTab: () => {},
      openBrowserUrlInNewTab: (url) => openedBrowser.push(url),
    },
    { hostKind: 'web', interceptPrInApp: true },
  );

  assert.equal(handled, false);
  assert.deepEqual(openedBrowser, []);
});

test('tryHandleDesktopWorkspaceLink ignores fragment-only hrefs', () => {
  const openedBrowser = [];
  const handled = tryHandleDesktopWorkspaceLink(
    '#desktop',
    {
      openPullRequestInPrTab: () => {},
      openBrowserUrlInNewTab: (url) => openedBrowser.push(url),
    },
    { hostKind: 'electron', interceptPrInApp: true },
  );

  assert.equal(handled, false);
  assert.deepEqual(openedBrowser, []);
});
