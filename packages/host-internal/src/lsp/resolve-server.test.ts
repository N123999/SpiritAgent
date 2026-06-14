import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRustAnalyzerVersionOutputHealthy,
  resolveClangdOnPath,
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
