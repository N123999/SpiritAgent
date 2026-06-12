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

export function skillFolderBasename(path: string): string {
  const segments = pathSegments(path);
  if (segments.length < 2) {
    return pathBasename(path);
  }
  return segments[segments.length - 2] ?? pathBasename(path);
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

/** read_file 工具卡右侧详情：SKILL.md 显示上级 Skill 目录名，其它路径与 Desktop 既有规则一致。 */
export function readFileToolDisplayBase(path: string, emptyLabel: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return emptyLabel;
  }
  if (isSkillMarkdownPath(trimmed)) {
    return skillFolderBasename(trimmed);
  }

  const normalized = normalizePath(trimmed);
  const absolute = normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized);
  if (!absolute) {
    return normalized;
  }
  return pathBasename(normalized);
}
