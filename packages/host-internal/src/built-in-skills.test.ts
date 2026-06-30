import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BUILTIN_AUTHORING_SKILL_NAMES,
  ensureBuiltinAuthoringSkills,
  resolveBuiltinSkillsTemplateRoot,
} from './built-in-skills.js';

test('resolveBuiltinSkillsTemplateRoot finds the shared template directory', async () => {
  const templateRoot = resolveBuiltinSkillsTemplateRoot();
  const createSkill = await readFile(join(templateRoot, 'create-skill', 'SKILL.md'), 'utf8');
  assert.match(createSkill, /^---\r?\nname: create-skill\r?$/m);
});

test('ensureBuiltinAuthoringSkills seeds shared builtin skills without overwriting', async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), 'spirit-host-internal-built-in-skills-'));
  try {
    await ensureBuiltinAuthoringSkills(spiritDataDir);
    for (const name of BUILTIN_AUTHORING_SKILL_NAMES) {
      const skillPath = join(spiritDataDir, 'skills', name, 'SKILL.md');
      const content = await readFile(skillPath, 'utf8');
      assert.match(content, /^---\r?\nname: /);
    }

    assert.deepEqual(BUILTIN_AUTHORING_SKILL_NAMES, ['create-rule', 'create-skill', 'create-hook']);

    const skillPath = join(spiritDataDir, 'skills', 'create-skill', 'SKILL.md');
    const first = await readFile(skillPath, 'utf8');
    const marker = `user-marker-${Date.now()}`;
    await writeFile(skillPath, `${first}\n${marker}`);
    await ensureBuiltinAuthoringSkills(spiritDataDir);
    const after = await readFile(skillPath, 'utf8');
    assert.match(after, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});
