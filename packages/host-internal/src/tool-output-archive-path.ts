/**
 * 工具输出归档路径常量与纯路径判断（无 Node 内置依赖，可供 Desktop renderer 安全 import）。
 */

export const TOOL_OUTPUT_ARCHIVES_DIR_NAME = 'tool-output-archives';

function normalizePath(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/');
}

export function isToolOutputArchivePath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  if (!normalized) {
    return false;
  }
  const segment = TOOL_OUTPUT_ARCHIVES_DIR_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|/)${segment}(?:/|$)`, 'u').test(normalized);
}
