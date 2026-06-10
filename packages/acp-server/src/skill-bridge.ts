import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import type {
  LlmActiveSkill,
  LlmActiveSkillResourceEntry,
  LlmEnabledSkillCatalogEntry,
} from '@spirit-agent/core';
import type * as schema from '@agentclientprotocol/sdk';

// --- Constants (aligned with Desktop) ---

const ACTIVE_SKILL_CONTENT_MAX_CHARS = 12_000;
const ACTIVE_SKILL_RESOURCE_MAX_ENTRIES = 24;
const ACTIVE_SKILL_RESOURCE_DIRS: ReadonlyArray<{
  kind: LlmActiveSkillResourceEntry['kind'];
  dirname: string;
}> = [
  { kind: 'scripts', dirname: 'scripts' },
  { kind: 'references', dirname: 'references' },
  { kind: 'assets', dirname: 'assets' },
];

// --- ACP Available Commands ---

/**
 * Converts enabled skill catalog entries into ACP AvailableCommand entries
 * for the `available_commands_update` notification.
 */
export function buildAvailableCommands(
  catalog: LlmEnabledSkillCatalogEntry[],
): schema.AvailableCommand[] {
  return catalog.map((entry) => ({
    name: entry.name,
    description: entry.description,
    input: {
      hint: `optional instructions for ${entry.name}`,
    },
  }));
}

// --- Slash Command Parsing ---

export interface ParsedSlashCommand {
  skillName: string;
  remainingText: string;
}

/**
 * Extracts a `/skill-name` prefix from prompt text.
 * Returns null if no valid slash command is found.
 *
 * Recognized pattern: `/name` at the start of the text, optionally followed
 * by a space and remaining text. The name must match `[a-z0-9-]+`.
 */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  // Match: /name [rest...]
  const match = /^\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\s+([\s\S]*))?$/u.exec(trimmed);
  if (!match) {
    return null;
  }

  return {
    skillName: match[1]!,
    remainingText: (match[2] ?? '').trim(),
  };
}

// --- Skill Payload Building ---

/**
 * Reads a skill's SKILL.md content and resource files to build an LlmActiveSkill payload.
 *
 * Follows the same conventions as Desktop's `buildActiveSkillPayload`:
 * - Content is truncated to 12,000 characters
 * - Resources are collected from scripts/, references/, assets/ subdirectories
 * - Maximum 24 resource entries
 */
export async function buildActiveSkillPayload(
  entry: LlmEnabledSkillCatalogEntry,
): Promise<LlmActiveSkill> {
  const skillRoot = path.dirname(entry.path);

  // Read the SKILL.md content (strip frontmatter)
  const rawContent = await readFile(entry.path, 'utf8');
  const content = stripFrontmatter(rawContent);
  const { content: truncatedContent, truncated } = truncateContent(content);

  // Collect resource files
  const { resources, resourcesTruncated } = await collectResources(skillRoot);

  return {
    id: entry.id,
    scope: entry.scope,
    name: entry.name,
    description: entry.description,
    path: entry.path,
    content: truncatedContent,
    truncated,
    resources,
    resourcesTruncated,
  };
}

// --- Upsert Helper ---

/**
 * Adds or replaces a skill in the active skills array by id.
 * Mutates the array in place (closures capture the reference).
 */
export function upsertActiveSkill(
  skills: LlmActiveSkill[],
  newSkill: LlmActiveSkill,
): void {
  const idx = skills.findIndex((s) => s.id === newSkill.id);
  if (idx >= 0) {
    skills[idx] = newSkill;
  } else {
    skills.push(newSkill);
  }
}

// --- Internal Helpers ---

/**
 * Strips YAML frontmatter (---...---) from skill file content.
 */
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) {
    return content;
  }
  const endIndex = content.indexOf('---', 3);
  if (endIndex < 0) {
    return content;
  }
  return content.slice(endIndex + 3).trimStart();
}

/**
 * Truncates skill content to the maximum character limit.
 */
function truncateContent(content: string): { content: string; truncated: boolean } {
  const chars = [...content];
  if (chars.length <= ACTIVE_SKILL_CONTENT_MAX_CHARS) {
    return { content: content.trim(), truncated: false };
  }
  return {
    content: `${chars.slice(0, ACTIVE_SKILL_CONTENT_MAX_CHARS).join('').trimEnd()}\n\n...<skill content truncated>`,
    truncated: true,
  };
}

/**
 * Collects resource file entries from a skill's subdirectories.
 */
async function collectResources(skillRoot: string): Promise<{
  resources: LlmActiveSkillResourceEntry[];
  resourcesTruncated: boolean;
}> {
  const resources: LlmActiveSkillResourceEntry[] = [];
  let resourcesTruncated = false;

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

      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
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
          resourcesTruncated = true;
          return { resources, resourcesTruncated };
        }

        resources.push({
          kind,
          path: path.relative(skillRoot, fullPath).replace(/\\/gu, '/'),
        });
      }
    }
  }

  return { resources, resourcesTruncated };
}
