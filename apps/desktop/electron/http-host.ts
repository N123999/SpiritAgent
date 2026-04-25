import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

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

export interface DesktopHttpHostOptions {
  host: string;
  port: number;
  invokeHostCommand: DesktopHostCommandInvoker;
  onHostCommandResult?: DesktopHostCommandResultHandler;
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
}: {
  invokeHostCommand: DesktopHostCommandInvoker;
  onHostCommandResult?: DesktopHostCommandResultHandler;
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
        writeJson(response, 400, { error: '缺少请求路径' });
        return;
      }

      if (request.method === 'OPTIONS') {
        writeCors(response);
        response.writeHead(204);
        response.end();
        return;
      }

      const { pathname } = new URL(request.url, 'http://localhost');
      const body = request.method === 'GET' ? undefined : await readJsonBody(request);
      const jsonBody = isJsonObject(body) ? body : undefined;

      if (request.method === 'GET' && pathname === '/api/health') {
        writeJson(response, 200, { ok: true });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/sessions') {
        writeJson(response, 200, await runHostCommand('listSessions'));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/bootstrap') {
        writeJson(response, 200, await runHostCommand('bootstrap', { request: jsonBody ?? {} }));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/config') {
        writeJson(response, 200, await runHostCommand('updateConfig', { request: jsonBody }));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/models') {
        writeJson(response, 200, await runHostCommand('addModel', { request: jsonBody }));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/models/remove') {
        const name = typeof jsonBody?.name === 'string' ? jsonBody.name : '';
        writeJson(response, 200, await runHostCommand('removeModel', { request: { name } }));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/skills') {
        const rootKind = parseSkillRootKind(jsonBody?.rootKind);
        writeJson(
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
          response,
          200,
          await runHostCommand('deleteSkill', { request: { name, rootKind } }),
        );
        return;
      }

      if (request.method === 'POST' && pathname === '/api/submit') {
        writeJson(
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
        writeJson(response, 200, await runHostCommand('poll'));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/approval') {
        writeJson(
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
          response,
          200,
          await runHostCommand('replyPendingQuestions', { result: jsonBody?.result }),
        );
        return;
      }

      if (request.method === 'POST' && pathname === '/api/reset') {
        writeJson(response, 200, await runHostCommand('resetSession'));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/sessions/open') {
        writeJson(
          response,
          200,
          await runHostCommand('openSession', {
            path: typeof jsonBody?.path === 'string' ? jsonBody.path : '',
          }),
        );
        return;
      }

      writeJson(response, 404, { error: `Unknown route: ${request.method} ${pathname}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(response, 500, { error: message });
    }
  };
}

export function resolveDesktopWebHostFromEnv(): { host: string; port: number } {
  const host = process.env.SPIRIT_WEB_HOST?.trim() || DEFAULT_DESKTOP_WEB_HOST;
  const parsedPort = Number.parseInt(process.env.SPIRIT_WEB_PORT ?? '', 10);
  const port = Number.isFinite(parsedPort) ? parsedPort : DEFAULT_DESKTOP_WEB_PORT;
  return { host, port };
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

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  writeCors(response);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function writeCors(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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
