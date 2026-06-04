import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { discoverAllLspProviders, discoverLspProvider, LSP_PROVIDERS } from './providers.js';

async function writeFakeTypescriptLanguageServer(binDir: string, platform: NodeJS.Platform): Promise<void> {
  if (platform === 'win32') {
    await writeFile(path.join(binDir, 'typescript-language-server.cmd'), '@echo off\r\n');
    return;
  }

  const executable = path.join(binDir, 'typescript-language-server');
  await writeFile(executable, '#!/bin/sh\n');
  await chmod(executable, 0o755);
}

test('LSP_PROVIDERS registers typescript-language-server', () => {
  assert.equal(LSP_PROVIDERS.length, 1);
  assert.equal(LSP_PROVIDERS[0]?.id, 'typescript-language-server');
  assert.equal(LSP_PROVIDERS[0]?.npmPackage, 'typescript-language-server');
});

test('discoverLspProvider returns not_found when PATH has no server', async () => {
  const result = await discoverLspProvider('typescript-language-server', { PATH: '' }, 'linux');
  assert.equal(result.status, 'not_found');
  assert.equal(result.command, undefined);
});

test('discoverLspProvider returns ready when a PATH candidate is executable', async () => {
  const binDir = await mkdtemp(path.join(tmpdir(), 'spirit-lsp-provider-'));
  const platform = process.platform;

  try {
    await writeFakeTypescriptLanguageServer(binDir, platform);
    const env =
      platform === 'win32'
        ? { Path: binDir, PATHEXT: '.COM;.EXE;.BAT;.CMD' }
        : { PATH: binDir };

    const result = await discoverLspProvider('typescript-language-server', env, platform);
    assert.equal(result.status, 'ready');
    assert.ok(result.command);
    assert.deepEqual(result.args, ['--stdio']);
  } finally {
    await import('node:fs/promises').then(({ rm }) => rm(binDir, { recursive: true, force: true }));
  }
});

test('discoverAllLspProviders returns one entry per registered provider', async () => {
  const results = await discoverAllLspProviders({ PATH: '' }, 'linux');
  assert.equal(results.length, LSP_PROVIDERS.length);
  assert.equal(results[0]?.id, 'typescript-language-server');
});
