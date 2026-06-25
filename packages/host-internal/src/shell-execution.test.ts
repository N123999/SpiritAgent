import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildShellToolResult,
  combineShellToolOutput,
  serializeShellToolResult,
} from '@spirit-agent/core';

import { runShell } from './shell-execution.js';

test('runShell streams stdout chunks and returns combined output', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-shell-exec-'));
  const chunks: string[] = [];

  try {
    const { result: resultPromise } = runShell({
      workspaceRoot,
      command: 'printf "line1\\n"; printf "line2\\n"',
      onOutputChunk: (chunk) => {
        chunks.push(chunk);
      },
      chunkThrottleMs: 10,
    });
    const result = await resultPromise;

    assert.equal(result.exitCode, 0);
    assert.equal(combineShellToolOutput(result.stdout, result.stderr), 'line1\nline2\n');
    assert.ok(chunks.length > 0);
    assert.equal(chunks.join(''), 'line1\nline2\n');

    const serialized = serializeShellToolResult(
      buildShellToolResult({
        terminal: 'test',
        workspace: workspaceRoot,
        command: 'printf',
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      }),
    );
    const parsed = JSON.parse(serialized) as { output: string; exitCode: number };
    assert.equal(parsed.exitCode, 0);
    assert.equal(parsed.output, 'line1\nline2\n');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('runShell reports non-zero exit code', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-shell-exec-fail-'));

  try {
    const { result: resultPromise } = runShell({
      workspaceRoot,
      command: 'exit 7',
    });
    const result = await resultPromise;

    assert.equal(result.exitCode, 7);
    assert.equal(combineShellToolOutput(result.stdout, result.stderr), '');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('runShell merges stderr into streamed chunks', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-shell-exec-err-'));
  const chunks: string[] = [];

  try {
    const { result: resultPromise } = runShell({
      workspaceRoot,
      command: 'printf "out\\n" 1>&2; printf "ok\\n"',
      onOutputChunk: (chunk) => {
        chunks.push(chunk);
      },
      chunkThrottleMs: 10,
    });
    const result = await resultPromise;

    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, 'out\n');
    assert.equal(result.stdout, 'ok\n');
    assert.ok(chunks.join('').includes('out'));
    assert.ok(chunks.join('').includes('ok'));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('runShell kill terminates a long-running child', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-shell-exec-kill-'));

  try {
    const handle = runShell({
      workspaceRoot,
      command: 'sleep 30',
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    handle.kill();
    const result = await handle.result;
    assert.equal(result.exitCode, -1);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
