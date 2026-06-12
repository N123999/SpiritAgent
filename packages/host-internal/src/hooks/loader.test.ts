import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { hooksUserConfigPath } from '@spirit-agent/core';

import { validateHooksConfig } from './loader.js';

test('validateHooksConfig reports missing script paths', async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), 'spirit-hooks-validate-'));
  const userConfigPath = hooksUserConfigPath(spiritDataDir);
  const hooksDir = join(spiritDataDir, 'hooks');
  await mkdir(hooksDir, { recursive: true });
  const scriptPath = join(hooksDir, 'exists.sh');
  await writeFile(
    userConfigPath,
    JSON.stringify({
      version: 1,
      hooks: {
        sessionStart: [{ command: 'hooks/exists.sh' }],
        preToolUse: [{ command: 'hooks/missing.sh' }],
      },
    }),
    'utf8',
  );
  await writeFile(
    scriptPath,
    `#!/bin/bash
cat > /dev/null
echo '{}'
`,
    'utf8',
  );
  await chmod(scriptPath, 0o755);

  const report = validateHooksConfig({
    spiritDataDir,
    workspaceRoot: undefined,
  });

  assert.equal(report.entries.length, 2);
  const existing = report.entries.find((entry) => entry.command.includes('exists.sh'));
  const missing = report.entries.find((entry) => entry.command.includes('missing.sh'));
  assert.equal(existing?.exists, true);
  assert.equal(missing?.exists, false);
  assert.equal(report.summary.sessionStart, 1);
  assert.equal(report.summary.preToolUse, 1);
});
