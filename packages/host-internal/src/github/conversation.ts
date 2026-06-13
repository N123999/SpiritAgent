import { commitSubject } from './commit-subject.js';
import { resolveGitCommitAuthorIdentity } from './git-author-github.js';
import { GITHUB_API_BASE_URL } from './oauth-config.js';
import {
  githubApiHeaders,
  githubHasNextPage,
  readGitHubJson,
} from './github-api.js';
import type {
  GitHubPullRequestConversationCommit,
  GitHubPullRequestConversationMerged,
  GitHubPullRequestConversationIssueComment,
  GitHubPullRequestConversationItem,
  GitHubPullRequestConversationReview,
  GitHubPullRequestConversationReviewThread,
  GitHubPullRequestConversationSnapshot,
  GitHubPullRequestReviewComment,
  GitHubPullRequestReviewState,
  GitHubRepositoryRef,
} from './types.js';

const TIMELINE_PAGE_SIZE = 100;
const REVIEW_COMMENTS_PAGE_SIZE = 100;

interface GitHubUserRef {
  login?: string | null;
  avatar_url?: string | null;
}

interface GitHubTimelineEvent {
  id?: number | string;
  event?: string | null;
  created_at?: string | null;
  submitted_at?: string | null;
  updated_at?: string | null;
  body?: string | null;
  state?: string | null;
  html_url?: string | null;
  sha?: string | null;
  message?: string | null;
  actor?: GitHubUserRef | null;
  user?: GitHubUserRef | null;
  author?: { name?: string | null; date?: string | null; email?: string | null } | null;
  commit?: {
    sha?: string | null;
    html_url?: string | null;
    message?: string | null;
    author?: { name?: string | null; date?: string | null; email?: string | null } | null;
  } | null;
  commit_id?: string | null;
}

interface GitHubReviewCommentApiItem {
  id: number;
  in_reply_to_id?: number | null;
  pull_request_review_id?: number | null;
  body?: string | null;
  path?: string | null;
  diff_hunk?: string | null;
  line?: number | null;
  html_url?: string | null;
  created_at?: string | null;
  user?: GitHubUserRef | null;
}

function resolveActor(event: GitHubTimelineEvent): GitHubUserRef | null {
  return event.actor ?? event.user ?? null;
}

function resolveLogin(user: GitHubUserRef | null | undefined): string {
  return user?.login?.trim() || 'unknown';
}

function resolveAvatarUrl(user: GitHubUserRef | null | undefined): string {
  const url = user?.avatar_url?.trim();
  if (url) {
    return url;
  }
  const login = resolveLogin(user);
  return `https://github.com/${login}.png?size=40`;
}

function normalizeReviewState(state: string | null | undefined): GitHubPullRequestReviewState {
  switch (state?.trim().toUpperCase()) {
    case 'APPROVED':
      return 'APPROVED';
    case 'CHANGES_REQUESTED':
      return 'CHANGES_REQUESTED';
    case 'DISMISSED':
      return 'DISMISSED';
    default:
      return 'COMMENTED';
  }
}

function resolveCommittedTimelineFields(
  event: GitHubTimelineEvent,
): {
  sha: string;
  message: string;
  url: string;
  authorName: string;
  authorEmail: string | null;
  authorDate: string | null;
} | null {
  const nested = event.commit;
  const sha = nested?.sha?.trim() || event.sha?.trim() || event.commit_id?.trim() || '';
  if (!sha) {
    return null;
  }

  const author = nested?.author ?? event.author;
  return {
    sha,
    message: nested?.message ?? event.message ?? '',
    url: nested?.html_url?.trim() || event.html_url?.trim() || '',
    authorName: author?.name?.trim() || '',
    authorEmail: author?.email?.trim() || null,
    authorDate: author?.date?.trim() || null,
  };
}

function resolveTimelineEventCreatedAt(event: GitHubTimelineEvent): string | null {
  const direct = event.created_at?.trim() || event.submitted_at?.trim() || event.updated_at?.trim();
  if (direct) {
    return direct;
  }

  if (event.event?.trim() === 'committed') {
    const committed = resolveCommittedTimelineFields(event);
    if (committed?.authorDate) {
      return committed.authorDate;
    }
  }

  return null;
}

function mapReviewComment(item: GitHubReviewCommentApiItem): GitHubPullRequestReviewComment {
  return {
    id: item.id,
    authorLogin: resolveLogin(item.user),
    avatarUrl: resolveAvatarUrl(item.user),
    body: item.body?.trim() || '',
    createdAt: item.created_at?.trim() || new Date(0).toISOString(),
    url: item.html_url?.trim() || '',
  };
}

export function groupReviewCommentsIntoThreads(
  comments: GitHubReviewCommentApiItem[],
): GitHubPullRequestConversationReviewThread[] {
  if (comments.length === 0) {
    return [];
  }

  const byId = new Map<number, GitHubReviewCommentApiItem>();
  for (const comment of comments) {
    byId.set(comment.id, comment);
  }

  const childrenByRoot = new Map<number, GitHubReviewCommentApiItem[]>();
  const roots: GitHubReviewCommentApiItem[] = [];

  for (const comment of comments) {
    const replyTo = comment.in_reply_to_id;
    if (replyTo == null) {
      roots.push(comment);
      continue;
    }

    let rootId = replyTo;
    let cursor = byId.get(replyTo);
    while (cursor?.in_reply_to_id != null) {
      rootId = cursor.in_reply_to_id;
      cursor = byId.get(cursor.in_reply_to_id);
    }

    const bucket = childrenByRoot.get(rootId) ?? [];
    bucket.push(comment);
    childrenByRoot.set(rootId, bucket);
  }

  return roots.map((root) => {
    const replies = (childrenByRoot.get(root.id) ?? []).sort(
      (left, right) =>
        new Date(left.created_at ?? 0).getTime() - new Date(right.created_at ?? 0).getTime(),
    );
    const threadComments = [root, ...replies].map(mapReviewComment);
    const mappedRoot = threadComments[0]!;

    return {
      kind: 'reviewThread',
      id: `review-thread-${root.id}`,
      createdAt: mappedRoot.createdAt,
      authorLogin: mappedRoot.authorLogin,
      avatarUrl: mappedRoot.avatarUrl,
      path: root.path?.trim() || '',
      diffHunk: root.diff_hunk?.trim() || '',
      line: root.line ?? null,
      url: mappedRoot.url,
      comments: threadComments,
      ...(root.pull_request_review_id != null
        ? { reviewId: `review-${root.pull_request_review_id}` }
        : {}),
    };
  });
}

export function mapTimelineEventToConversationItem(
  event: GitHubTimelineEvent,
): GitHubPullRequestConversationItem | null {
  const eventType = event.event?.trim();
  if (!eventType) {
    return null;
  }

  if (eventType === 'pull_request_review_comment') {
    return null;
  }

  const createdAt = resolveTimelineEventCreatedAt(event);
  if (!createdAt) {
    return null;
  }

  const actor = resolveActor(event);
  const authorLogin = resolveLogin(actor);
  const avatarUrl = resolveAvatarUrl(actor);
  const eventId = String(event.id ?? `${eventType}-${createdAt}`);

  if (eventType === 'committed') {
    const committed = resolveCommittedTimelineFields(event);
    if (!committed) {
      return null;
    }
    const identity = resolveGitCommitAuthorIdentity({
      gitHubUser: actor,
      authorName: committed.authorName,
      authorEmail: committed.authorEmail,
    });
    const item: GitHubPullRequestConversationCommit = {
      kind: 'commit',
      id: `commit-${committed.sha}`,
      createdAt,
      authorLogin: identity.login,
      avatarUrl: identity.avatarUrl,
      subject: commitSubject(committed.message),
      sha: committed.sha,
      url: committed.url,
    };
    return item;
  }

  if (eventType === 'commented') {
    const body = event.body?.trim() || '';
    const item: GitHubPullRequestConversationIssueComment = {
      kind: 'issueComment',
      id: `issue-comment-${eventId}`,
      createdAt,
      authorLogin,
      avatarUrl,
      body,
      url: event.html_url?.trim() || '',
    };
    return item;
  }

  if (eventType === 'reviewed') {
    const body = event.body?.trim();
    const item: GitHubPullRequestConversationReview = {
      kind: 'review',
      id: `review-${eventId}`,
      createdAt,
      authorLogin,
      avatarUrl,
      state: normalizeReviewState(event.state),
      url: event.html_url?.trim() || '',
      threads: [],
      ...(body ? { body } : {}),
    };
    return item;
  }

  if (eventType === 'merged') {
    const item: GitHubPullRequestConversationMerged = {
      kind: 'merged',
      id: `merged-${eventId}`,
      createdAt,
      authorLogin,
      avatarUrl,
      url: event.html_url?.trim() || '',
    };
    return item;
  }

  return null;
}

export function nestReviewThreadsUnderReviews(
  items: GitHubPullRequestConversationItem[],
): GitHubPullRequestConversationItem[] {
  const reviewIds = new Set(
    items
      .filter((item): item is GitHubPullRequestConversationReview => item.kind === 'review')
      .map((item) => item.id),
  );
  const threadsByReviewId = new Map<string, GitHubPullRequestConversationReviewThread[]>();

  for (const item of items) {
    if (item.kind !== 'reviewThread' || !item.reviewId || !reviewIds.has(item.reviewId)) {
      continue;
    }
    const bucket = threadsByReviewId.get(item.reviewId) ?? [];
    bucket.push(item);
    threadsByReviewId.set(item.reviewId, bucket);
  }

  const output: GitHubPullRequestConversationItem[] = [];

  for (const item of items) {
    if (item.kind === 'reviewThread') {
      if (item.reviewId && reviewIds.has(item.reviewId)) {
        continue;
      }
      output.push(item);
      continue;
    }

    if (item.kind === 'review') {
      const threads = [...(threadsByReviewId.get(item.id) ?? [])].sort(
        (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
      );
      output.push({ ...item, threads });
      continue;
    }

    output.push(item);
  }

  return output;
}

export function mergePullRequestConversationItems(
  timelineEvents: GitHubTimelineEvent[],
  reviewComments: GitHubReviewCommentApiItem[],
): GitHubPullRequestConversationItem[] {
  const reviewThreadIds = new Set(reviewComments.map((comment) => comment.id));

  const fromTimeline = timelineEvents
    .map(mapTimelineEventToConversationItem)
    .filter((item): item is GitHubPullRequestConversationItem => item != null)
    .filter((item) => {
      if (item.kind !== 'issueComment') {
        return true;
      }
      return !reviewThreadIds.has(Number(item.id.replace(/^issue-comment-/, '')));
    });

  const threads = groupReviewCommentsIntoThreads(reviewComments);
  const merged = [...fromTimeline, ...threads];

  merged.sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );

  const seen = new Set<string>();
  const deduped = merged.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });

  return nestReviewThreadsUnderReviews(deduped);
}

async function fetchIssueTimeline(
  accessToken: string,
  repository: GitHubRepositoryRef,
  issueNumber: number,
): Promise<{ events: GitHubTimelineEvent[]; hasMore: boolean }> {
  const params = new URLSearchParams({ per_page: String(TIMELINE_PAGE_SIZE) });
  const url = `${GITHUB_API_BASE_URL}/repos/${repository.owner}/${repository.repo}/issues/${issueNumber}/timeline?${params.toString()}`;
  const response = await fetch(url, { headers: githubApiHeaders(accessToken) });
  const events = await readGitHubJson<GitHubTimelineEvent[]>(response);
  return {
    events,
    hasMore: githubHasNextPage(response) || events.length >= TIMELINE_PAGE_SIZE,
  };
}

async function fetchPullRequestReviewComments(
  accessToken: string,
  repository: GitHubRepositoryRef,
  pullNumber: number,
): Promise<{ comments: GitHubReviewCommentApiItem[]; hasMore: boolean }> {
  const params = new URLSearchParams({ per_page: String(REVIEW_COMMENTS_PAGE_SIZE) });
  const url = `${GITHUB_API_BASE_URL}/repos/${repository.owner}/${repository.repo}/pulls/${pullNumber}/comments?${params.toString()}`;
  const response = await fetch(url, { headers: githubApiHeaders(accessToken) });
  const comments = await readGitHubJson<GitHubReviewCommentApiItem[]>(response);
  return {
    comments,
    hasMore: githubHasNextPage(response) || comments.length >= REVIEW_COMMENTS_PAGE_SIZE,
  };
}

export async function getPullRequestConversation(
  accessToken: string,
  repository: GitHubRepositoryRef,
  pullNumber: number,
): Promise<GitHubPullRequestConversationSnapshot> {
  const [timeline, reviewComments] = await Promise.all([
    fetchIssueTimeline(accessToken, repository, pullNumber),
    fetchPullRequestReviewComments(accessToken, repository, pullNumber),
  ]);

  return {
    items: mergePullRequestConversationItems(timeline.events, reviewComments.comments),
    hasMore: timeline.hasMore || reviewComments.hasMore,
  };
}

export type {
  GitHubReviewCommentApiItem,
  GitHubTimelineEvent,
};
