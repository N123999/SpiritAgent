import { getPullRequestChecksViaGraphQL } from './pull-request-checks-graphql.js';
import type {
  GitHubPullRequestCheck,
  GitHubPullRequestCheckState,
  GitHubPullRequestChecksSnapshot,
  GitHubRepositoryRef,
} from './types.js';

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

interface GitHubCommitStatusApiItem {
  id?: number | null;
  context?: string | null;
  state?: string | null;
  target_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

const CHECK_STATE_ORDER: Record<GitHubPullRequestCheckState, number> = {
  pending: 0,
  in_progress: 1,
  failure: 2,
  success: 3,
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
  perPage?: number;
  after?: string;
}

export async function getPullRequestChecks(
  accessToken: string,
  repository: GitHubRepositoryRef,
  number: number,
  options: GetPullRequestChecksOptions = {},
): Promise<GitHubPullRequestChecksSnapshot> {
  return getPullRequestChecksViaGraphQL(accessToken, repository, number, options);
}
