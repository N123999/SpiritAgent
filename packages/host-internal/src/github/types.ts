export interface GitHubRepositoryRef {
  owner: string;
  repo: string;
}

export interface GitHubAuthStatus {
  connected: boolean;
  login?: string;
}

export interface GitHubDeviceAuthChallenge {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  intervalSeconds: number;
}

export interface GitHubOAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope?: string;
}

export interface GitHubPullRequestSummary {
  number: number;
  title: string;
  state: 'open' | 'closed';
  url: string;
  authorLogin: string;
  headRef: string;
  baseRef: string;
  draft: boolean;
}

export interface GitHubPullRequestDetail extends GitHubPullRequestSummary {
  body?: string;
  labels: string[];
  mergeable: boolean | null;
  merged: boolean;
}

export interface GitHubPullRequestForBranchResult {
  repository: GitHubRepositoryRef | null;
  branch: string | null;
  pullRequest: GitHubPullRequestSummary | null;
}

export type GitHubPullRequestReviewState =
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'COMMENTED'
  | 'DISMISSED';

export interface GitHubPullRequestReviewComment {
  id: number;
  authorLogin: string;
  avatarUrl: string;
  body: string;
  createdAt: string;
  url: string;
}

export interface GitHubPullRequestConversationCommit {
  kind: 'commit';
  id: string;
  createdAt: string;
  authorLogin: string;
  avatarUrl: string;
  subject: string;
  sha: string;
  url: string;
}

export interface GitHubPullRequestConversationIssueComment {
  kind: 'issueComment';
  id: string;
  createdAt: string;
  authorLogin: string;
  avatarUrl: string;
  body: string;
  url: string;
}

export interface GitHubPullRequestConversationReview {
  kind: 'review';
  id: string;
  createdAt: string;
  authorLogin: string;
  avatarUrl: string;
  state: GitHubPullRequestReviewState;
  body?: string;
  url: string;
  threads: GitHubPullRequestConversationReviewThread[];
}

export interface GitHubPullRequestConversationReviewThread {
  kind: 'reviewThread';
  id: string;
  createdAt: string;
  authorLogin: string;
  avatarUrl: string;
  path: string;
  diffHunk: string;
  line: number | null;
  url: string;
  comments: GitHubPullRequestReviewComment[];
  reviewId?: string;
}

export type GitHubPullRequestConversationItem =
  | GitHubPullRequestConversationCommit
  | GitHubPullRequestConversationIssueComment
  | GitHubPullRequestConversationReview
  | GitHubPullRequestConversationReviewThread;

export interface GitHubPullRequestConversationSnapshot {
  items: GitHubPullRequestConversationItem[];
  hasMore: boolean;
}

export type GitHubPullRequestFileStatus =
  | 'added'
  | 'removed'
  | 'modified'
  | 'renamed'
  | 'copied'
  | 'changed'
  | 'unchanged';

export interface GitHubPullRequestChangedFile {
  filename: string;
  status: GitHubPullRequestFileStatus;
  previousFilename?: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  blobUrl?: string;
  rawUrl?: string;
}

export interface GitHubPullRequestFilesSnapshot {
  files: GitHubPullRequestChangedFile[];
  hasMore: boolean;
}
