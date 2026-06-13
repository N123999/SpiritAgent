import { executeGitHubGraphQL } from './github-graphql.js';
import { viewerCanMergeFromPermissions } from './repository-permissions.js';
import type { GitHubRepositoryRef } from './types.js';

const VIEWER_MERGE_HEADLINE_QUERY = `
query ViewerMergeHeadline($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      viewerMergeHeadlineText
    }
  }
}
`;

interface ViewerMergeHeadlineResponse {
  repository?: {
    pullRequest?: {
      viewerMergeHeadlineText?: string | null;
    } | null;
  } | null;
}

export function resolveViewerCanMerge(
  viewerMergeHeadlineText: string | null | undefined,
  permissions: Parameters<typeof viewerCanMergeFromPermissions>[0],
): boolean {
  if (viewerMergeHeadlineText !== null && viewerMergeHeadlineText !== undefined) {
    return Boolean(viewerMergeHeadlineText.trim());
  }
  return viewerCanMergeFromPermissions(permissions);
}

export async function fetchViewerMergeHeadlineText(
  accessToken: string,
  repository: GitHubRepositoryRef,
  number: number,
): Promise<string | null> {
  try {
    const data = await executeGitHubGraphQL<ViewerMergeHeadlineResponse>(
      accessToken,
      VIEWER_MERGE_HEADLINE_QUERY,
      {
        owner: repository.owner,
        repo: repository.repo,
        number,
      },
    );
    return data.repository?.pullRequest?.viewerMergeHeadlineText?.trim() ?? '';
  } catch {
    return null;
  }
}
