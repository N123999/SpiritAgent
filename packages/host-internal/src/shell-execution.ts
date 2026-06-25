import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import {
  decodeShellHostOutput,
  defaultShellForPty,
  isWindowsCmdExecutable,
  isWindowsPowerShellExecutable,
  prepareShellForHostExecution,
} from './default-terminal-shell.js';

const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_CHUNK_THROTTLE_MS = 75;

export interface RunShellOptions {
  workspaceRoot: string;
  command: string;
  onOutputChunk?: (chunk: string) => void;
  chunkThrottleMs?: number;
  maxOutputBytes?: number;
}

export interface RunShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunShellHandle {
  result: Promise<RunShellResult>;
  kill: () => void;
}

function shellSpawnInvocation(shellFile: string, command: string): { file: string; args: string[] } {
  if (isWindowsPowerShellExecutable(shellFile)) {
    return {
      file: shellFile,
      args: ['-NoProfile', '-NonInteractive', '-Command', command],
    };
  }
  if (isWindowsCmdExecutable(shellFile)) {
    return {
      file: shellFile,
      args: ['/d', '/s', '/c', command],
    };
  }
  const base = path.basename(shellFile).toLowerCase();
  if (base === 'fish') {
    return { file: shellFile, args: ['-c', command] };
  }
  return { file: shellFile, args: ['-c', command] };
}

function createChunkThrottle(
  onOutputChunk: (chunk: string) => void,
  intervalMs: number,
): {
  push: (chunk: string) => void;
  flush: () => void;
} {
  let pending = '';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (pending.length === 0) {
      return;
    }
    const chunk = pending;
    pending = '';
    onOutputChunk(chunk);
  };

  const push = (chunk: string): void => {
    if (chunk.length === 0) {
      return;
    }
    pending += chunk;
    if (timer === undefined) {
      timer = setTimeout(flush, intervalMs);
    }
  };

  return { push, flush };
}

function decodeSpawnChunk(shellFile: string, chunk: Buffer): string {
  return decodeShellHostOutput(shellFile, chunk);
}

export function runShell(options: RunShellOptions): RunShellHandle {
  const { file: shellExecutable } = defaultShellForPty();
  const preparedCommand = prepareShellForHostExecution(shellExecutable, options.command);
  const { file, args } = shellSpawnInvocation(shellExecutable, preparedCommand);
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const throttle = options.onOutputChunk
    ? createChunkThrottle(options.onOutputChunk, options.chunkThrottleMs ?? DEFAULT_CHUNK_THROTTLE_MS)
    : undefined;

  let child: ChildProcess | undefined;
  let killedByHost = false;

  const kill = (): void => {
    if (child !== undefined && !child.killed) {
      killedByHost = true;
      child.kill();
    }
  };

  const result = new Promise<RunShellResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let exitCode = 0;

    const appendLimited = (current: string, addition: string): string => {
      if (addition.length === 0 || Buffer.byteLength(current, 'utf8') >= maxOutputBytes) {
        return current;
      }
      let combined = current + addition;
      while (Buffer.byteLength(combined, 'utf8') > maxOutputBytes && combined.length > current.length) {
        combined = combined.slice(0, -1);
      }
      return combined;
    };

    const appendStream = (
      stream: 'stdout' | 'stderr',
      decoded: string,
    ): void => {
      if (decoded.length === 0) {
        return;
      }
      if (stream === 'stdout') {
        stdout = appendLimited(stdout, decoded);
        stdoutBytes = Buffer.byteLength(stdout, 'utf8');
      } else {
        stderr = appendLimited(stderr, decoded);
        stderrBytes = Buffer.byteLength(stderr, 'utf8');
      }
      throttle?.push(decoded);
    };

    child = spawn(file, args, {
      cwd: options.workspaceRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      appendStream('stdout', decodeSpawnChunk(shellExecutable, chunk));
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      appendStream('stderr', decodeSpawnChunk(shellExecutable, chunk));
    });

    child.on('error', () => {
      throttle?.flush();
      resolve({ stdout, stderr, exitCode: -1 });
    });

    child.on('close', (code) => {
      throttle?.flush();
      exitCode = killedByHost ? -1 : typeof code === 'number' ? code : -1;
      resolve({ stdout, stderr, exitCode });
    });
  });

  return { result, kill };
}
