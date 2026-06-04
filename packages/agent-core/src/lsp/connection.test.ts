import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLanguageServerSpawnOptions } from './connection.js';

test('buildLanguageServerSpawnOptions enables shell for Windows cmd shims', () => {
  const options = buildLanguageServerSpawnOptions(
    'D:\\Cache\\.npm-global\\typescript-language-server.cmd',
    'D:\\SpiritAgent',
  );
  assert.equal(options.shell, true);
});

test('buildLanguageServerSpawnOptions leaves POSIX spawn without shell', () => {
  const options = buildLanguageServerSpawnOptions(
    '/usr/bin/typescript-language-server',
    '/tmp/workspace',
  );
  assert.equal(options.shell, undefined);
});
