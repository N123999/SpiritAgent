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
