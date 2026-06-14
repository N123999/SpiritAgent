import { existsSync } from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SKILL_FILE_NAME, SKILLS_DIR_NAME } from './storage.js';

export const BUILTIN_AUTHORING_SKILL_NAMES = ['create-rule', 'create-skill'] as const;

export type BuiltinAuthoringSkillName = (typeof BUILTIN_AUTHORING_SKILL_NAMES)[number];

export function resolveBuiltinSkillsTemplateRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, '../built-in-skills'), path.join(here, '../../built-in-skills')];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'create-skill', SKILL_FILE_NAME))) {
      return candidate;
    }
  }
  return candidates[0]!;
}

export async function ensureBuiltinAuthoringSkills(
  spiritDataDir: string,
  skillNames: readonly BuiltinAuthoringSkillName[] = BUILTIN_AUTHORING_SKILL_NAMES,
): Promise<void> {
  const templateRoot = resolveBuiltinSkillsTemplateRoot();
  const userSkillsRoot = path.join(spiritDataDir, SKILLS_DIR_NAME);

  await mkdir(userSkillsRoot, { recursive: true });

  for (const skillName of skillNames) {
    const templateSkillDir = path.join(templateRoot, skillName);
    const templateSkillFile = path.join(templateSkillDir, SKILL_FILE_NAME);
    if (!existsSync(templateSkillFile)) {
      continue;
    }

    const targetSkillDir = path.join(userSkillsRoot, skillName);
    const targetSkillFile = path.join(targetSkillDir, SKILL_FILE_NAME);
    if (existsSync(targetSkillFile)) {
      continue;
    }

    await mkdir(targetSkillDir, { recursive: true });
    await cp(templateSkillFile, targetSkillFile);
  }
}
