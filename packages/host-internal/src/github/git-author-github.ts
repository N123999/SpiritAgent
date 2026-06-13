interface GitHubUserRef {
  login?: string | null;
  avatar_url?: string | null;
}

export function parseGitHubNoreplyLogin(email: string | null | undefined): string | null {
  const trimmed = email?.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(?:\d+\+)?([^@+]+)@users\.noreply\.github\.com$/iu);
  return match?.[1]?.trim() || null;
}

export function resolveGitCommitAuthorIdentity(options: {
  gitHubUser?: GitHubUserRef | null;
  authorName?: string | null;
  authorEmail?: string | null;
}): { login: string; avatarUrl: string } {
  const fromUserLogin = options.gitHubUser?.login?.trim();
  if (fromUserLogin) {
    const avatarUrl = options.gitHubUser?.avatar_url?.trim();
    return {
      login: fromUserLogin,
      avatarUrl: avatarUrl || `https://github.com/${fromUserLogin}.png?size=40`,
    };
  }

  const fromEmail = parseGitHubNoreplyLogin(options.authorEmail);
  if (fromEmail) {
    return {
      login: fromEmail,
      avatarUrl: `https://github.com/${fromEmail}.png?size=40`,
    };
  }

  const name = options.authorName?.trim() || 'unknown';
  return {
    login: name,
    avatarUrl: '',
  };
}
