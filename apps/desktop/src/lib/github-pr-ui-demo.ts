import type {
  GitHubPullRequestConversationItem,
  GitHubPullRequestDetail,
} from "@/types";

/** Static PR detail fixture for unauthenticated UI preview only. */
export const GITHUB_PR_DETAIL_DEMO: GitHubPullRequestDetail = {
  number: 42,
  title: "Fix login bug",
  state: "closed",
  url: "https://github.com/octocat/Hello-World/pull/42",
  authorLogin: "octocat",
  headRef: "fix-login",
  baseRef: "main",
  draft: false,
  merged: true,
  mergeable: null,
  labels: [],
  body: "Reproduces when the session cookie expires during OAuth redirect.\n\n- Clear stale tokens on 401\n- Retry device flow once",
};

/** Static conversation timeline for unauthenticated UI preview only. */
export const GITHUB_PR_CONVERSATION_DEMO: GitHubPullRequestConversationItem[] = [
  {
    kind: "commit",
    id: "commit-demo-1",
    createdAt: "2024-01-02T10:00:00Z",
    authorLogin: "octocat",
    avatarUrl: "https://github.com/octocat.png?size=40",
    subject: "Fix login bug",
    sha: "abc123",
    url: "https://github.com/octocat/Hello-World/commit/abc123",
  },
  {
    kind: "issueComment",
    id: "issue-comment-demo-1",
    createdAt: "2024-01-03T12:00:00Z",
    authorLogin: "octocat",
    avatarUrl: "https://github.com/octocat.png?size=40",
    body: "Can you add a regression test for the redirect path?",
    url: "https://github.com/octocat/Hello-World/issues/42#issuecomment-1",
  },
  {
    kind: "review",
    id: "review-demo-1",
    createdAt: "2024-01-04T14:00:00Z",
    authorLogin: "octocat",
    avatarUrl: "https://github.com/octocat.png?size=40",
    state: "APPROVED",
    body: "Looks good once the token refresh path is covered.",
    url: "https://github.com/octocat/Hello-World/pull/42#pullrequestreview-1",
  },
  {
    kind: "reviewThread",
    id: "review-thread-demo-1",
    createdAt: "2024-01-05T09:30:00Z",
    authorLogin: "octocat",
    avatarUrl: "https://github.com/octocat.png?size=40",
    path: "src/auth/session.ts",
    diffHunk: "@@ -10,7 +10,9 @@ export async function refreshSession() {\n   const token = readToken();\n   if (!token) {\n-    return null;\n+    await clearStaleToken();\n+    return retryDeviceFlow();\n   }\n   return token;\n }",
    line: 12,
    url: "https://github.com/octocat/Hello-World/pull/42#discussion_r100",
    comments: [
      {
        id: 100,
        authorLogin: "octocat",
        avatarUrl: "https://github.com/octocat.png?size=40",
        body: "Should we retry only once here?",
        createdAt: "2024-01-05T09:30:00Z",
        url: "https://github.com/octocat/Hello-World/pull/42#discussion_r100",
      },
      {
        id: 101,
        authorLogin: "octocat",
        avatarUrl: "https://github.com/octocat.png?size=40",
        body: "Yes — the host layer already caps device-flow retries.",
        createdAt: "2024-01-05T10:15:00Z",
        url: "https://github.com/octocat/Hello-World/pull/42#discussion_r101",
      },
    ],
  },
];
