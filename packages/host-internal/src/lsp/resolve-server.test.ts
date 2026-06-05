import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTypescriptLanguageServerCandidates } from './resolve-server.js';

test('buildTypescriptLanguageServerCandidates expands Windows PATHEXT', () => {
  const candidates = buildTypescriptLanguageServerCandidates(
    {
      Path: 'C:\\Tools;D:\\bin',
      PATHEXT: '.EXE;.CMD',
    },
    'win32',
  );
  assert.ok(candidates.includes('C:\\Tools\\typescript-language-server.exe'));
  assert.ok(candidates.includes('D:\\bin\\typescript-language-server.cmd'));
});

test('buildTypescriptLanguageServerCandidates uses POSIX PATH segments', () => {
  const candidates = buildTypescriptLanguageServerCandidates(
    { PATH: '/usr/bin:/opt/bin' },
    'linux',
  );
  assert.deepEqual(candidates, [
    '/usr/bin/typescript-language-server',
    '/opt/bin/typescript-language-server',
  ]);
});
