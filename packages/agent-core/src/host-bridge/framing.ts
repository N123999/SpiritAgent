import { Buffer } from 'node:buffer';
import type { ReadStream } from 'node:tty';

import type {
  JsonRpcErrorResponse,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcSuccessResponse,
} from './protocol.js';

type Handler = (params: unknown, method: string) => Promise<unknown> | unknown;

function renderError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export class JsonRpcPeer {
  private readonly input: NodeJS.ReadableStream;
  private readonly output: NodeJS.WritableStream;
  private readonly handlers = new Map<string, Handler>();
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private nextId = 1;
  private buffer = Buffer.alloc(0);

  constructor(input: NodeJS.ReadableStream, output: NodeJS.WritableStream) {
    this.input = input;
    this.output = output;
  }

  start(): void {
    this.input.on('data', (chunk: Buffer | string) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      this.onData(bytes);
    });

    this.input.on('end', () => {
      for (const [id, pending] of this.pending) {
        pending.reject(new Error(`JSON-RPC 连接已关闭，未收到请求 ${id} 的响应。`));
      }
      this.pending.clear();
    });
  }

  on(method: string, handler: Handler): void {
    this.handlers.set(method, handler);
  }

  async call<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;

    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params: params as never } : {}),
    };

    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
    });

    this.writeMessage(payload);
    return promise;
  }

  notify(method: string, params?: unknown): void {
    const payload: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params !== undefined ? { params: params as never } : {}),
    };

    this.writeMessage(payload);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        return;
      }

      const headerText = this.buffer.subarray(0, headerEnd).toString('utf8');
      const contentLength = this.parseContentLength(headerText);
      if (contentLength === undefined) {
        throw new Error(`JSON-RPC framing 缺少 Content-Length: ${headerText}`);
      }

      const totalLength = headerEnd + 4 + contentLength;
      if (this.buffer.length < totalLength) {
        return;
      }

      const body = this.buffer.subarray(headerEnd + 4, totalLength).toString('utf8');
      this.buffer = this.buffer.subarray(totalLength);
      const message = JSON.parse(body) as JsonRpcMessage;
      void this.handleMessage(message);
    }
  }

  private parseContentLength(headerText: string): number | undefined {
    for (const line of headerText.split('\r\n')) {
      const [name, value] = line.split(':', 2);
      if (name?.trim().toLowerCase() !== 'content-length') {
        continue;
      }

      const parsed = Number.parseInt(value?.trim() ?? '', 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }

    return undefined;
  }

  private async handleMessage(message: JsonRpcMessage): Promise<void> {
    if ('method' in message) {
      await this.handleRequest(message);
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);
    if ('error' in message) {
      pending.reject(new Error(message.error.message));
      return;
    }

    pending.resolve(message.result);
  }

  private async handleRequest(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    const handler = this.handlers.get(message.method);
    if (!handler) {
      if ('id' in message) {
        this.writeMessage({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32601,
            message: `未知 JSON-RPC 方法: ${message.method}`,
          },
        } satisfies JsonRpcErrorResponse);
      }
      return;
    }

    try {
      const result = await handler(message.params, message.method);
      if ('id' in message) {
        this.writeMessage({
          jsonrpc: '2.0',
          id: message.id,
          result: (result ?? null) as never,
        } satisfies JsonRpcSuccessResponse);
      }
    } catch (error) {
      if ('id' in message) {
        this.writeMessage({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32000,
            message: renderError(error),
          },
        } satisfies JsonRpcErrorResponse);
      }
    }
  }

  private writeMessage(message: JsonRpcMessage): void {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
    this.output.write(header);
    this.output.write(body);
  }
}