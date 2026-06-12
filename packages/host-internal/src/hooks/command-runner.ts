import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';

import {
  DEFAULT_HOOK_TIMEOUT_SECONDS,
  resolveHookCommandPath,
  type HookCommandOutput,
  type HookExecutionRecord,
  type ResolvedHookDefinition,
} from '@spirit-agent/core';

export interface RunCommandHookOptions {
  definition: ResolvedHookDefinition;
  inputJson: string;
  logger?: (message: string) => void;
}

export interface RunCommandHookResult {
  record: HookExecutionRecord;
  effectiveOutput: HookCommandOutput | null;
  denied: boolean;
}

const DENY_EXIT_CODE = 2;

function parseHookStdout(stdout: string): HookCommandOutput | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as HookCommandOutput;
  } catch {
    return null;
  }
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK | constants.R_OK);
    if (process.platform !== 'win32') {
      await access(filePath, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

export async function runCommandHook(
  options: RunCommandHookOptions,
): Promise<RunCommandHookResult> {
  const { definition, inputJson, logger } = options;
  let commandPath: string;
  try {
    commandPath = resolveHookCommandPath(definition);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Hook command path is invalid.';
    logger?.(message);
    const baseRecord: HookExecutionRecord = {
      definition,
      exitCode: null,
      stdout: null,
      stderr: message,
      timedOut: false,
      failed: true,
    };
    if (definition.failClosed) {
      return {
        record: baseRecord,
        effectiveOutput: { permission: 'deny', userMessage: message },
        denied: true,
      };
    }
    return { record: baseRecord, effectiveOutput: null, denied: false };
  }
  const timeoutSeconds = definition.timeout !== undefined && definition.timeout > 0
    ? definition.timeout
    : DEFAULT_HOOK_TIMEOUT_SECONDS;
  const timeoutMs = timeoutSeconds * 1000;

  const baseRecord: HookExecutionRecord = {
    definition,
    exitCode: null,
    stdout: null,
    stderr: '',
    timedOut: false,
    failed: false,
  };

  if (!(await isExecutable(commandPath))) {
    logger?.(`Hook command not found or not accessible: ${commandPath}`);
    baseRecord.failed = true;
    baseRecord.stderr = `Hook command not found: ${commandPath}`;
    if (definition.failClosed) {
      return {
        record: baseRecord,
        effectiveOutput: { permission: 'deny', userMessage: baseRecord.stderr },
        denied: true,
      };
    }
    return { record: baseRecord, effectiveOutput: null, denied: false };
  }

  return new Promise((resolve) => {
    const child = spawn(commandPath, [], {
      cwd: definition.configDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill('SIGKILL');
      const record: HookExecutionRecord = {
        ...baseRecord,
        exitCode: null,
        stderr: stderr || 'Hook timed out.',
        timedOut: true,
        failed: true,
      };
      if (definition.failClosed) {
        resolve({
          record,
          effectiveOutput: { permission: 'deny', userMessage: 'Hook timed out.' },
          denied: true,
        });
        return;
      }
      resolve({ record, effectiveOutput: null, denied: false });
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const record: HookExecutionRecord = {
        ...baseRecord,
        exitCode: null,
        stderr: error.message,
        failed: true,
      };
      if (definition.failClosed) {
        resolve({
          record,
          effectiveOutput: { permission: 'deny', userMessage: error.message },
          denied: true,
        });
        return;
      }
      resolve({ record, effectiveOutput: null, denied: false });
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      const parsed = parseHookStdout(stdout);
      const invalidJson = stdout.trim().length > 0 && parsed === null;
      const failed = code !== 0 && code !== DENY_EXIT_CODE;
      const deniedByExit = code === DENY_EXIT_CODE;
      const deniedByOutput = parsed?.permission === 'deny';
      const denied = deniedByExit || deniedByOutput;

      const record: HookExecutionRecord = {
        definition,
        exitCode: code,
        stdout: parsed,
        stderr: stderr.trim(),
        timedOut: false,
        failed: failed || invalidJson,
      };

      if (invalidJson && definition.failClosed) {
        resolve({
          record,
          effectiveOutput: { permission: 'deny', userMessage: 'Hook returned invalid JSON.' },
          denied: true,
        });
        return;
      }

      if (failed && definition.failClosed) {
        resolve({
          record,
          effectiveOutput: {
            permission: 'deny',
            userMessage: stderr.trim() || `Hook exited with code ${String(code)}.`,
          },
          denied: true,
        });
        return;
      }

      resolve({
        record,
        effectiveOutput: deniedByExit
          ? { permission: 'deny', ...(parsed ?? {}) }
          : parsed,
        denied,
      });
    });

    child.stdin.write(inputJson);
    child.stdin.end();
  });
}
