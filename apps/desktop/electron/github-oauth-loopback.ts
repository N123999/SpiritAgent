import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { GITHUB_OAUTH_LOOPBACK_PORT } from '@spirit-agent/host-internal';

const OAUTH_CALLBACK_PATH = '/callback';
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

export interface GitHubOAuthCallbackResult {
  code: string;
  state: string;
}

function writeHtml(response: ServerResponse, statusCode: number, title: string, body: string): void {
  response.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`);
}

function readQuery(url: string): URLSearchParams {
  const parsed = new URL(url, 'http://127.0.0.1');
  return parsed.searchParams;
}

export function waitForGitHubOAuthCallback(expectedState: string): Promise<GitHubOAuthCallbackResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let server: Server | undefined;
    const timeout = setTimeout(() => {
      finish(new Error('GitHub OAuth timed out after 5 minutes.'));
    }, OAUTH_TIMEOUT_MS);

    const finish = (error?: Error, result?: GitHubOAuthCallbackResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      server?.close();
      if (error) {
        reject(error);
        return;
      }
      if (!result) {
        reject(new Error('GitHub OAuth callback did not return a result.'));
        return;
      }
      resolve(result);
    };

    const handleRequest = (request: IncomingMessage, response: ServerResponse) => {
      const method = request.method ?? 'GET';
      const requestUrl = request.url ?? '/';
      if (method !== 'GET' || !requestUrl.startsWith(OAUTH_CALLBACK_PATH)) {
        writeHtml(response, 404, 'Not Found', '<p>Not found.</p>');
        return;
      }

      const query = readQuery(requestUrl);
      const error = query.get('error');
      if (error) {
        writeHtml(
          response,
          400,
          'Authorization Failed',
          '<p>GitHub authorization was denied or failed. You can close this window and return to Spirit Agent.</p>',
        );
        finish(new Error(`GitHub OAuth authorization failed: ${error}`));
        return;
      }

      const code = query.get('code')?.trim();
      const state = query.get('state')?.trim();
      if (!code || !state) {
        writeHtml(response, 400, 'Invalid Callback', '<p>Missing authorization code.</p>');
        finish(new Error('GitHub OAuth callback missing code or state.'));
        return;
      }

      if (state !== expectedState) {
        writeHtml(response, 400, 'Invalid Callback', '<p>State mismatch.</p>');
        finish(new Error('GitHub OAuth callback state mismatch.'));
        return;
      }

      writeHtml(
        response,
        200,
        'Authorization Complete',
        '<p>GitHub authorization succeeded. You can close this window and return to Spirit Agent.</p>',
      );
      finish(undefined, { code, state });
    };

    server = createServer(handleRequest);
    server.on('error', (error) => finish(error instanceof Error ? error : new Error(String(error))));
    server.listen(GITHUB_OAUTH_LOOPBACK_PORT, '127.0.0.1');
  });
}
