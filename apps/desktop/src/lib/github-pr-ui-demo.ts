import type {
  GitHubPullRequestChangedFile,
  GitHubPullRequestConversationItem,
  GitHubPullRequestDetail,
  GitHubPullRequestFilesSnapshot,
  GitHubPullRequestCommitsSnapshot,
  GitHubPullRequestChecksSnapshot,
} from "@/types";

/** Static PR detail fixture for unauthenticated UI preview only. */
export const GITHUB_PR_DETAIL_DEMO: GitHubPullRequestDetail = {
  number: 42,
  title: "Fix login bug",
  state: "closed",
  url: "https://github.com/octocat/Hello-World/pull/42",
  authorLogin: "octocat",
  headRef: "fix-login",
  headSha: "abc123def4567890",
  baseRef: "main",
  draft: false,
  merged: true,
  mergeable: null,
  mergeableState: null,
  nodeId: "PR_kwDOA_demo42",
  viewerCanMerge: false,
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
    kind: "commit",
    id: "commit-demo-2",
    createdAt: "2024-01-02T11:20:00Z",
    authorLogin: "octocat",
    avatarUrl: "https://github.com/octocat.png?size=40",
    subject: "Clear stale tokens on 401",
    sha: "def456",
    url: "https://github.com/octocat/Hello-World/commit/def456",
  },
  {
    kind: "commit",
    id: "commit-demo-3",
    createdAt: "2024-01-02T13:45:00Z",
    authorLogin: "octocat",
    avatarUrl: "https://github.com/octocat.png?size=40",
    subject: "Retry device flow once after token refresh",
    sha: "ghi789",
    url: "https://github.com/octocat/Hello-World/commit/ghi789",
  },
  {
    kind: "commit",
    id: "commit-demo-4",
    createdAt: "2024-01-02T16:10:00Z",
    authorLogin: "octocat",
    avatarUrl: "https://github.com/octocat.png?size=40",
    subject: "Add regression test for OAuth redirect",
    sha: "jkl012",
    url: "https://github.com/octocat/Hello-World/commit/jkl012",
  },
  {
    kind: "commit",
    id: "commit-demo-5",
    createdAt: "2024-01-02T18:30:00Z",
    authorLogin: "octocat",
    avatarUrl: "https://github.com/octocat.png?size=40",
    subject: "Handle expired session cookie during redirect",
    sha: "mno345",
    url: "https://github.com/octocat/Hello-World/commit/mno345",
  },
  {
    kind: "commit",
    id: "commit-demo-6",
    createdAt: "2024-01-02T21:00:00Z",
    authorLogin: "octocat",
    avatarUrl: "https://github.com/octocat.png?size=40",
    subject: "Address review feedback on retry cap",
    sha: "pqr678",
    url: "https://github.com/octocat/Hello-World/commit/pqr678",
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
    threads: [],
  },
  {
    kind: "review",
    id: "review-demo-2",
    createdAt: "2024-01-05T09:00:00Z",
    authorLogin: "octocat",
    avatarUrl: "https://github.com/octocat.png?size=40",
    state: "COMMENTED",
    body: "Overall this looks solid. Left one inline note on the auth refresh retry path.",
    url: "https://github.com/octocat/Hello-World/pull/42#pullrequestreview-2",
    threads: [
      {
        kind: "reviewThread",
        id: "review-thread-demo-1",
        reviewId: "review-demo-2",
        createdAt: "2024-01-05T09:30:00Z",
        authorLogin: "octocat",
        avatarUrl: "https://github.com/octocat.png?size=40",
        path: "src/auth/session.ts",
        diffHunk:
          "@@ -10,7 +10,9 @@ export async function refreshSession() {\n   const token = readToken();\n   if (!token) {\n-    return null;\n+    await clearStaleToken();\n+    return retryDeviceFlow();\n   }\n   return token;\n }",
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
    ],
  },
  {
    kind: "merged",
    id: "merged-demo-1",
    createdAt: "2024-01-06T16:00:00Z",
    authorLogin: "octocat",
    avatarUrl: "https://github.com/octocat.png?size=40",
    url: "https://github.com/octocat/Hello-World/pull/42#event-1",
  },
];

const SESSION_TS_PATCH = `@@ -1,18 +1,22 @@
+import { clearStaleToken } from "./token-store";
+import { retryDeviceFlow } from "./device-flow";
+
 export interface SessionState {
   userId: string;
   expiresAt: number;
 }
 
 export async function readSession(): Promise<SessionState | null> {
   const token = readToken();
   if (!token) {
-    return null;
+    await clearStaleToken();
+    return retryDeviceFlow();
   }
   return parseSession(token);
 }
 
 export function readToken(): string | null {
   return localStorage.getItem("session_token");
 }
@@ -24,12 +28,18 @@ export async function refreshSession(): Promise<string | null> {
   const token = readToken();
   if (!token) {
-    return null;
+    await clearStaleToken();
+    return retryDeviceFlow();
   }
   if (isExpired(token)) {
-    return renewToken(token);
+    const renewed = await renewToken(token);
+    if (!renewed) {
+      await clearStaleToken();
+      return retryDeviceFlow();
+    }
+    return renewed;
   }
   return token;
 }
 
 export async function clearSession(): Promise<void> {
@@ -40,6 +50,14 @@ export async function clearSession(): Promise<void> {
   localStorage.removeItem("session_token");
 }
 
+export async function ensureActiveSession(): Promise<string> {
+  const token = await refreshSession();
+  if (!token) {
+    throw new Error("Unable to establish session");
+  }
+  return token;
+}
+
 function isExpired(token: string): boolean {
   const payload = decodeToken(token);
   return payload.exp * 1000 <= Date.now();
@@ -58,10 +76,18 @@ async function renewToken(token: string): Promise<string | null> {
   if (!response.ok) {
     return null;
   }
   const next = await response.json();
   persistToken(next.accessToken);
   return next.accessToken;
 }
+
+export function sessionDebugLabel(token: string | null): string {
+  if (!token) {
+    return "missing";
+  }
+  return isExpired(token) ? "expired" : "active";
+}
 
 function persistToken(token: string): void {
   localStorage.setItem("session_token", token);
 }
@@ -72,18 +98,36 @@ function parseSession(token: string): SessionState | null {
   }
   return { userId: payload.sub, expiresAt: payload.exp * 1000 };
 }
 
 function decodeToken(token: string): { sub: string; exp: number } {
   const [, payload] = token.split(".");
   return JSON.parse(atob(payload));
 }
+
+export async function rotateSessionIfNeeded(force = false): Promise<string | null> {
+  const token = readToken();
+  if (!token) {
+    return retryDeviceFlow();
+  }
+  if (!force && !isExpired(token)) {
+    return token;
+  }
+  return refreshSession();
+}
+
+export async function invalidateSession(): Promise<void> {
+  await clearSession();
+  await clearStaleToken();
+}
`;

/** Static changed-files fixture for unauthenticated UI preview only. */
export const GITHUB_PR_FILES_DEMO: GitHubPullRequestFilesSnapshot = {
  hasMore: false,
  files: [
    {
      filename: "src/auth/session.ts",
      status: "modified",
      additions: 42,
      deletions: 6,
      changes: 48,
      patch: SESSION_TS_PATCH,
      blobUrl: "https://github.com/octocat/Hello-World/blob/fix-login/src/auth/session.ts",
    },
    {
      filename: "src/auth/device-flow.ts",
      status: "modified",
      additions: 28,
      deletions: 2,
      changes: 30,
      patch: `@@ -1,18 +1,34 @@
 export const MAX_DEVICE_FLOW_RETRIES = 1;
+export const DEVICE_FLOW_TIMEOUT_MS = 60_000;
+export const DEVICE_FLOW_POLL_INTERVAL_MS = 1_500;
 
 export async function retryDeviceFlow() {
-  return startDeviceFlow();
+  return startDeviceFlow({ timeoutMs: DEVICE_FLOW_TIMEOUT_MS });
 }
 
 export async function startDeviceFlow(options?: { timeoutMs?: number }) {
   const timeoutMs = options?.timeoutMs ?? DEVICE_FLOW_TIMEOUT_MS;
   const controller = new AbortController();
   const timer = setTimeout(() => controller.abort(), timeoutMs);
   try {
     return await pollDeviceFlow(controller.signal);
   } finally {
     clearTimeout(timer);
   }
 }
+
+async function pollDeviceFlow(signal: AbortSignal): Promise<string> {
+  for (let attempt = 0; attempt < MAX_DEVICE_FLOW_RETRIES; attempt += 1) {
+    const token = await requestDeviceToken(signal);
+    if (token) {
+      return token;
+    }
+    await delay(DEVICE_FLOW_POLL_INTERVAL_MS, signal);
+  }
+  throw new Error("Device flow timed out");
+}
+
+function delay(ms: number, signal: AbortSignal): Promise<void> {
+  return new Promise((resolve, reject) => {
+    const timer = setTimeout(resolve, ms);
+    signal.addEventListener("abort", () => {
+      clearTimeout(timer);
+      reject(signal.reason);
+    });
+  });
+}`,
      blobUrl: "https://github.com/octocat/Hello-World/blob/fix-login/src/auth/device-flow.ts",
    },
    {
      filename: "tests/auth/session.test.ts",
      status: "added",
      additions: 48,
      deletions: 0,
      changes: 48,
      patch: `@@ -0,0 +1,8 @@
+import { refreshSession } from "../../src/auth/session";
+
+test("retries device flow when token missing", async () => {
+  // ...
+});`,
      blobUrl: "https://github.com/octocat/Hello-World/blob/fix-login/tests/auth/session.test.ts",
    },
    {
      filename: "assets/logo.png",
      status: "added",
      additions: 0,
      deletions: 0,
      changes: 0,
      blobUrl: "https://github.com/octocat/Hello-World/blob/fix-login/assets/logo.png",
    },
  ] satisfies GitHubPullRequestChangedFile[],
};

/** Static commits list for unauthenticated UI preview only. */
export const GITHUB_PR_COMMITS_DEMO: GitHubPullRequestCommitsSnapshot = {
  hasMore: false,
  commits: [
    {
      sha: "abc123",
      subject: "feat(auth): add session refresh on OAuth redirect",
      authorLogin: "octocat",
      avatarUrl: "https://github.com/octocat.png?size=40",
      createdAt: "2024-01-02T21:00:00Z",
      url: "https://github.com/octocat/Hello-World/commit/abc123",
    },
    {
      sha: "def456",
      subject: "fix(auth): clear stale tokens on 401",
      authorLogin: "octocat",
      avatarUrl: "https://github.com/octocat.png?size=40",
      createdAt: "2024-01-02T18:30:00Z",
      url: "https://github.com/octocat/Hello-World/commit/def456",
    },
    {
      sha: "ghi789",
      subject: "test(auth): add regression for expired session cookie",
      authorLogin: "octocat",
      avatarUrl: "https://github.com/octocat.png?size=40",
      createdAt: "2024-01-02T16:10:00Z",
      url: "https://github.com/octocat/Hello-World/commit/ghi789",
    },
    {
      sha: "jkl012",
      subject: "refactor(auth): retry device flow once after token refresh",
      authorLogin: "octocat",
      avatarUrl: "https://github.com/octocat.png?size=40",
      createdAt: "2024-01-02T13:45:00Z",
      url: "https://github.com/octocat/Hello-World/commit/jkl012",
    },
    {
      sha: "mno345",
      subject: "chore: update login bug repro steps",
      authorLogin: "octocat",
      avatarUrl: "https://github.com/octocat.png?size=40",
      createdAt: "2024-01-02T10:00:00Z",
      url: "https://github.com/octocat/Hello-World/commit/mno345",
    },
  ],
};

const GITHUB_PR_CHECKS_DEMO_IN_PROGRESS_STARTED_AT = new Date(Date.now() - 45_000).toISOString();

/** Static checks list for unauthenticated UI preview only. */
export const GITHUB_PR_CHECKS_DEMO: GitHubPullRequestChecksSnapshot = {
  hasMore: false,
  headSha: "abc123def4567890",
  checks: [
    {
      id: "run:501",
      name: "build",
      state: "in_progress",
      startedAt: GITHUB_PR_CHECKS_DEMO_IN_PROGRESS_STARTED_AT,
      url: "https://github.com/octocat/Hello-World/actions/runs/501",
    },
    {
      id: "run:502",
      name: "lint",
      state: "failure",
      startedAt: "2024-01-02T20:50:00Z",
      completedAt: "2024-01-02T20:52:10Z",
      url: "https://github.com/octocat/Hello-World/actions/runs/502",
    },
    {
      id: "run:503",
      name: "test",
      state: "success",
      startedAt: "2024-01-02T20:45:00Z",
      completedAt: "2024-01-02T20:47:35Z",
      url: "https://github.com/octocat/Hello-World/actions/runs/503",
    },
  ],
};
