export function resolveGitHubAvatarUrl(login: string, avatarUrl?: string): string {
  const trimmed = avatarUrl?.trim();
  if (trimmed) {
    return trimmed;
  }
  const normalizedLogin = login.trim() || 'ghost';
  return `https://github.com/${normalizedLogin}.png?size=40`;
}
