import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  HookConfigError,
  emptyHooksConfigFile,
  mergeHooksConfigFiles,
  parseHooksConfigFile,
  resolveHookCommandPath,
  resolveMergedHookDefinitions,
} from '@spirit-agent/core';

test('parseHooksConfigFile accepts valid config', () => {
  const parsed = parseHooksConfigFile({
    version: 1,
    hooks: {
      preToolUse: [{ command: 'hooks/guard.sh', timeout: 10 }],
    },
  });
  assert.equal(parsed.hooks.preToolUse?.[0]?.command, 'hooks/guard.sh');
  assert.equal(parsed.hooks.preToolUse?.[0]?.timeout, 10);
});

test('parseHooksConfigFile rejects unknown events', () => {
  assert.throws(
    () =>
      parseHooksConfigFile({
        version: 1,
        hooks: { unknownEvent: [{ command: 'x.sh' }] },
      }),
    HookConfigError,
  );
});

test('mergeHooksConfigFiles concatenates user then workspace', () => {
  const user = emptyHooksConfigFile();
  user.hooks.preToolUse = [{ command: 'user.sh' }];
  const workspace = emptyHooksConfigFile();
  workspace.hooks.preToolUse = [{ command: 'workspace.sh' }];

  const merged = mergeHooksConfigFiles(user, workspace);
  assert.deepEqual(
    merged.hooks.preToolUse?.map((entry) => entry.command),
    ['user.sh', 'workspace.sh'],
  );
});

test('resolveMergedHookDefinitions applies matcher to tool names', () => {
  const user = emptyHooksConfigFile();
  user.hooks.preToolUse = [
    { command: 'all.sh' },
    { command: 'shell.sh', matcher: '^shell$' },
  ];

  const all = resolveMergedHookDefinitions(user, emptyHooksConfigFile(), 'preToolUse', '/data');
  assert.equal(all.length, 2);

  const shellOnly = resolveMergedHookDefinitions(
    user,
    emptyHooksConfigFile(),
    'preToolUse',
    '/data',
    undefined,
    'shell',
  );
  assert.deepEqual(
    shellOnly.map((entry: { command: string }) => entry.command),
    ['all.sh', 'shell.sh'],
  );

  const readOnly = resolveMergedHookDefinitions(
    user,
    emptyHooksConfigFile(),
    'preToolUse',
    '/data',
    undefined,
    'read_file',
  );
  assert.deepEqual(readOnly.map((entry: { command: string }) => entry.command), ['all.sh']);
});

test('resolveHookCommandPath rejects commands that escape config directory', () => {
  assert.throws(
    () =>
      resolveHookCommandPath({
        command: '../outside.sh',
        scope: 'user',
        configDir: '/data/spirit',
      }),
    HookConfigError,
  );
});

test('resolveHookCommandPath rejects symlink escape', () => {
  const configDir = mkdtempSync(join(tmpdir(), 'spirit-hook-symlink-config-'));
  const outsideDir = mkdtempSync(join(tmpdir(), 'spirit-hook-symlink-outside-'));
  const outsideScript = join(outsideDir, 'evil.sh');
  writeFileSync(outsideScript, '#!/bin/sh\necho evil\n');
  symlinkSync(outsideScript, join(configDir, 'evil.sh'));

  assert.throws(
    () =>
      resolveHookCommandPath({
        command: 'evil.sh',
        scope: 'user',
        configDir,
      }),
    /symlink/i,
  );
});
