/**
 * Skill 路径常量与纯路径工具（无 Node 内置依赖，可供 Desktop renderer 安全 import）。
 */

export const SKILLS_DIR_NAME = 'skills';
export const SKILL_FILE_NAME = 'SKILL.md';

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/');
}

function pathSegments(path: string): string[] {
  return normalizePath(path).split('/').filter(Boolean);
}

function pathBasename(path: string): string {
  const segments = pathSegments(path);
  if (segments.length === 0) {
    return normalizePath(path);
  }
  return segments[segments.length - 1] ?? normalizePath(path);
}

export function isSkillMarkdownPath(path: string): boolean {
  return pathBasename(path) === SKILL_FILE_NAME;
}

export function splitSkillFrontmatter(raw: string): { frontmatter: string; body: string } | undefined {
  const content = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  const segments = content.split(/\r?\n/u);
  if (segments[0] !== '---') {
    return undefined;
  }

  let closingIndex = -1;
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index] === '---') {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex < 0) {
    return undefined;
  }

  return {
    frontmatter: segments.slice(1, closingIndex).join('\n'),
    body: segments.slice(closingIndex + 1).join('\n'),
  };
}

function unquoteYamlScalar(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
      return value.slice(1, -1);
    }
  }

  return value;
}

export function parseSkillFrontmatterFields(frontmatter: string): { name?: string; description?: string } {
  const parsed: { name?: string; description?: string } = {};
  for (const line of frontmatter.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    if (line.startsWith(' ') || line.startsWith('\t')) {
      continue;
    }

    if (parsed.name === undefined && trimmed.startsWith('name:')) {
      parsed.name = unquoteYamlScalar(trimmed.slice('name:'.length).trim());
      continue;
    }
    if (parsed.description === undefined && trimmed.startsWith('description:')) {
      parsed.description = unquoteYamlScalar(trimmed.slice('description:'.length).trim());
    }
  }

  return parsed;
}

/** Parse top-level `name:` from SKILL.md YAML frontmatter; tolerates incomplete closing `---`. */
export function parseSkillNameFromMarkdown(raw: string): string | undefined {
  const split = splitSkillFrontmatter(raw);
  if (split) {
    const name = parseSkillFrontmatterFields(split.frontmatter).name?.trim();
    if (name) {
      return name;
    }
  }

  const content = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  if (!content.startsWith('---')) {
    return undefined;
  }

  for (const line of content.split(/\r?\n/u).slice(1)) {
    if (line === '---') {
      break;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('name:')) {
      const name = unquoteYamlScalar(trimmed.slice('name:'.length).trim()).trim();
      return name || undefined;
    }
  }

  return undefined;
}

/** Line prefix from host read_file tool output: `     1 | content` */
const READ_FILE_TOOL_OUTPUT_LINE = /^\s*\d+\s*\|\s?(.*)$/u;

function stripReadFileToolOutputWrapper(output: string): string | undefined {
  if (!output.trimStart().startsWith('[read]')) {
    return undefined;
  }

  const bodyLines: string[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = READ_FILE_TOOL_OUTPUT_LINE.exec(line);
    if (match) {
      bodyLines.push(match[1] ?? '');
    }
  }
  return bodyLines.length > 0 ? bodyLines.join('\n') : undefined;
}

function readFileSkillDisplayName(skillMarkdownContent?: string): string | undefined {
  if (!skillMarkdownContent?.trim()) {
    return undefined;
  }
  const fromRaw = parseSkillNameFromMarkdown(skillMarkdownContent);
  if (fromRaw) {
    return fromRaw;
  }
  const stripped = stripReadFileToolOutputWrapper(skillMarkdownContent);
  if (stripped) {
    return parseSkillNameFromMarkdown(stripped);
  }
  return undefined;
}

function workspaceRelativeDirectoryPath(path: string, workspaceRoot: string): string | undefined {
  const pathSegs = pathSegments(path);
  const rootSegs = pathSegments(workspaceRoot);
  if (pathSegs.length < rootSegs.length) {
    return undefined;
  }
  for (let i = 0; i < rootSegs.length; i += 1) {
    if (pathSegs[i]!.toLowerCase() !== rootSegs[i]!.toLowerCase()) {
      return undefined;
    }
  }
  const relativeSegs = pathSegs.slice(rootSegs.length);
  if (relativeSegs.length === 0) {
    return '.';
  }
  let relative = relativeSegs.join('/');
  if (normalizePath(path).endsWith('/') && relative) {
    relative += '/';
  }
  return relative;
}

/** list_directory_files 工具卡路径：工作区内显示相对路径，区外显示绝对路径。 */
export function listDirectoryToolDisplayPath(
  path: string,
  workspaceRoot: string | undefined,
  emptyLabel: string,
): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return emptyLabel;
  }

  const normalized = normalizePath(trimmed);
  const root = workspaceRoot?.trim();
  if (root) {
    const relative = workspaceRelativeDirectoryPath(normalized, root);
    if (relative !== undefined) {
      return relative;
    }
  }

  return normalized;
}

/** read_file 工具卡右侧详情：SKILL.md 仅显示 frontmatter name。 */
export function readFileToolDisplayBase(
  path: string,
  emptyLabel: string,
  options?: { skillMarkdownContent?: string },
): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return emptyLabel;
  }
  if (isSkillMarkdownPath(trimmed)) {
    return readFileSkillDisplayName(options?.skillMarkdownContent) ?? '';
  }

  const normalized = normalizePath(trimmed);
  const absolute = normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized);
  if (!absolute) {
    return normalized;
  }
  return pathBasename(normalized);
}
