import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  isRustAnalyzerVersionOutputHealthy,
  preferWindowsSpawnableCommand,
  resolveClangdOnPath,
  resolveCommandOnPath,
  resolveGoplsOnPath,
  resolvePyrightOnPath,
  resolveRustAnalyzerOnPath,
} from './resolve-server.js';

test('resolvePyrightOnPath uses pyright-langserver --stdio', async () => {
  const result = await resolvePyrightOnPath({ PATH: '' }, 'linux');
  assert.equal(result, undefined);
});

test('resolveGoplsOnPath looks for gopls on PATH', async () => {
  const result = await resolveGoplsOnPath({ PATH: '' }, 'linux');
  assert.equal(result, undefined);
});

test('resolveRustAnalyzerOnPath looks for rust-analyzer on PATH', async () => {
  const result = await resolveRustAnalyzerOnPath({ PATH: '' }, 'linux');
  assert.equal(result, undefined);
});

test('isRustAnalyzerVersionOutputHealthy rejects rustup proxy infinite recursion', () => {
  assert.equal(
    isRustAnalyzerVersionOutputHealthy(
      'info: falling back to "/opt/homebrew/opt/rustup/bin/rust-analyzer"\nerror: infinite recursion detected',
    ),
    false,
  );
  assert.equal(
    isRustAnalyzerVersionOutputHealthy('rust-analyzer 1.96.0 (ac68faa2 2026-05-25)'),
    true,
  );
});

test('resolveClangdOnPath passes --background-index when found', async () => {
  const result = await resolveClangdOnPath({ PATH: '' }, 'linux');
  assert.equal(result, undefined);
});

test('preferWindowsSpawnableCommand prefers .cmd over extensionless npm shim', async () => {
  const binDir = await mkdtemp(path.join(tmpdir(), 'spirit-lsp-bin-'));
  const shim = path.join(binDir, 'typescript-language-server');
  const cmd = `${shim}.cmd`;
  await writeFile(shim, '#!/bin/sh\n');
  await writeFile(cmd, '@echo off\r\n');
  const resolved = await preferWindowsSpawnableCommand(shim, 'win32');
  assert.equal(resolved, cmd);
});

test('resolveCommandOnPath prefers Windows .cmd sibling for extensionless command path', async () => {
  const binDir = await mkdtemp(path.join(tmpdir(), 'spirit-lsp-path-'));
  const shim = path.join(binDir, 'typescript-language-server');
  const cmd = `${shim}.cmd`;
  await writeFile(shim, '#!/bin/sh\n');
  await writeFile(cmd, '@echo off\r\n');
  const result = await resolveCommandOnPath(shim, {}, 'win32', ['--stdio']);
  assert.equal(result?.command, cmd);
  assert.deepEqual(result?.args, ['--stdio']);
});
