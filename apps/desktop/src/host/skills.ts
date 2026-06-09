import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import i18n from '../lib/i18n-host.js';
import type {
  OpenAiActiveSkill,
  OpenAiActiveSkillResourceEntry,
} from '@spirit-agent/core';
import {
  resolveInstructionPaths,
  SKILL_FILE_NAME,
  validateSkillName,
} from '@spirit-agent/host-internal';

import type {
  CreateSkillRequest,
  DeleteSkillRequest,
  DesktopSkillRootKind,
} from '../types.js';
import {
  type HostMetadataSummary,
  spiritAgentDataDir,
} from './storage.js';
import { formatYamlScalarForSkillFrontmatter } from './service-utils.js';

const ACTIVE_SKILL_CONTENT_MAX_CHARS = 12_000;
const ACTIVE_SKILL_RESOURCE_MAX_ENTRIES = 24;
const ACTIVE_SKILL_RESOURCE_DIRS: ReadonlyArray<{
  kind: OpenAiActiveSkillResourceEntry['kind'];
  dirname: string;
}> = [
  { kind: 'scripts', dirname: 'scripts' },
  { kind: 'references', dirname: 'references' },
  { kind: 'assets', dirname: 'assets' },
];

export function desktopInstructionPaths(workspaceRoot: string) {
  return resolveInstructionPaths({
    workspaceRoot,
    spiritDataDir: spiritAgentDataDir(),
  });
}

export function parseSkillRootKind(value: unknown): DesktopSkillRootKind {
  if (value === 'user' || value === 'workspaceSpirit' || value === 'workspaceAgents') {
    return value;
  }
  throw new Error(i18n.t('error.invalidSkillRootKind'));
}

export function resolveSkillRootDir(
  instructionPaths: ReturnType<typeof resolveInstructionPaths>,
  rootKind: DesktopSkillRootKind,
): string {
  switch (rootKind) {
    case 'user':
      return instructionPaths.userSkillsDir;
    case 'workspaceSpirit':
      return instructionPaths.workspaceSpiritSkillsDir;
    case 'workspaceAgents':
      return instructionPaths.workspaceAgentsSkillsDir;
    default: {
      const _exhaustive: never = rootKind;
      return _exhaustive;
    }
  }
}

export function resolveSkillDir(
  instructionPaths: ReturnType<typeof resolveInstructionPaths>,
  skillDirectoryName: string,
  rootKind: DesktopSkillRootKind,
): string {
  return path.join(resolveSkillRootDir(instructionPaths, rootKind), skillDirectoryName);
}

export function assertPathUnderSkillRoot(
  instructionPaths: ReturnType<typeof resolveInstructionPaths>,
  targetDir: string,
  rootKind: DesktopSkillRootKind,
): void {
  const root = path.resolve(resolveSkillRootDir(instructionPaths, rootKind));
  const resolved = path.resolve(targetDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(i18n.t('error.skillPathOutsideRoot'));
  }
}

export async function createSkillFile(
  workspaceRoot: string,
  request: CreateSkillRequest,
): Promise<void> {
  const instructionPaths = desktopInstructionPaths(workspaceRoot);
  const rootKind = parseSkillRootKind(request.rootKind);
  const name = request.name.trim().toLowerCase();
  const nameIssue = validateSkillName(name);
  if (nameIssue) {
    throw new Error(nameIssue);
  }

  const description = (request.description ?? '').trim();
  if (!description) {
    throw new Error(i18n.t('error.descriptionRequired'));
  }
  const skillDir = resolveSkillDir(instructionPaths, name, rootKind);
  if (existsSync(skillDir)) {
    throw new Error(i18n.t('error.skillAlreadyExists', { name }));
  }

  const frontmatterDescription = formatYamlScalarForSkillFrontmatter(description);
  const fileContent = `---
name: ${name}
description: ${frontmatterDescription}
---

在此编写技能正文：步骤、示例、边界条件与相对路径引用。
`;

  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, SKILL_FILE_NAME), fileContent, 'utf8');
}

export async function deleteSkillDir(
  workspaceRoot: string,
  request: DeleteSkillRequest,
): Promise<void> {
  const instructionPaths = desktopInstructionPaths(workspaceRoot);
  const rootKind = parseSkillRootKind(request.rootKind);
  const name = request.name.trim().toLowerCase();
  const nameIssue = validateSkillName(name);
  if (nameIssue) {
    throw new Error(nameIssue);
  }

  const skillDir = resolveSkillDir(instructionPaths, name, rootKind);
  assertPathUnderSkillRoot(instructionPaths, skillDir, rootKind);

  if (!existsSync(skillDir)) {
    throw new Error(i18n.t('error.skillNotFound', { name }));
  }

  await rm(skillDir, { recursive: true, force: true });
}

export function buildActivateSkillUserTurn(skillName: string, extraNote: string): string {
  const trimmed = extraNote.trim();
  if (!trimmed) {
    return i18n.t('slash.activateSkillPrompt', { skillName });
  }
  return trimmed;
}

export async function buildActiveSkillPayload(
  entry: HostMetadataSummary['skills']['entries'][number],
): Promise<OpenAiActiveSkill> {
  const skillRoot = path.dirname(entry.source.path);
  const { content, truncated } = truncateActiveSkillContent(entry.content);
  const { resources, truncated: resourcesTruncated } = await collectSkillResources(skillRoot);

  return {
    id: entry.source.id,
    scope: entry.source.scope,
    name: entry.source.name,
    description: entry.source.description,
    path: entry.source.path,
    content,
    truncated,
    resources,
    resourcesTruncated,
  };
}

function truncateActiveSkillContent(content: string): {
  content: string;
  truncated: boolean;
} {
  const chars = [...content];
  if (chars.length <= ACTIVE_SKILL_CONTENT_MAX_CHARS) {
    return {
      content: content.trim(),
      truncated: false,
    };
  }

  return {
    content: `${chars.slice(0, ACTIVE_SKILL_CONTENT_MAX_CHARS).join('').trimEnd()}\n\n...<skill content truncated>`,
    truncated: true,
  };
}

async function collectSkillResources(skillRoot: string): Promise<{
  resources: OpenAiActiveSkillResourceEntry[];
  truncated: boolean;
}> {
  const resources: OpenAiActiveSkillResourceEntry[] = [];
  let truncated = false;

  for (const { kind, dirname } of ACTIVE_SKILL_RESOURCE_DIRS) {
    const root = path.join(skillRoot, dirname);
    if (!existsSync(root)) {
      continue;
    }

    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      const entries = await readdir(current, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        if (resources.length >= ACTIVE_SKILL_RESOURCE_MAX_ENTRIES) {
          truncated = true;
          return { resources, truncated };
        }

        resources.push({
          kind,
          path: path.relative(skillRoot, fullPath).replace(/\\/gu, '/'),
        });
      }
    }
  }

  return { resources, truncated };
}
