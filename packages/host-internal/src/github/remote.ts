import type { GitHubRepositoryRef } from './types.js';

export function parseGitHubRemoteUrl(rawUrl: string): GitHubRepositoryRef | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/iu);
  if (sshMatch) {
    const owner = sshMatch[1]?.trim();
    const repo = sshMatch[2]?.trim();
    if (owner && repo) {
      return { owner, repo };
    }
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname !== 'github.com') {
      return null;
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      return null;
    }
    const owner = segments[0]?.trim();
    const repo = segments[1]?.replace(/\.git$/u, '').trim();
    if (!owner || !repo) {
      return null;
    }
    return { owner, repo };
  } catch {
    return null;
  }
}
