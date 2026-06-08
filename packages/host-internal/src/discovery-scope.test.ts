import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { discoverRuleEntries, discoverSkillEntries, loadRuleDiscoveryResult } from './discovery.js';
import {
  SKILLS_DIR_NAME,
  USER_RULE_FILE_NAME,
  WORKSPACE_RULE_FILE_NAME,
  WORKSPACE_SPIRIT_SKILLS_DIR,
} from './storage.js';

test('discoverRuleEntries skips workspace sources when includeWorkspaceScope is false', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-discovery-scope-'));
  const spiritDataDir = join(workspaceRoot, 'spirit-data');
  await mkdir(spiritDataDir, { recursive: true });
  await writeFile(join(workspaceRoot, WORKSPACE_RULE_FILE_NAME), '# workspace rule\n', 'utf8');
  await writeFile(join(spiritDataDir, USER_RULE_FILE_NAME), '# user rule\n', 'utf8');

  try {
    const entries = await discoverRuleEntries({
      workspaceRoot,
      spiritDataDir,
      includeWorkspaceScope: false,
    });
    const scopes = entries.filter((entry) => entry.exists).map((entry) => entry.source.scope);
    assert.deepEqual(scopes, ['user']);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('loadRuleDiscoveryResult exposes entries with rootKind for fixed slots', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-discovery-rules-'));
  const spiritDataDir = join(workspaceRoot, 'spirit-data');
  await mkdir(spiritDataDir, { recursive: true });

  try {
    const result = await loadRuleDiscoveryResult({
      workspaceRoot,
      spiritDataDir,
    });

    assert.equal(result.entries.length, 3);
    assert.deepEqual(
      result.entries.map((entry) => entry.source.rootKind),
      ['workspaceSpirit', 'workspaceAgents', 'user'],
    );
    assert.equal(result.discovered, 0);
    assert.equal(result.enabled, 0);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('discoverSkillEntries skips workspace roots when includeWorkspaceScope is false', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-discovery-skills-'));
  const spiritDataDir = join(workspaceRoot, 'spirit-data');
  const workspaceSkillDir = join(workspaceRoot, WORKSPACE_SPIRIT_SKILLS_DIR, 'ws-skill');
  const userSkillDir = join(spiritDataDir, SKILLS_DIR_NAME, 'user-skill');
  await mkdir(workspaceSkillDir, { recursive: true });
  await mkdir(userSkillDir, { recursive: true });
  await writeFile(
    join(workspaceSkillDir, 'SKILL.md'),
    '---\nname: ws-skill\ndescription: workspace\n---\n',
    'utf8',
  );
  await writeFile(
    join(userSkillDir, 'SKILL.md'),
    '---\nname: user-skill\ndescription: user\n---\n',
    'utf8',
  );

  try {
    const entries = await discoverSkillEntries({
      workspaceRoot,
      spiritDataDir,
      includeWorkspaceScope: false,
    });
    const names = entries.map((entry) => entry.source.name).sort();
    assert.deepEqual(names, ['user-skill']);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
