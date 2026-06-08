import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  buildCreateRuleUserTurn,
  createRuleFile,
  deleteRuleFile,
  parseCreateRuleRequest,
  parseCreateRuleSlashPrompt,
  resolveRuleFilePath,
} from '../../dist-electron/src/host/rules.js';
import { desktopInstructionPaths } from '../../dist-electron/src/host/skills.js';

test('parseCreateRuleRequest accepts user scope prefix', () => {
  const parsed = parseCreateRuleRequest('user 跨仓库提交约定');
  assert.ok(!(parsed instanceof Error));
  assert.equal(parsed.scope, 'user');
  assert.equal(parsed.prompt, '跨仓库提交约定');
});

test('parseCreateRuleSlashPrompt defaults to workspace scope', () => {
  const parsed = parseCreateRuleSlashPrompt('/create-rule 使用简体中文写 commit');
  assert.ok(!(parsed instanceof Error));
  assert.equal(parsed.scope, 'workspace');
  assert.equal(parsed.prompt, '使用简体中文写 commit');
});

test('buildCreateRuleUserTurn includes workspace root and target path', () => {
  const turn = buildCreateRuleUserTurn('C:/workspace/demo', {
    scope: 'workspace',
    prompt: 'test',
  });
  assert.match(turn, /workspace_root: C:\/workspace\/demo/);
  assert.match(turn, /rule\.md/);
});

test('createRuleFile writes template and rejects duplicates', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-rules-create-'));
  const previousAppData = process.env.APPDATA;
  process.env.APPDATA = join(workspaceRoot, 'appdata');
  try {
    const instructionPaths = desktopInstructionPaths(workspaceRoot);
    const targetPath = resolveRuleFilePath(instructionPaths, 'workspaceSpirit');
    await createRuleFile(workspaceRoot, {
      rootKind: 'workspaceSpirit',
      description: '提交信息使用中文',
    });
    const content = await import('node:fs/promises').then((fs) => fs.readFile(targetPath, 'utf8'));
    assert.match(content, /提交信息使用中文/);
    await assert.rejects(
      () =>
        createRuleFile(workspaceRoot, {
          rootKind: 'workspaceSpirit',
          description: 'duplicate',
        }),
      /已存在|already exists/i,
    );
  } finally {
    if (previousAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = previousAppData;
    }
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('deleteRuleFile removes managed rule file', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-rules-delete-'));
  const appDataRoot = join(workspaceRoot, 'appdata');
  const spiritDataDir = join(appDataRoot, 'SpiritAgent');
  const previousAppData = process.env.APPDATA;
  process.env.APPDATA = appDataRoot;
  try {
    await mkdir(join(workspaceRoot, '.spirit'), { recursive: true });
    const instructionPaths = desktopInstructionPaths(workspaceRoot);
    const targetPath = resolveRuleFilePath(instructionPaths, 'workspaceSpirit');
    await writeFile(targetPath, '# Rules\n', 'utf8');
    const entries = await import('@spirit-agent/host-internal').then((mod) =>
      mod.discoverRuleEntries({
        workspaceRoot,
        spiritDataDir,
      }),
    );
    const entry = entries.find((item) => item.source.rootKind === 'workspaceSpirit');
    assert.ok(entry?.exists);
    await deleteRuleFile(
      workspaceRoot,
      { id: entry.source.id },
      { workspaceRoot, spiritDataDir },
    );
    const after = await import('node:fs/promises').then((fs) => fs.stat(targetPath).catch(() => null));
    assert.equal(after, null);
  } finally {
    if (previousAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = previousAppData;
    }
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
