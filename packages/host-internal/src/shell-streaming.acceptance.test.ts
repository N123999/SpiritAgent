import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { NodeHostToolService } from './tools.js';

test('NodeHostToolService streams incremental shell output via attachRequestMetadata', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-shell-accept-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');
  const chunks: string[] = [];
  const startMs = Date.now();
  const chunkTimes: number[] = [];

  try {
    await import('node:fs/promises').then((fs) => fs.mkdir(spiritDataDir, { recursive: true }));

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { getApprovalLevel: () => 'full-approval' },
    );

    assert.equal(
      service.shouldExecuteInBackground?.({
        name: 'run_shell_command',
        command: 'printf "a\\n"; sleep 0.15; printf "b\\n"',
        reason: 'acceptance',
      }),
      true,
    );

    const request = {
      name: 'run_shell_command' as const,
      command: 'printf "a\\n"; sleep 0.15; printf "b\\n"',
      reason: 'acceptance',
    };
    service.attachRequestMetadata?.(request, {
      onOutputChunk: (chunk) => {
        chunks.push(chunk);
        chunkTimes.push(Date.now() - startMs);
      },
    });

    const output = await service.execute(request);
    assert.equal(typeof output, 'string');
    assert.ok(chunks.join('').includes('a'));
    assert.ok(chunks.join('').includes('b'));
    assert.ok(chunkTimes.length >= 1);
    if (chunkTimes.length >= 2) {
      assert.ok(chunkTimes[1]! >= chunkTimes[0]!);
    }
    assert.match(String(output), /"exitCode":0/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('NodeHostToolService.abortRunningShellCommands kills in-flight shell', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-shell-abort-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    await import('node:fs/promises').then((fs) => fs.mkdir(spiritDataDir, { recursive: true }));

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { getApprovalLevel: () => 'full-approval' },
    );

    const request = {
      name: 'run_shell_command' as const,
      command: 'sleep 30',
      reason: 'abort-test',
    };

    const execution = service.execute(request);
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    service.abortRunningShellCommands();
    const output = await execution;
    assert.match(String(output), /"exitCode":-1/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
