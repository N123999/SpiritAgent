import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import path from 'node:path';

import type { HostCommandName } from '../src/host/contracts.js';

export const DEFAULT_DESKTOP_WEB_HOST = '127.0.0.1';
export const DEFAULT_DESKTOP_WEB_PORT = 7788;

export type DesktopHostCommandInvoker = (
  command: HostCommandName,
  payload?: unknown,
) => Promise<unknown>;

export type DesktopHostCommandResultHandler = (
  command: HostCommandName,
  payload: unknown,
  result: unknown,
) => void | Promise<void>;

export interface DesktopHttpHostState {
  host: string;
  port: number;
  running: boolean;
  url?: string;
  error?: string;
}

export interface DesktopHttpAuthOptions {
  getTokenHash(): string | undefined;
  getPairingCode(): string;
  completePairing(authTokenHash: string): Promise<void>;
}

export interface DesktopHttpStaticOptions {
  root: string;
  spaFallback?: boolean;
}

export interface DesktopHttpHostOptions {
  host: string;
  port: number;
  invokeHostCommand: DesktopHostCommandInvoker;
  onHostCommandResult?: DesktopHostCommandResultHandler;
  auth?: DesktopHttpAuthOptions;
  static?: DesktopHttpStaticOptions;
  logger?: Pick<Console, 'error' | 'log'>;
}

export interface DesktopHttpHost {
  getState(): DesktopHttpHostState;
  isRunning(): boolean;
  start(): Promise<DesktopHttpHostState>;
  stop(): Promise<DesktopHttpHostState>;
}

export function createDesktopHttpHost(options: DesktopHttpHostOptions): DesktopHttpHost {
  const logger = options.logger ?? console;
  let server: Server | undefined;
  let state: DesktopHttpHostState = {
    host: options.host,
    port: options.port,
    running: false,
  };

  return {
    getState() {
      return { ...state };
    },
    isRunning() {
      return server?.listening === true;
    },
    async start() {
      if (server?.listening) {
        return { ...state };
      }

      const nextServer = createServer(
        createDesktopHttpRequestHandler({
          invokeHostCommand: options.invokeHostCommand,
          onHostCommandResult: options.onHostCommandResult,
          auth: options.auth,
          static: options.static,
        }),
      );
      server = nextServer;

      try {
        await new Promise<void>((resolve, reject) => {
          const handleError = (error: Error) => {
            nextServer.off('listening', handleListening);
            reject(error);
          };
          const handleListening = () => {
            nextServer.off('error', handleError);
            resolve();
          };

          nextServer.once('error', handleError);
          nextServer.once('listening', handleListening);
          nextServer.listen(options.port, options.host);
        });

        state = {
          host: options.host,
          port: options.port,
          running: true,
          url: `http://${options.host}:${options.port}`,
        };
        logger.log(`Spirit desktop web host listening on ${state.url}`);
        return { ...state };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state = {
          host: options.host,
          port: options.port,
          running: false,
          error: message,
        };
        server = undefined;
        throw error;
      }
    },
    async stop() {
      const current = server;
      if (!current) {
        state = { ...state, running: false };
        return { ...state };
      }

      await new Promise<void>((resolve, reject) => {
        current.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      server = undefined;
      state = {
        host: options.host,
        port: options.port,
        running: false,
      };
      return { ...state };
    },
  };
}

export function createDesktopHttpRequestHandler({
  invokeHostCommand,
  onHostCommandResult,
  auth,
  static: staticOptions,
}: {
  invokeHostCommand: DesktopHostCommandInvoker;
  onHostCommandResult?: DesktopHostCommandResultHandler;
  auth?: DesktopHttpAuthOptions;
  static?: DesktopHttpStaticOptions;
}) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    const runHostCommand = async (command: HostCommandName, payload?: unknown) => {
      const result = await invokeHostCommand(command, payload);
      if (onHostCommandResult) {
        response.once('finish', () => {
          void onHostCommandResult(command, payload, result);
        });
      }
      return result;
    };

    try {
      if (!request.url) {
        writeJson(request, response, 400, { error: '缺少请求路径' });
        return;
      }

      const { pathname } = new URL(request.url, 'http://localhost');

      if (request.method === 'OPTIONS') {
        if (!writeCors(request, response)) {
          writeJson(request, response, 403, { error: 'CORS origin is not allowed.' });
          return;
        }
        response.writeHead(204);
        response.end();
        return;
      }

      if (pathname.startsWith('/api/')) {
        await handleApiRequest({
          request,
          response,
          pathname,
          runHostCommand,
          auth,
        });
        return;
      }

      if (staticOptions) {
        await serveStaticRequest(request, response, pathname, staticOptions);
        return;
      }

      writeJson(request, response, 404, { error: `Unknown route: ${request.method} ${pathname}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(request, response, 500, { error: message });
    }
  };
}

export function resolveDesktopWebHostFromEnv(): { host: string; port: number } {
  const host = process.env.SPIRIT_WEB_HOST?.trim() || DEFAULT_DESKTOP_WEB_HOST;
  const parsedPort = Number.parseInt(process.env.SPIRIT_WEB_PORT ?? '', 10);
  const port = Number.isFinite(parsedPort) ? parsedPort : DEFAULT_DESKTOP_WEB_PORT;
  return { host, port };
}

export function createDesktopWebPairingCode(): string {
  return String(randomInt(100000, 1000000));
}

export function createDesktopWebAuthToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashDesktopWebAuthToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

async function handleApiRequest({
  request,
  response,
  pathname,
  runHostCommand,
  auth,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  runHostCommand: (command: HostCommandName, payload?: unknown) => Promise<unknown>;
  auth?: DesktopHttpAuthOptions;
}): Promise<void> {
  if (request.method === 'GET' && pathname === '/api/pairing/status') {
    writeJson(request, response, 200, {
      authMode: 'pairing',
      paired: Boolean(auth?.getTokenHash()),
    });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/pairing') {
    if (!auth) {
      writeJson(request, response, 404, { error: `Unknown route: ${request.method} ${pathname}` });
      return;
    }

    const body = await readJsonBody(request);
    const jsonBody = isJsonObject(body) ? body : undefined;
    const code = typeof jsonBody?.code === 'string' ? jsonBody.code.trim() : '';
    if (!code || code !== auth.getPairingCode()) {
      writeJson(request, response, 401, {
        code: 'PAIRING_FAILED',
        error: '配对码不正确。',
      });
      return;
    }

    const token = createDesktopWebAuthToken();
    await auth.completePairing(hashDesktopWebAuthToken(token));
    writeJson(request, response, 200, { token });
    return;
  }

  if (auth && !isAuthorizedRequest(request, auth.getTokenHash())) {
    writeJson(request, response, 401, {
      code: 'PAIRING_REQUIRED',
      error: '需要完成首次配对。',
    });
    return;
  }

  const body = request.method === 'GET' ? undefined : await readJsonBody(request);
  const jsonBody = isJsonObject(body) ? body : undefined;

  if (request.method === 'GET' && pathname === '/api/health') {
    writeJson(request, response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/sessions') {
    writeJson(request, response, 200, await runHostCommand('listSessions'));
    return;
  }

  if (request.method === 'POST' && pathname === '/api/bootstrap') {
    writeJson(request, response, 200, await runHostCommand('bootstrap', { request: jsonBody ?? {} }));
    return;
  }

  if (request.method === 'POST' && pathname === '/api/config') {
    writeJson(request, response, 200, await runHostCommand('updateConfig', { request: jsonBody }));
    return;
  }

  if (request.method === 'POST' && pathname === '/api/models') {
    writeJson(request, response, 200, await runHostCommand('addModel', { request: jsonBody }));
    return;
  }

  if (request.method === 'POST' && pathname === '/api/models/remove') {
    const name = typeof jsonBody?.name === 'string' ? jsonBody.name : '';
    writeJson(request, response, 200, await runHostCommand('removeModel', { request: { name } }));
    return;
  }

  if (request.method === 'POST' && pathname === '/api/mcps') {
    writeJson(
      request,
      response,
      200,
      await runHostCommand('addMcpServer', {
        request: {
          name: typeof jsonBody?.name === 'string' ? jsonBody.name : '',
          transportType: jsonBody?.transportType === 'http' ? 'http' : 'stdio',
          endpoint: typeof jsonBody?.endpoint === 'string' ? jsonBody.endpoint : '',
          metadata: typeof jsonBody?.metadata === 'string' ? jsonBody.metadata : '',
          capabilities:
            typeof jsonBody?.capabilities === 'object' && jsonBody?.capabilities !== null
              ? jsonBody.capabilities
              : undefined,
        },
      }),
    );
    return;
  }

  if (request.method === 'POST' && pathname === '/api/mcps/remove') {
    writeJson(
      request,
      response,
      200,
      await runHostCommand('deleteMcpServer', {
        request: {
          name: typeof jsonBody?.name === 'string' ? jsonBody.name : '',
        },
      }),
    );
    return;
  }

  if (request.method === 'POST' && pathname === '/api/mcps/inspect') {
    writeJson(
      request,
      response,
      200,
      await runHostCommand('inspectMcpServer', {
        name: typeof jsonBody?.name === 'string' ? jsonBody.name : '',
      }),
    );
    return;
  }

  if (request.method === 'POST' && pathname === '/api/skills') {
    const rootKind = parseSkillRootKind(jsonBody?.rootKind);
    writeJson(
      request,
      response,
      200,
      await runHostCommand('createSkill', {
        request: {
          name: typeof jsonBody?.name === 'string' ? jsonBody.name : '',
          rootKind,
          description:
            typeof jsonBody?.description === 'string' ? jsonBody.description : '',
        },
      }),
    );
    return;
  }

  if (request.method === 'POST' && pathname === '/api/skills/remove') {
    const name = typeof jsonBody?.name === 'string' ? jsonBody.name : '';
    const rootKind = parseSkillRootKind(jsonBody?.rootKind);
    writeJson(
      request,
      response,
      200,
      await runHostCommand('deleteSkill', { request: { name, rootKind } }),
    );
    return;
  }

  if (request.method === 'POST' && pathname === '/api/skills/create-slash') {
    writeJson(
      request,
      response,
      200,
      await runHostCommand('submitCreateSkillSlash', {
        request: {
          rawText: typeof jsonBody?.rawText === 'string' ? jsonBody.rawText : '',
        },
      }),
    );
    return;
  }

  if (request.method === 'POST' && pathname === '/api/skills/submit') {
    writeJson(
      request,
      response,
      200,
      await runHostCommand('submitSkillSlash', {
        request: {
          skillName: typeof jsonBody?.skillName === 'string' ? jsonBody.skillName : '',
          rawText: typeof jsonBody?.rawText === 'string' ? jsonBody.rawText : '',
          extraNote: typeof jsonBody?.extraNote === 'string' ? jsonBody.extraNote : '',
        },
      }),
    );
    return;
  }

  if (request.method === 'POST' && pathname === '/api/submit') {
    writeJson(
      request,
      response,
      200,
      await runHostCommand('submitUserTurn', {
        text: typeof jsonBody?.text === 'string' ? jsonBody.text : '',
      }),
    );
    return;
  }

  if (request.method === 'POST' && pathname === '/api/rewind-submit') {
    writeJson(
      request,
      response,
      200,
      await runHostCommand('rewindAndSubmitMessage', {
        request: {
          messageId: typeof jsonBody?.messageId === 'number' ? jsonBody.messageId : NaN,
          text: typeof jsonBody?.text === 'string' ? jsonBody.text : '',
        },
      }),
    );
    return;
  }

  if (request.method === 'POST' && pathname === '/api/poll') {
    writeJson(request, response, 200, await runHostCommand('poll'));
    return;
  }

  if (request.method === 'POST' && pathname === '/api/approval') {
    writeJson(
      request,
      response,
      200,
      await runHostCommand('replyPendingApproval', {
        message: typeof jsonBody?.message === 'string' ? jsonBody.message : '',
      }),
    );
    return;
  }

  if (request.method === 'POST' && pathname === '/api/questions') {
    writeJson(
      request,
      response,
      200,
      await runHostCommand('replyPendingQuestions', { result: jsonBody?.result }),
    );
    return;
  }

  if (request.method === 'POST' && pathname === '/api/reset') {
    writeJson(request, response, 200, await runHostCommand('resetSession'));
    return;
  }

  if (request.method === 'POST' && pathname === '/api/sessions/open') {
    writeJson(
      request,
      response,
      200,
      await runHostCommand('openSession', {
        path: typeof jsonBody?.path === 'string' ? jsonBody.path : '',
      }),
    );
    return;
  }

  writeJson(request, response, 404, { error: `Unknown route: ${request.method} ${pathname}` });
}

async function serveStaticRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  options: DesktopHttpStaticOptions,
): Promise<void> {
  const root = path.resolve(options.root);
  const decodedPath = decodeURIComponent(pathname);
  const requestedRelativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const requestedPath = path.resolve(root, requestedRelativePath);

  if (!isPathUnderRoot(root, requestedPath)) {
    writeJson(request, response, 403, { error: 'Forbidden path.' });
    return;
  }

  if (await writeFileIfExists(response, requestedPath)) {
    return;
  }

  if (options.spaFallback !== false) {
    const indexPath = path.join(root, 'index.html');
    if (await writeFileIfExists(response, indexPath)) {
      return;
    }
  }

  writeJson(request, response, 404, { error: `Unknown route: ${request.method} ${pathname}` });
}

async function writeFileIfExists(response: ServerResponse, filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return false;
    }
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentTypeForPath(filePath),
    });
    response.end(body);
    return true;
  } catch {
    return false;
  }
}

function isPathUnderRoot(root: string, filePath: string): boolean {
  const relative = path.relative(root, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isAuthorizedRequest(request: IncomingMessage, tokenHash: string | undefined): boolean {
  if (!tokenHash) {
    return false;
  }
  const token = authorizationBearerToken(request);
  if (!token) {
    return false;
  }
  return safeTokenHashEquals(hashDesktopWebAuthToken(token), tokenHash);
}

function authorizationBearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  if (!header) {
    return undefined;
  }
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(.+)$/iu.exec(value.trim());
  return match?.[1]?.trim() || undefined;
}

function safeTokenHashEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) {
    return undefined;
  }

  return JSON.parse(text) as unknown;
}

function writeJson(
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  writeCors(request, response);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function writeCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }

  const host = request.headers.host;
  if (!host) {
    return false;
  }

  const requestOrigin = `http://${host}`;
  if (origin !== requestOrigin) {
    return false;
  }

  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  return true;
}

function contentTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.ico':
      return 'image/x-icon';
    case '.svg':
      return 'image/svg+xml';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSkillRootKind(value: unknown): 'user' | 'workspaceSpirit' | 'workspaceAgents' {
  if (value === 'workspaceSpirit' || value === 'workspaceAgents') {
    return value;
  }
  return 'user';
}
