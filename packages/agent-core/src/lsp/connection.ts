import { spawn, type SpawnOptions } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { isWindowsPlatform } from '../mcp/windows.js';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from 'vscode-jsonrpc/node.js';
import type { InitializeParams, InitializeResult } from 'vscode-languageserver-protocol';

/** Windows 上 .cmd/.bat 须 shell:true，否则 spawn 会同步抛出 EINVAL。 */
export function buildLanguageServerSpawnOptions(
  command: string,
  cwd: string,
): SpawnOptions {
  const options: SpawnOptions = {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  };
  if (isWindowsPlatform() && /\.(?:cmd|bat)$/i.test(command)) {
    return { ...options, shell: true };
  }
  return options;
}

export interface LspConnectionOptions {
  command: string;
  args: string[];
  cwd: string;
  workspaceRoot: string;
  onDiagnostics: (uri: string, diagnostics: import('./types.js').LspDiagnostic[]) => void;
}

export class LspConnection {
  private processStore: ReturnType<typeof spawn> | undefined;
  private connectionStore: MessageConnection | undefined;
  private startPromise: Promise<void> | undefined;

  async start(options: LspConnectionOptions): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.startInternal(options);
    return this.startPromise;
  }

  get connection(): MessageConnection | undefined {
    return this.connectionStore;
  }

  async shutdown(): Promise<void> {
    const connection = this.connectionStore;
    const child = this.processStore;
    this.connectionStore = undefined;
    this.processStore = undefined;
    this.startPromise = undefined;

    if (connection) {
      try {
        await connection.sendRequest('shutdown');
        connection.sendNotification('exit');
      } catch {
        // best effort
      }
      connection.dispose();
    }

    if (child && child.exitCode === null) {
      child.kill();
    }
  }

  private async startInternal(options: LspConnectionOptions): Promise<void> {
    const spawnOptions = buildLanguageServerSpawnOptions(options.command, options.cwd);
    const child = spawn(options.command, options.args, spawnOptions);
    this.processStore = child;

    child.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text.length > 0) {
        console.error(`[lsp] ${text}`);
      }
    });

    if (!child.stdout || !child.stdin) {
      throw new Error('Language server child process is missing stdio pipes');
    }
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    this.connectionStore = connection;

    connection.onNotification('textDocument/publishDiagnostics', (params) => {
      if (!params || typeof params !== 'object') {
        return;
      }
      const uri = typeof params.uri === 'string' ? params.uri : '';
      const diagnostics = Array.isArray(params.diagnostics) ? params.diagnostics : [];
      options.onDiagnostics(uri, diagnostics as import('./types.js').LspDiagnostic[]);
    });

    connection.listen();

    const rootUri = pathToFileURL(path.resolve(options.workspaceRoot)).href;
    const initializeParams: InitializeParams = {
      processId: process.pid,
      rootUri,
      capabilities: {
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            didSave: true,
            willSave: false,
            willSaveWaitUntil: false,
          },
        },
        workspace: {
          workspaceFolders: true,
        },
      },
      workspaceFolders: [
        {
          uri: rootUri,
          name: path.basename(options.workspaceRoot),
        },
      ],
    };

    const result = await connection.sendRequest<InitializeResult>('initialize', initializeParams);
    if (!result) {
      throw new Error('Language server initialize returned empty result');
    }
    connection.sendNotification('initialized');
  }
}
