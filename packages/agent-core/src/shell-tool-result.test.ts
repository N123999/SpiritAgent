import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRunShellCommandToolResult,
  combineShellToolOutput,
  parseRunShellCommandToolResult,
  serializeRunShellCommandToolResult,
} from './shell-tool-result.js';

test('combineShellToolOutput merges stdout and stderr with a newline when needed', () => {
  assert.equal(combineShellToolOutput('a\n', 'b'), 'a\nb');
  assert.equal(combineShellToolOutput('', 'err'), 'err');
  assert.equal(combineShellToolOutput('out', ''), 'out');
  assert.equal(combineShellToolOutput('', ''), '');
});

test('serializeRunShellCommandToolResult returns compact JSON for LLM context', () => {
  const json = serializeRunShellCommandToolResult(
    buildRunShellCommandToolResult({
      terminal: 'Command Prompt (cmd.exe)',
      workspace: 'D:\\SpiritAgent',
      command: 'echo hello',
      exitCode: 0,
      stdout: 'hello\n',
      stderr: '',
    }),
  );

  assert.equal(json.includes('\n'), false);
  assert.deepEqual(JSON.parse(json), {
    terminal: 'Command Prompt (cmd.exe)',
    workspace: 'D:\\SpiritAgent',
    command: 'echo hello',
    exitCode: 0,
    output: 'hello\n',
  });
});

test('serializeRunShellCommandToolResult preserves full output without truncation', () => {
  const longOutput = 'x'.repeat(20);
  const json = serializeRunShellCommandToolResult(
    buildRunShellCommandToolResult({
      terminal: 'bash',
      workspace: '/tmp',
      command: 'cat',
      exitCode: 0,
      stdout: longOutput,
      stderr: '',
    }),
  );

  const parsed = JSON.parse(json) as {
    output: string;
    truncated?: boolean;
  };
  assert.equal(parsed.output, longOutput);
  assert.equal(parsed.truncated, undefined);
});

test('parseRunShellCommandToolResult rejects legacy human transcript', () => {
  assert.equal(
    parseRunShellCommandToolResult('终端      bash\n工作目录  /tmp\n'),
    null,
  );
});

test('parseRunShellCommandToolResult round-trips serialized JSON', () => {
  const result = buildRunShellCommandToolResult({
    terminal: 'zsh',
    workspace: '/workspace',
    command: 'false',
    exitCode: 1,
    stdout: '',
    stderr: 'command failed\n',
  });
  const parsed = parseRunShellCommandToolResult(serializeRunShellCommandToolResult(result));
  assert.deepEqual(parsed, result);
});
