export type GitHubOAuthFlowRunner = () => Promise<{ login: string }>;

let runner: GitHubOAuthFlowRunner | null = null;

export function registerGitHubOAuthFlowRunner(next: GitHubOAuthFlowRunner): void {
  runner = next;
}

export async function runGitHubOAuthFlow(): Promise<{ login: string }> {
  if (!runner) {
    throw new Error('GitHub OAuth is only available in the Electron desktop app.');
  }
  return runner();
}
