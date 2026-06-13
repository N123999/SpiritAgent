import { executeGitHubGraphQL } from './github-graphql.js';
import type {
  GitHubPullRequestCheck,
  GitHubPullRequestCheckState,
  GitHubPullRequestChecksSnapshot,
  GitHubRepositoryRef,
} from './types.js';
import type { GetPullRequestChecksOptions } from './pull-request-checks.js';

const STATUS_CHECK_CONTEXTS_PAGE_SIZE = 100;
const EPOCH_ISO = new Date(0).toISOString();

const PULL_REQUEST_CHECKS_GRAPHQL_QUERY = `
query PullRequestChecks($owner: String!, $repo: String!, $number: Int!, $contextsFirst: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      commits(last: 1) {
        nodes {
          commit {
            oid
          }
        }
      }
      statusCheckRollup {
        contexts(first: $contextsFirst, after: $after) {
          nodes {
            __typename
            ... on CheckRun {
              databaseId
              name
              status
              conclusion
              startedAt
              completedAt
              detailsUrl
              isRequired(pullRequestNumber: $number)
            }
            ... on StatusContext {
              context
              state
              targetUrl
              createdAt
              updatedAt
              isRequired(pullRequestNumber: $number)
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
      baseRef {
        refUpdateRule {
          requiredStatusCheckContexts
        }
      }
    }
  }
}
`;

interface GraphQLCheckRunNode {
  __typename: 'CheckRun';
  databaseId?: number | null;
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  detailsUrl?: string | null;
  isRequired?: boolean | null;
}

interface GraphQLStatusContextNode {
  __typename: 'StatusContext';
  context?: string | null;
  state?: string | null;
  targetUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  isRequired?: boolean | null;
}

type GraphQLStatusCheckContextNode = GraphQLCheckRunNode | GraphQLStatusContextNode;

interface PullRequestChecksGraphQLResponse {
  repository?: {
    pullRequest?: {
      commits?: {
        nodes?: Array<{
          commit?: {
            oid?: string | null;
          } | null;
        } | null> | null;
      } | null;
      statusCheckRollup?: {
        contexts?: {
          nodes?: Array<GraphQLStatusCheckContextNode | null> | null;
          pageInfo?: {
            hasNextPage?: boolean | null;
            endCursor?: string | null;
          } | null;
        } | null;
      } | null;
      baseRef?: {
        refUpdateRule?: {
          requiredStatusCheckContexts?: string[] | null;
        } | null;
      } | null;
    } | null;
  } | null;
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

function mapGraphQLCheckRunState(
  status: string | null | undefined,
  conclusion: string | null | undefined,
): GitHubPullRequestCheckState {
  const normalizedStatus = status?.trim().toUpperCase() || '';
  if (
    normalizedStatus === 'QUEUED' ||
    normalizedStatus === 'IN_PROGRESS' ||
    normalizedStatus === 'PENDING' ||
    normalizedStatus === 'WAITING' ||
    normalizedStatus === 'REQUESTED'
  ) {
    return 'in_progress';
  }

  const normalizedConclusion = conclusion?.trim().toUpperCase() || '';
  if (
    normalizedConclusion === 'FAILURE' ||
    normalizedConclusion === 'TIMED_OUT' ||
    normalizedConclusion === 'STARTUP_FAILURE' ||
    normalizedConclusion === 'ACTION_REQUIRED' ||
    normalizedConclusion === 'CANCELLED' ||
    normalizedConclusion === 'STALE'
  ) {
    return 'failure';
  }

  return 'success';
}

function mapGraphQLStatusContextState(state: string | null | undefined): GitHubPullRequestCheckState {
  const normalized = state?.trim().toUpperCase() || '';
  if (normalized === 'FAILURE' || normalized === 'ERROR') {
    return 'failure';
  }
  if (normalized === 'PENDING') {
    return 'in_progress';
  }
  return 'success';
}

export function mapGraphQLCheckRunNode(node: GraphQLCheckRunNode): GitHubPullRequestCheck | null {
  const databaseId = node.databaseId;
  const name = node.name?.trim();
  if (databaseId == null || !name) {
    return null;
  }

  const state = mapGraphQLCheckRunState(node.status, node.conclusion);
  const startedAt = resolveIsoTimestamp(node.startedAt, node.completedAt);
  const completedAt = node.completedAt?.trim() || undefined;
  const url = node.detailsUrl?.trim() || undefined;

  return {
    id: `run:${databaseId}`,
    name,
    state,
    startedAt,
    ...(completedAt ? { completedAt } : {}),
    ...(url ? { url } : {}),
    ...(node.isRequired === true ? { required: true } : {}),
  };
}

export function mapGraphQLStatusContextNode(
  node: GraphQLStatusContextNode,
): GitHubPullRequestCheck | null {
  const name = node.context?.trim();
  if (!name) {
    return null;
  }

  const state = mapGraphQLStatusContextState(node.state);
  const startedAt = resolveIsoTimestamp(node.createdAt, node.updatedAt);
  const updatedAt = node.updatedAt?.trim() || undefined;
  const url = node.targetUrl?.trim() || undefined;

  return {
    id: `status:${name}`,
    name,
    state,
    startedAt,
    ...(state === 'success' && updatedAt ? { completedAt: updatedAt } : {}),
    ...(state === 'failure' && updatedAt ? { completedAt: updatedAt } : {}),
    ...(url ? { url } : {}),
    ...(node.isRequired === true ? { required: true } : {}),
  };
}

export function mapGraphQLStatusCheckContextNode(
  node: GraphQLStatusCheckContextNode,
): GitHubPullRequestCheck | null {
  if (node.__typename === 'CheckRun') {
    return mapGraphQLCheckRunNode(node);
  }
  if (node.__typename === 'StatusContext') {
    return mapGraphQLStatusContextNode(node);
  }
  return null;
}

export function createExpectedRequiredCheck(name: string): GitHubPullRequestCheck {
  return {
    id: `expected:${name}`,
    name,
    state: 'pending',
    startedAt: EPOCH_ISO,
    required: true,
  };
}

export function mergeRequiredStatusChecks(
  reportedChecks: GitHubPullRequestCheck[],
  requiredContexts: readonly string[],
): GitHubPullRequestCheck[] {
  const merged = new Map<string, GitHubPullRequestCheck>();
  for (const check of reportedChecks) {
    merged.set(check.name, check);
  }

  for (const context of requiredContexts) {
    const name = context.trim();
    if (!name || merged.has(name)) {
      continue;
    }
    merged.set(name, createExpectedRequiredCheck(name));
  }

  return Array.from(merged.values()).sort(comparePullRequestChecks);
}

function comparePullRequestChecks(
  left: GitHubPullRequestCheck,
  right: GitHubPullRequestCheck,
): number {
  const requiredDelta = Number(right.required === true) - Number(left.required === true);
  if (requiredDelta !== 0) {
    return requiredDelta;
  }

  const stateDelta = CHECK_STATE_ORDER[left.state] - CHECK_STATE_ORDER[right.state];
  if (stateDelta !== 0) {
    return stateDelta;
  }

  return left.name.localeCompare(right.name);
}

export function appendPullRequestChecksPages(
  existing: GitHubPullRequestCheck[],
  incoming: GitHubPullRequestCheck[],
): GitHubPullRequestCheck[] {
  const merged = new Map(existing.map((check) => [check.name, check]));
  for (const check of incoming) {
    merged.set(check.name, check);
  }
  return Array.from(merged.values()).sort(comparePullRequestChecks);
}

export async function getPullRequestChecksViaGraphQL(
  accessToken: string,
  repository: GitHubRepositoryRef,
  number: number,
  options: GetPullRequestChecksOptions = {},
): Promise<GitHubPullRequestChecksSnapshot> {
  const after = options.after?.trim() || null;
  const isContinuation = after != null;

  const data = await executeGitHubGraphQL<PullRequestChecksGraphQLResponse>(
    accessToken,
    PULL_REQUEST_CHECKS_GRAPHQL_QUERY,
    {
      owner: repository.owner,
      repo: repository.repo,
      number,
      contextsFirst: options.perPage ?? STATUS_CHECK_CONTEXTS_PAGE_SIZE,
      after,
    },
  );

  const pullRequest = data.repository?.pullRequest;
  const headSha = pullRequest?.commits?.nodes?.[0]?.commit?.oid?.trim() ?? '';
  const contextNodes = pullRequest?.statusCheckRollup?.contexts?.nodes ?? [];
  const pageInfo = pullRequest?.statusCheckRollup?.contexts?.pageInfo;
  const hasMore = pageInfo?.hasNextPage === true;
  const nextCursor = pageInfo?.endCursor?.trim() || undefined;
  const requiredContexts = isContinuation
    ? []
    : (pullRequest?.baseRef?.refUpdateRule?.requiredStatusCheckContexts ?? []);

  const reportedChecks = contextNodes
    .filter((node): node is GraphQLStatusCheckContextNode => node != null)
    .map((node) => mapGraphQLStatusCheckContextNode(node))
    .filter((check): check is GitHubPullRequestCheck => check != null);

  return {
    checks: mergeRequiredStatusChecks(reportedChecks, requiredContexts),
    hasMore,
    headSha,
    ...(nextCursor ? { nextCursor } : {}),
  };
}
