import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app } from 'electron';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface WinComputerUseHelperResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  supported_patterns?: string[];
}

type PendingRequest = {
  resolve: (value: WinComputerUseHelperResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

let helperProcess: ChildProcessWithoutNullStreams | undefined;
let stdoutBuffer = '';
const pendingRequests: PendingRequest[] = [];
let requestChain: Promise<void> = Promise.resolve();

function resolveDesktopPackageRoot(): string {
  // Compiled to dist-electron/electron/*.js — native/ lives beside dist-electron/.
  const electronDir = fileURLToPath(new URL('.', import.meta.url));
  return path.resolve(electronDir, '../..');
}

function resolveHelperExecutablePath(): string {
  const desktopRoot = resolveDesktopPackageRoot();
  const candidates = [
    path.join(
      desktopRoot,
      'native/win-uia-helper/bin/Release/net8.0-windows/spirit-win-uia.exe',
    ),
    path.join(process.resourcesPath, 'native/win-uia-helper/spirit-win-uia.exe'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `spirit-win-uia.exe not found. Run npm run build:win-uia-helper (checked ${candidates.join('; ')}).`,
  );
}

function ensureHelperProcess(): ChildProcessWithoutNullStreams {
  if (helperProcess && !helperProcess.killed) {
    return helperProcess;
  }

  const executablePath = resolveHelperExecutablePath();
  helperProcess = spawn(executablePath, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  helperProcess.stdout.setEncoding('utf8');
  helperProcess.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk;
    let newlineIndex = stdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        const pending = pendingRequests.shift();
        if (!pending) {
          console.error('[spirit-desktop] win-computer-use unexpected helper response:', line);
        } else {
          clearTimeout(pending.timer);
          try {
            pending.resolve(JSON.parse(line) as WinComputerUseHelperResponse);
          } catch (error) {
            pending.reject(
              error instanceof Error ? error : new Error('Failed to parse helper response JSON.'),
            );
          }
        }
      }
      newlineIndex = stdoutBuffer.indexOf('\n');
    }
  });

  helperProcess.stderr.setEncoding('utf8');
  helperProcess.stderr.on('data', (chunk: string) => {
    console.error('[spirit-desktop] win-computer-use helper stderr:', chunk);
  });

  helperProcess.on('exit', (code, signal) => {
    helperProcess = undefined;
    while (pendingRequests.length > 0) {
      const pending = pendingRequests.shift();
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error(`spirit-win-uia exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`),
        );
      }
    }
  });

  return helperProcess;
}

function sendHelperRequest(
  payload: Record<string, unknown>,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<WinComputerUseHelperResponse> {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('Computer Use is only available on Windows Electron host.'));
  }

  const run = async (): Promise<WinComputerUseHelperResponse> => {
    const child = ensureHelperProcess();
    return await new Promise<WinComputerUseHelperResponse>((resolve, reject) => {
      const pending: PendingRequest = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = pendingRequests.indexOf(pending);
          if (index >= 0) {
            pendingRequests.splice(index, 1);
          }
          reject(new Error(`spirit-win-uia request timed out after ${timeoutMs}ms.`));
        }, timeoutMs),
      };

      pendingRequests.push(pending);
      child.stdin.write(`${JSON.stringify(payload)}\n`, 'utf8');
    });
  };

  const chained = requestChain.then(run, run);
  requestChain = chained.then(
    () => undefined,
    () => undefined,
  );
  return chained;
}

export async function pingWinComputerUseHelper(): Promise<WinComputerUseHelperResponse<{ pong: boolean }>> {
  return (await sendHelperRequest({ cmd: 'ping' }, 5_000)) as WinComputerUseHelperResponse<{ pong: boolean }>;
}

export async function listWindowsViaComputerUse(): Promise<WinComputerUseHelperResponse<{ windows: unknown[] }>> {
  return (await sendHelperRequest({ cmd: 'list_windows' })) as WinComputerUseHelperResponse<{ windows: unknown[] }>;
}

export async function snapshotWindowsUi(input: {
  process_name?: string;
  window_title?: string;
  surface?: string;
  max_depth?: number;
  max_nodes?: number;
}): Promise<WinComputerUseHelperResponse> {
  return await sendHelperRequest({
    cmd: 'snapshot',
    ...input,
  });
}

export async function actOnWindowsUi(input: {
  ref: string;
  action: string;
  text?: string;
  invoke_timeout_ms?: number;
}): Promise<WinComputerUseHelperResponse> {
  const timeoutMs = Math.max(
    DEFAULT_REQUEST_TIMEOUT_MS,
    (input.invoke_timeout_ms ?? DEFAULT_REQUEST_TIMEOUT_MS) + 2_000,
  );
  return await sendHelperRequest(
    {
      cmd: 'action',
      ...input,
    },
    timeoutMs,
  );
}

export async function shutdownWinComputerUseHelper(): Promise<void> {
  if (!helperProcess || helperProcess.killed) {
    return;
  }

  try {
    await sendHelperRequest({ cmd: 'shutdown' }, 5_000);
  } catch {
    // Best-effort shutdown during app exit.
  } finally {
    helperProcess?.kill();
    helperProcess = undefined;
  }
}

app.on('will-quit', () => {
  void shutdownWinComputerUseHelper();
});
