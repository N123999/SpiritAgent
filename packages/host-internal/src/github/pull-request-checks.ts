import { githubApiHeaders, githubHasNextPage, readGitHubJson } from './github-api.js';
import { GITHUB_API_BASE_URL } from './oauth-config.js';
import { getPullRequestDetail } from './pull-request.js';
import type {
  GitHubPullRequestCheck,
  GitHubPullRequestCheckState,
  GitHubPullRequestChecksSnapshot,
  GitHubRepositoryRef,
} from './types.js';

const CHECK_RUNS_PAGE_SIZE = 100;
const EPOCH_ISO = new Date(0).toISOString();

interface GitHubCheckRunApiItem {
  id?: number | null;
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  html_url?: string | null;
}

interface GitHubCheckRunsApiResponse {
  check_runs?: GitHubCheckRunApiItem[] | null;
}

interface GitHubCommitStatusApiItem {
  id?: number | null;
  context?: string | null;
  state?: string | null;
  target_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface GitHubCommitCombinedStatusApiResponse {
  statuses?: GitHubCommitStatusApiItem[] | null;
}

const CHECK_STATE_ORDER: Record<GitHubPullRequestCheckState, number> = {
  in_progress: 0,
  failure: 1,
  success: 2,
};

function resolveIsoTimestamp(
  primary: string | null | undefined,
  fallback: string | null | undefined,
): string {
  const value = primary?.trim() || fallback?.trim();
  return value || EPOCH_ISO;
}

function mapCheckRunState(
  status: string | null | undefined,
  conclusion: string | null | undefined,
): GitHubPullRequestCheckState {
  const normalizedStatus = status?.trim().toLowerCase() || '';
  if (normalizedStatus === 'queued' || normalizedStatus === 'in_progress') {
    return 'in_progress';
  }

  const normalizedConclusion = conclusion?.trim().toLowerCase() || '';
  if (
    normalizedConclusion === 'failure' ||
    normalizedConclusion === 'timed_out' ||
    normalizedConclusion === 'startup_failure' ||
    normalizedConclusion === 'action_required'
  ) {
    return 'failure';
  }

  return 'success';
}

function mapCommitStatusState(state: string | null | undefined): GitHubPullRequestCheckState {
  const normalized = state?.trim().toLowerCase() || '';
  if (normalized === 'failure' || normalized === 'error') {
    return 'failure';
  }
  if (normalized === 'pending') {
    return 'in_progress';
  }
  return 'success';
}

export function mapCheckRun(item: GitHubCheckRunApiItem): GitHubPullRequestCheck | null {
  const id = item.id;
  const name = item.name?.trim();
  if (id == null || !name) {
    return null;
  }

  const startedAt = resolveIsoTimestamp(item.started_at, item.completed_at);
  const completedAt = item.completed_at?.trim() || undefined;
  const url = item.html_url?.trim() || undefined;
  const state = mapCheckRunState(item.status, item.conclusion);

  return {
    id: `run:${id}`,
    name,
    state,
    startedAt,
    ...(completedAt ? { completedAt } : {}),
    ...(url ? { url } : {}),
  };
}

export function mapCommitStatus(item: GitHubCommitStatusApiItem): GitHubPullRequestCheck | null {
  const context = item.context?.trim();
  if (!context) {
    return null;
  }

  const startedAt = resolveIsoTimestamp(item.created_at, item.updated_at);
  const updatedAt = item.updated_at?.trim() || undefined;
  const url = item.target_url?.trim() || undefined;
  const state = mapCommitStatusState(item.state);
  const id = item.id != null ? `status:${item.id}` : `status:${context}`;

  return {
    id,
    name: context,
    state,
    startedAt,
    ...(state === 'success' && updatedAt ? { completedAt: updatedAt } : {}),
    ...(state === 'failure' && updatedAt ? { completedAt: updatedAt } : {}),
    ...(url ? { url } : {}),
  };
}

export function mergePullRequestChecks(
  checkRuns: GitHubPullRequestCheck[],
  legacyStatuses: GitHubPullRequestCheck[],
): GitHubPullRequestCheck[] {
  const merged = new Map<string, GitHubPullRequestCheck>();
  for (const check of legacyStatuses) {
    merged.set(check.name, check);
  }
  for (const check of checkRuns) {
    merged.set(check.name, check);
  }
  return Array.from(merged.values()).sort(comparePullRequestChecks);
}

function comparePullRequestChecks(
  left: GitHubPullRequestCheck,
  right: GitHubPullRequestCheck,
): number {
  const stateDelta = CHECK_STATE_ORDER[left.state] - CHECK_STATE_ORDER[right.state];
  if (stateDelta !== 0) {
    return stateDelta;
  }
  return right.startedAt.localeCompare(left.startedAt);
}

export function mapPullRequestChecks(
  checkRunItems: GitHubCheckRunApiItem[],
  legacyStatusItems: GitHubCommitStatusApiItem[],
): GitHubPullRequestCheck[] {
  const checkRuns = checkRunItems
    .map((item) => mapCheckRun(item))
    .filter((item): item is GitHubPullRequestCheck => item != null);
  const legacyStatuses = legacyStatusItems
    .map((item) => mapCommitStatus(item))
    .filter((item): item is GitHubPullRequestCheck => item != null);
  return mergePullRequestChecks(checkRuns, legacyStatuses);
}

export interface GetPullRequestChecksOptions {
  page?: number;
  perPage?: number;
}

async function getCheckRunsForCommit(
  accessToken: string,
  repository: GitHubRepositoryRef,
  headSha: string,
  options: GetPullRequestChecksOptions,
): Promise<{ checkRuns: GitHubCheckRunApiItem[]; hasMore: boolean }> {
  const page = options.page ?? 1;
  const perPage = options.perPage ?? CHECK_RUNS_PAGE_SIZE;
  const params = new URLSearchParams({
    per_page: String(perPage),
    page: String(page),
  });
  const url = `${GITHUB_API_BASE_URL}/repos/${repository.owner}/${repository.repo}/commits/${headSha}/check-runs?${params.toString()}`;
  const response = await fetch(url, { headers: githubApiHeaders(accessToken) });
  const payload = await readGitHubJson<GitHubCheckRunsApiResponse>(response);
  return {
    checkRuns: payload.check_runs ?? [],
    hasMore: githubHasNextPage(response),
  };
}

async function getLegacyCommitStatuses(
  accessToken: string,
  repository: GitHubRepositoryRef,
  headSha: string,
): Promise<GitHubCommitStatusApiItem[]> {
  const url = `${GITHUB_API_BASE_URL}/repos/${repository.owner}/${repository.repo}/commits/${headSha}/status`;
  const response = await fetch(url, { headers: githubApiHeaders(accessToken) });
  const payload = await readGitHubJson<GitHubCommitCombinedStatusApiResponse>(response);
  return payload.statuses ?? [];
}

export async function getPullRequestChecks(
  accessToken: string,
  repository: GitHubRepositoryRef,
  number: number,
  options: GetPullRequestChecksOptions = {},
): Promise<GitHubPullRequestChecksSnapshot> {
  const detail = await getPullRequestDetail(accessToken, repository, number);
  const headSha = detail.headSha.trim();
  if (!headSha) {
    return {
      checks: [],
      hasMore: false,
      headSha: '',
    };
  }

  const [{ checkRuns, hasMore }, legacyStatuses] = await Promise.all([
    getCheckRunsForCommit(accessToken, repository, headSha, options),
    getLegacyCommitStatuses(accessToken, repository, headSha),
  ]);

  return {
    checks: mapPullRequestChecks(checkRuns, legacyStatuses),
    hasMore,
    headSha,
  };
}
