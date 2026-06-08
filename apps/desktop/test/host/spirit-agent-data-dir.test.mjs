import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  migrateLegacyCwdSpiritAgentDataDir,
  resolveDefaultSpiritAgentDataDir,
  setSpiritAgentDataDirOverride,
  spiritAgentDataDir,
} from '../../dist-electron/src/host/storage.js';

async function withEnv(vars, run) {
  const previous = new Map();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('resolveDefaultSpiritAgentDataDir uses Application Support on macOS', async () => {
  if (process.platform !== 'darwin') {
    return;
  }

  const home = await mkdtemp(path.join(tmpdir(), 'spirit-agent-home-'));
  try {
    await withEnv(
      {
        APPDATA: undefined,
        HOME: home,
        USERPROFILE: undefined,
        SPIRIT_AGENT_DATA_DIR: undefined,
      },
      async () => {
        assert.equal(
          resolveDefaultSpiritAgentDataDir(),
          path.join(home, 'Library', 'Application Support', 'SpiritAgent'),
        );
      },
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('migrateLegacyCwdSpiritAgentDataDir copies cwd legacy config into override target', async () => {
  const previousCwd = process.cwd();
  const workspace = await mkdtemp(path.join(tmpdir(), 'spirit-agent-migrate-'));
  const legacyDir = path.join(workspace, '.spirit-agent');
  const targetDir = path.join(workspace, 'canonical-data-dir');

  try {
    process.chdir(workspace);
    setSpiritAgentDataDirOverride(targetDir);
    await mkdir(legacyDir, { recursive: true });
    await writeFile(
      path.join(legacyDir, 'config.json'),
      JSON.stringify({ activeModel: 'legacy-model', models: [] }),
      'utf8',
    );

    await migrateLegacyCwdSpiritAgentDataDir();

    assert.equal(spiritAgentDataDir(), targetDir);
    const migratedConfig = await readFile(path.join(targetDir, 'config.json'), 'utf8');
    assert.match(migratedConfig, /legacy-model/);
  } finally {
    setSpiritAgentDataDirOverride(undefined);
    process.chdir(previousCwd);
    await rm(workspace, { recursive: true, force: true });
  }
});
