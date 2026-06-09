import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BUILTIN_GIT_SKILL_NAMES,
  ensureBuiltinUserSkills,
  gitChipActionToSkillName,
} from '../../src/host/builtin-skills.ts';

test('gitChipActionToSkillName maps actions', () => {
  assert.equal(gitChipActionToSkillName('commit'), 'git-commit');
  assert.equal(gitChipActionToSkillName('push'), 'git-push');
  assert.equal(gitChipActionToSkillName('merge'), 'git-merge');
});

test('ensureBuiltinUserSkills seeds missing skills without overwriting', async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), 'spirit-builtin-skills-'));
  try {
    await ensureBuiltinUserSkills(spiritDataDir);
    for (const name of BUILTIN_GIT_SKILL_NAMES) {
      const skillPath = join(spiritDataDir, 'skills', name, 'SKILL.md');
      const content = await readFile(skillPath, 'utf8');
      assert.match(content, /^---\r?\nname: /);
    }
    for (const name of ['create-rule', 'create-skill']) {
      const skillPath = join(spiritDataDir, 'skills', name, 'SKILL.md');
      const content = await readFile(skillPath, 'utf8');
      assert.match(content, /^---\r?\nname: /);
    }

    await ensureBuiltinUserSkills(spiritDataDir);
    const first = await readFile(join(spiritDataDir, 'skills', 'git-commit', 'SKILL.md'), 'utf8');
    const marker = `<!-- user-marker-${Date.now()} -->`;
    const skillPath = join(spiritDataDir, 'skills', 'git-commit', 'SKILL.md');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(skillPath, `${first}\n${marker}`);
    await ensureBuiltinUserSkills(spiritDataDir);
    const after = await readFile(skillPath, 'utf8');
    assert.match(after, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});
