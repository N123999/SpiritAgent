import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterNewGitHubAutomationEvents,
  matchesGitHubAutomationEvent,
  shouldFetchNextIssuePage,
} from './automation-events.js';

const prItem = {
  number: 10,
  htmlUrl: 'https://github.com/o/r/pull/10',
  isPullRequest: true,
  createdAt: '2026-06-01T00:00:00Z',
};

const issueItem = {
  number: 11,
  htmlUrl: 'https://github.com/o/r/issues/11',
  isPullRequest: false,
  createdAt: '2026-06-01T01:00:00Z',
};

test('matchesGitHubAutomationEvent distinguishes PR and issue', () => {
  assert.equal(matchesGitHubAutomationEvent(prItem, 'pull_request_created'), true);
  assert.equal(matchesGitHubAutomationEvent(prItem, 'issue_created'), false);
  assert.equal(matchesGitHubAutomationEvent(issueItem, 'issue_created'), true);
  assert.equal(matchesGitHubAutomationEvent(issueItem, 'pull_request_created'), false);
});

test('filterNewGitHubAutomationEvents returns ascending items above watermark', () => {
  const items = [
    issueItem,
    prItem,
    { ...prItem, number: 12, htmlUrl: 'https://github.com/o/r/pull/12' },
  ];
  const prEvents = filterNewGitHubAutomationEvents(items, 'pull_request_created', 9);
  assert.deepEqual(prEvents.map((item) => item.number), [10, 12]);

  const issueEvents = filterNewGitHubAutomationEvents(items, 'issue_created', 10);
  assert.deepEqual(issueEvents.map((item) => item.number), [11]);
});

test('filterNewGitHubAutomationEvents ignores numbers at or below watermark', () => {
  const events = filterNewGitHubAutomationEvents([prItem, issueItem], 'pull_request_created', 10);
  assert.equal(events.length, 0);
});

test('shouldFetchNextIssuePage stops when watermark is covered or page is short', () => {
  const fullPage = Array.from({ length: 100 }, (_, index) => ({
    ...issueItem,
    number: 200 - index,
  }));
  assert.equal(shouldFetchNextIssuePage(fullPage, 100, 100), true);
  assert.equal(shouldFetchNextIssuePage(fullPage, 150, 100), false);
  assert.equal(shouldFetchNextIssuePage([fullPage[0]!], 100, 100), false);
});
