import { githubApiHeaders } from './github-api.js';
import { GITHUB_API_BASE_URL } from './oauth-config.js';
import { GitHubOAuthError } from './oauth.js';

interface GitHubGraphQLError {
  message?: string;
}

interface GitHubGraphQLResponse<T> {
  data?: T;
  errors?: GitHubGraphQLError[];
}

export async function executeGitHubGraphQL<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${GITHUB_API_BASE_URL}/graphql`, {
    method: 'POST',
    headers: githubApiHeaders(accessToken),
    body: JSON.stringify({ query, variables }),
  });

  let payload: GitHubGraphQLResponse<T>;
  try {
    payload = (await response.json()) as GitHubGraphQLResponse<T>;
  } catch {
    throw new GitHubOAuthError(
      `GitHub GraphQL request failed: HTTP ${response.status}`,
      response.status,
    );
  }

  const firstError = payload.errors?.[0]?.message?.trim();
  if (firstError) {
    throw new GitHubOAuthError(`GitHub GraphQL request failed: ${firstError}`, response.status);
  }

  if (!response.ok) {
    throw new GitHubOAuthError(
      `GitHub GraphQL request failed: HTTP ${response.status}`,
      response.status,
    );
  }

  if (payload.data == null) {
    throw new GitHubOAuthError('GitHub GraphQL request returned no data.');
  }

  return payload.data;
}
