import test from 'node:test';
import assert from 'node:assert/strict';

import {
  groupReviewCommentsIntoThreads,
  mapTimelineEventToConversationItem,
  mergePullRequestConversationItems,
  nestReviewThreadsUnderReviews,
} from './conversation.js';
import type {
  GitHubPullRequestConversationReview,
  GitHubPullRequestConversationReviewThread,
} from './types.js';

test('mapTimelineEventToConversationItem maps committed event', () => {
  const item = mapTimelineEventToConversationItem({
    id: 1,
    event: 'committed',
    created_at: '2024-01-02T10:00:00Z',
    actor: { login: 'octocat', avatar_url: 'https://github.com/octocat.png' },
    commit: {
      sha: 'abc123',
      html_url: 'https://github.com/octocat/Hello-World/commit/abc123',
      message: 'Fix login bug\n\nDetails here',
      author: { name: 'Octocat' },
    },
  });

  assert.equal(item?.kind, 'commit');
  if (item?.kind !== 'commit') {
    return;
  }
  assert.equal(item.subject, 'Fix login bug');
  assert.equal(item.sha, 'abc123');
  assert.equal(item.authorLogin, 'Octocat');
});

test('mapTimelineEventToConversationItem maps issue comment', () => {
  const item = mapTimelineEventToConversationItem({
    id: 42,
    event: 'commented',
    created_at: '2024-01-03T10:00:00Z',
    user: { login: 'octocat', avatar_url: 'https://github.com/octocat.png' },
    body: 'Looks good to me.',
    html_url: 'https://github.com/octocat/Hello-World/issues/1#issuecomment-42',
  });

  assert.equal(item?.kind, 'issueComment');
  if (item?.kind !== 'issueComment') {
    return;
  }
  assert.equal(item.body, 'Looks good to me.');
  assert.equal(item.authorLogin, 'octocat');
});

test('mapTimelineEventToConversationItem maps review event', () => {
  const item = mapTimelineEventToConversationItem({
    id: 7,
    event: 'reviewed',
    state: 'approved',
    created_at: '2024-01-04T10:00:00Z',
    user: { login: 'octocat', avatar_url: 'https://github.com/octocat.png' },
    body: 'Ship it.',
  });

  assert.equal(item?.kind, 'review');
  if (item?.kind !== 'review') {
    return;
  }
  assert.equal(item.state, 'APPROVED');
  assert.equal(item.body, 'Ship it.');
  assert.deepEqual(item.threads, []);
});

test('groupReviewCommentsIntoThreads groups replies under root comment', () => {
  const threads = groupReviewCommentsIntoThreads([
    {
      id: 100,
      body: 'Why this change?',
      path: 'src/app.ts',
      diff_hunk: '@@ -1 +1 @@',
      line: 12,
      created_at: '2024-01-05T10:00:00Z',
      html_url: 'https://github.com/octocat/Hello-World/pull/1#discussion_r100',
      user: { login: 'octocat', avatar_url: 'https://github.com/octocat.png' },
    },
    {
      id: 101,
      in_reply_to_id: 100,
      body: 'Because auth broke.',
      path: 'src/app.ts',
      diff_hunk: '@@ -1 +1 @@',
      line: 12,
      created_at: '2024-01-05T11:00:00Z',
      html_url: 'https://github.com/octocat/Hello-World/pull/1#discussion_r101',
      user: { login: 'octocat', avatar_url: 'https://github.com/octocat.png' },
    },
  ]);

  assert.equal(threads.length, 1);
  assert.equal(threads[0]?.kind, 'reviewThread');
  assert.equal(threads[0]?.comments.length, 2);
  assert.equal(threads[0]?.comments[0]?.body, 'Why this change?');
  assert.equal(threads[0]?.comments[1]?.body, 'Because auth broke.');
});

test('mergePullRequestConversationItems sorts ascending and dedupes', () => {
  const items = mergePullRequestConversationItems(
    [
      {
        id: 2,
        event: 'commented',
        created_at: '2024-01-03T10:00:00Z',
        user: { login: 'octocat' },
        body: 'Comment',
      },
      {
        id: 1,
        event: 'committed',
        created_at: '2024-01-02T10:00:00Z',
        actor: { login: 'octocat' },
        commit: { sha: 'abc', message: 'Initial fix' },
      },
    ],
    [],
  );

  assert.equal(items.length, 2);
  assert.equal(items[0]?.kind, 'commit');
  assert.equal(items[1]?.kind, 'issueComment');
});

test('nestReviewThreadsUnderReviews nests file threads under matching review', () => {
  const thread: GitHubPullRequestConversationReviewThread = {
    kind: 'reviewThread',
    id: 'review-thread-100',
    reviewId: 'review-7',
    createdAt: '2024-01-05T10:00:00Z',
    authorLogin: 'octocat',
    avatarUrl: 'https://github.com/octocat.png',
    path: 'src/app.ts',
    diffHunk: '@@ -1 +1 @@',
    line: 12,
    url: 'https://example.com/#discussion_r100',
    comments: [],
  };
  const review: GitHubPullRequestConversationReview = {
    kind: 'review',
    id: 'review-7',
    createdAt: '2024-01-05T09:00:00Z',
    authorLogin: 'octocat',
    avatarUrl: 'https://github.com/octocat.png',
    state: 'COMMENTED',
    body: 'Summary note.',
    url: 'https://example.com/#pullrequestreview-7',
    threads: [],
  };

  const nested = nestReviewThreadsUnderReviews([review, thread]);

  assert.equal(nested.length, 1);
  assert.equal(nested[0]?.kind, 'review');
  if (nested[0]?.kind !== 'review') {
    return;
  }
  assert.equal(nested[0].threads.length, 1);
  assert.equal(nested[0].threads[0]?.id, 'review-thread-100');
});

test('mergePullRequestConversationItems attaches review threads to review event', () => {
  const items = mergePullRequestConversationItems(
    [
      {
        id: 7,
        event: 'reviewed',
        state: 'commented',
        created_at: '2024-01-05T09:00:00Z',
        user: { login: 'octocat', avatar_url: 'https://github.com/octocat.png' },
        body: 'Summary note.',
      },
    ],
    [
      {
        id: 100,
        pull_request_review_id: 7,
        body: 'Why this change?',
        path: 'src/app.ts',
        diff_hunk: '@@ -1 +1 @@',
        line: 12,
        created_at: '2024-01-05T10:00:00Z',
        html_url: 'https://example.com/#discussion_r100',
        user: { login: 'octocat', avatar_url: 'https://github.com/octocat.png' },
      },
    ],
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.kind, 'review');
  if (items[0]?.kind !== 'review') {
    return;
  }
  assert.equal(items[0].body, 'Summary note.');
  assert.equal(items[0].threads.length, 1);
  assert.equal(items[0].threads[0]?.comments[0]?.body, 'Why this change?');
});
