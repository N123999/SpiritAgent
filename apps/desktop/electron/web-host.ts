import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { invokeDesktopHostCommand } from '../src/host/service.js';

const HOST = process.env.SPIRIT_WEB_HOST?.trim() || '127.0.0.1';
const PORT = Number(process.env.SPIRIT_WEB_PORT ?? '7788');

const server = createServer(async (request, response) => {
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

    const body = request.method === 'GET' ? undefined : await readJsonBody(request);
    const jsonBody = isJsonObject(body) ? body : undefined;

    if (request.method === 'GET' && request.url === '/api/health') {
      writeJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'GET' && request.url === '/api/sessions') {
      writeJson(response, 200, await invokeDesktopHostCommand('listSessions'));
      return;
    }

    if (request.method === 'POST' && request.url === '/api/bootstrap') {
      writeJson(response, 200, await invokeDesktopHostCommand('bootstrap', { request: jsonBody ?? {} }));
      return;
    }

    if (request.method === 'POST' && request.url === '/api/config') {
      writeJson(response, 200, await invokeDesktopHostCommand('updateConfig', { request: jsonBody }));
      return;
    }

    if (request.method === 'POST' && request.url === '/api/submit') {
      writeJson(response, 200, await invokeDesktopHostCommand('submitUserTurn', { text: typeof jsonBody?.text === 'string' ? jsonBody.text : '' }));
      return;
    }

    if (request.method === 'POST' && request.url === '/api/poll') {
      writeJson(response, 200, await invokeDesktopHostCommand('poll'));
      return;
    }

    if (request.method === 'POST' && request.url === '/api/approval') {
      writeJson(response, 200, await invokeDesktopHostCommand('replyPendingApproval', { message: typeof jsonBody?.message === 'string' ? jsonBody.message : '' }));
      return;
    }

    if (request.method === 'POST' && request.url === '/api/questions') {
      writeJson(response, 200, await invokeDesktopHostCommand('replyPendingQuestions', { result: jsonBody?.result }));
      return;
    }

    if (request.method === 'POST' && request.url === '/api/reset') {
      writeJson(response, 200, await invokeDesktopHostCommand('resetSession'));
      return;
    }

    if (request.method === 'POST' && request.url === '/api/sessions/open') {
      writeJson(response, 200, await invokeDesktopHostCommand('openSession', { path: typeof jsonBody?.path === 'string' ? jsonBody.path : '' }));
      return;
    }

    writeJson(response, 404, { error: `Unknown route: ${request.method} ${request.url}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJson(response, 500, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Spirit desktop web host listening on http://${HOST}:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
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