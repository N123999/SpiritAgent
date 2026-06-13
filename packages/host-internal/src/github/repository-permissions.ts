import { githubApiHeaders, readGitHubJson } from './github-api.js';
import { GITHUB_API_BASE_URL } from './oauth-config.js';
import type { GitHubRepositoryRef } from './types.js';

interface GitHubRepositoryPermissionsApi {
  permissions?: {
    admin?: boolean | null;
    maintain?: boolean | null;
    push?: boolean | null;
    pull?: boolean | null;
  } | null;
}

export function viewerCanMergeFromPermissions(
  permissions: GitHubRepositoryPermissionsApi['permissions'],
): boolean {
  if (!permissions) {
    return false;
  }
  return Boolean(permissions.admin || permissions.maintain || permissions.push);
}

export async function getRepositoryPermissions(
  accessToken: string,
  repository: GitHubRepositoryRef,
): Promise<GitHubRepositoryPermissionsApi['permissions']> {
  const url = `${GITHUB_API_BASE_URL}/repos/${repository.owner}/${repository.repo}`;
  const response = await fetch(url, { headers: githubApiHeaders(accessToken) });
  const payload = await readGitHubJson<GitHubRepositoryPermissionsApi>(response);
  return payload.permissions ?? null;
}
