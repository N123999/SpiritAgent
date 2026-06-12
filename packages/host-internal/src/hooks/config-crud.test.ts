import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  deleteHookEntry,
  listHookListItems,
  saveHookEntry,
} from './config-crud.js';
import { loadHooksConfigFileAt } from './loader.js';

test('listHookListItems returns user and workspace entries', async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), 'spirit-hooks-crud-user-'));
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-hooks-crud-ws-'));
  const userConfigPath = join(spiritDataDir, 'hooks.json');
  const workspaceConfigPath = join(workspaceRoot, '.spirit', 'hooks.json');

  await writeFile(
    userConfigPath,
    JSON.stringify({
      version: 1,
      hooks: {
        preToolUse: [{ command: 'hooks/user.sh' }],
      },
    }),
    'utf8',
  );
  await mkdir(join(workspaceRoot, '.spirit'), { recursive: true });
  await writeFile(
    workspaceConfigPath,
    JSON.stringify({
      version: 1,
      hooks: {
        postToolUse: [{ command: 'hooks/workspace.sh', timeout: 10 }],
      },
    }),
    'utf8',
  );

  const items = listHookListItems({
    spiritDataDir,
    workspaceRoot,
    workspaceBinding: 'project',
  });

  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((item) => [item.scope, item.event, item.command]),
    [
      ['user', 'preToolUse', 'hooks/user.sh'],
      ['workspace', 'postToolUse', 'hooks/workspace.sh'],
    ],
  );
});

test('saveHookEntry appends to hooks.json', async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), 'spirit-hooks-crud-save-'));
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-hooks-crud-save-ws-'));

  await saveHookEntry(
    {
      spiritDataDir,
      workspaceRoot,
      workspaceBinding: 'none',
    },
    {
      scope: 'user',
      event: 'submitPrompt',
      command: 'hooks/new.sh',
      timeout: 15,
      matcher: 'grep',
      failClosed: true,
    },
  );

  const config = loadHooksConfigFileAt(join(spiritDataDir, 'hooks.json'));
  assert.equal(config.hooks.submitPrompt?.length, 1);
  assert.deepEqual(config.hooks.submitPrompt?.[0], {
    command: 'hooks/new.sh',
    timeout: 15,
    matcher: 'grep',
    failClosed: true,
  });
});

test('saveHookEntry rejects workspace scope without binding', async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), 'spirit-hooks-crud-reject-'));
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-hooks-crud-reject-ws-'));

  await assert.rejects(
    () =>
      saveHookEntry(
        {
          spiritDataDir,
          workspaceRoot,
          workspaceBinding: 'none',
        },
        {
          scope: 'workspace',
          event: 'preToolUse',
          command: 'hooks/ws.sh',
        },
      ),
    /bound workspace/i,
  );
});

test('saveHookEntry rejects non-positive timeout', async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), 'spirit-hooks-crud-timeout-'));
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-hooks-crud-timeout-ws-'));

  await assert.rejects(
    () =>
      saveHookEntry(
        {
          spiritDataDir,
          workspaceRoot,
          workspaceBinding: 'none',
        },
        {
          scope: 'user',
          event: 'preToolUse',
          command: 'hooks/a.sh',
          timeout: 0,
        },
      ),
    /positive number/i,
  );
});

test('deleteHookEntry removes hook entry', async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), 'spirit-hooks-crud-delete-'));
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-hooks-crud-delete-ws-'));

  await saveHookEntry(
    {
      spiritDataDir,
      workspaceRoot,
      workspaceBinding: 'none',
    },
    {
      scope: 'user',
      event: 'sessionStart',
      command: 'hooks/a.sh',
    },
  );
  await saveHookEntry(
    {
      spiritDataDir,
      workspaceRoot,
      workspaceBinding: 'none',
    },
    {
      scope: 'user',
      event: 'sessionStart',
      command: 'hooks/b.sh',
    },
  );

  await deleteHookEntry(
    {
      spiritDataDir,
      workspaceRoot,
      workspaceBinding: 'none',
    },
    {
      scope: 'user',
      event: 'sessionStart',
      index: 0,
    },
  );

  const items = listHookListItems({
    spiritDataDir,
    workspaceRoot,
    workspaceBinding: 'none',
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.command, 'hooks/b.sh');
  assert.equal(items[0]?.index, 0);
});
