import { executeGitHubGraphQL } from './github-graphql.js';

const MARK_PULL_REQUEST_READY_FOR_REVIEW = `
mutation MarkPullRequestReadyForReview($pullRequestId: ID!) {
  markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
    pullRequest {
      id
      isDraft
    }
  }
}
`;

interface MarkPullRequestReadyForReviewResult {
  markPullRequestReadyForReview?: {
    pullRequest?: {
      id?: string | null;
      isDraft?: boolean | null;
    } | null;
  } | null;
}

export async function markPullRequestReadyForReview(
  accessToken: string,
  pullRequestNodeId: string,
): Promise<void> {
  const nodeId = pullRequestNodeId.trim();
  if (!nodeId) {
    throw new Error('Pull request node ID is required.');
  }

  await executeGitHubGraphQL<MarkPullRequestReadyForReviewResult>(
    accessToken,
    MARK_PULL_REQUEST_READY_FOR_REVIEW,
    { pullRequestId: nodeId },
  );
}
