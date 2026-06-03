import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { resolveInstructionPaths, type InstructionDiscoveryContext } from '@spirit-agent/host-internal';

import {
  deleteFileLineDeltaFromContent,
  type EditFileLineDelta,
} from '../lib/edit-file-line-delta.js';

/** 与 `readWorkspaceTextFile` 一致，避免删除前读取超大文件。 */
const DELETE_FILE_LINE_DELTA_MAX_BYTES = 2 * 1024 * 1024;

function pathCompareKey(inputPath: string): string {
  let normalized = path.resolve(inputPath).replace(/\\/gu, '/');
  if (normalized.startsWith('//?/UNC/')) {
    normalized = `//${normalized.slice('//?/UNC/'.length)}`;
  } else if (normalized.startsWith('//?/')) {
    normalized = normalized.slice('//?/'.length);
  }
  return normalized.replace(/\/+$/u, '');
}

function pathHasPrefix(candidate: string, prefix: string): boolean {
  const candidateKey = pathCompareKey(candidate);
  const prefixKey = pathCompareKey(prefix);
  return candidateKey === prefixKey || candidateKey.startsWith(`${prefixKey}/`);
}

function isWithinRoot(resolvedPath: string, root: string): boolean {
  return pathHasPrefix(resolvedPath, root);
}

function isInsideSpiritManagedUserArea(
  resolvedPath: string,
  context: InstructionDiscoveryContext,
): boolean {
  const paths = resolveInstructionPaths(context);
  const allowed = [paths.userRuleFile, paths.plansDir, paths.userSkillsDir].map((entry) =>
    path.resolve(entry),
  );
  return allowed.some((allowedPath) => pathHasPrefix(resolvedPath, allowedPath));
}

function isAllowedDeleteTarget(
  resolvedPath: string,
  context: InstructionDiscoveryContext,
): boolean {
  return (
    isWithinRoot(resolvedPath, path.resolve(context.workspaceRoot)) ||
    isInsideSpiritManagedUserArea(resolvedPath, context)
  );
}

function resolveDeleteFileTarget(
  context: InstructionDiscoveryContext,
  inputPath: string,
): string | undefined {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    return undefined;
  }

  const resolved = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(context.workspaceRoot, trimmed);

  if (!isAllowedDeleteTarget(resolved, context)) {
    return undefined;
  }

  return resolved;
}

/** 删除前从磁盘读取目标文件并统计将被移除的行数（仅宿主进程调用）。 */
export function lineDeltaForDeleteFilePath(
  context: InstructionDiscoveryContext,
  inputPath: string,
): EditFileLineDelta | undefined {
  const target = resolveDeleteFileTarget(context, inputPath);
  if (!target || !existsSync(target)) {
    return undefined;
  }

  let fileStat;
  try {
    fileStat = lstatSync(target);
  } catch {
    return undefined;
  }
  if (!fileStat.isFile() || fileStat.size > DELETE_FILE_LINE_DELTA_MAX_BYTES) {
    return undefined;
  }

  try {
    const content = readFileSync(target, 'utf8');
    return deleteFileLineDeltaFromContent(content);
  } catch {
    return undefined;
  }
}
