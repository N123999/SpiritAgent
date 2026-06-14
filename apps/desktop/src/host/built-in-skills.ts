import { existsSync } from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SKILL_FILE_NAME,
  SKILLS_DIR_NAME,
  ensureBuiltinAuthoringSkills,
} from '@spirit-agent/host-internal';

export const BUILTIN_GIT_SKILL_NAMES = ['git-commit', 'git-push', 'git-merge'] as const;

export type BuiltinGitSkillName = (typeof BUILTIN_GIT_SKILL_NAMES)[number];

function resolveDesktopBuiltinSkillsTemplateRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, '../../built-in-skills'),
    path.join(here, '../../../built-in-skills'),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'git-commit', SKILL_FILE_NAME))) {
      return candidate;
    }
  }
  return candidates[0]!;
}

/** Copy Desktop-only Git skills, then shared authoring skills, into user AppData when missing. */
export async function ensureBuiltinUserSkills(spiritDataDir: string): Promise<void> {
  const templateRoot = resolveDesktopBuiltinSkillsTemplateRoot();
  const userSkillsRoot = path.join(spiritDataDir, SKILLS_DIR_NAME);

  await mkdir(userSkillsRoot, { recursive: true });

  for (const skillName of BUILTIN_GIT_SKILL_NAMES) {
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

  await ensureBuiltinAuthoringSkills(spiritDataDir);
}

export function gitChipActionToSkillName(action: 'commit' | 'push' | 'merge'): BuiltinGitSkillName {
  switch (action) {
    case 'commit':
      return 'git-commit';
    case 'push':
      return 'git-push';
    case 'merge':
      return 'git-merge';
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
