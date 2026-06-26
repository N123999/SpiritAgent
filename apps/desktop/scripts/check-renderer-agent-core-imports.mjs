#!/usr/bin/env node
/**
 * Desktop renderer 仅允许从 agent-core 的 renderer-safe 子路径做 value import。
 * 主入口 @spirit-agent/core 的 value import 会拉入 AI SDK / Node 依赖链。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const desktopSrc = join(repoRoot, 'apps', 'desktop', 'src');

/** value import 允许的 agent-core 子路径（须零 Node 传递依赖）。 */
const RENDERER_SAFE_AGENT_CORE_SUBPATHS = new Set([
  'reasoning-effort',
  'model-display-name',
  'shell-tool-result',
  'code-completion-to-monaco',
  'code-completion-delete-diff',
  'model-thinking-controls',
]);

const RENDERER_SCAN_ROOTS = ['components', 'hooks', 'lib', 'App.tsx'];

const IMPORT_RE =
  /import\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?['"]@spirit-agent\/core(?:\/([^'"]+))?['"]/gu;

function collectSourceFiles(entryPath) {
  const stat = statSync(entryPath);
  if (stat.isFile() && /\.(tsx?|mts)$/u.test(entryPath)) {
    return [entryPath];
  }
  if (!stat.isDirectory()) {
    return [];
  }
  const files = [];
  for (const name of readdirSync(entryPath)) {
    files.push(...collectSourceFiles(join(entryPath, name)));
  }
  return files;
}

function isTypeOnlyImport(line) {
  return /^\s*import\s+type\s+/u.test(line);
}

function scanFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/u);
  const violations = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes('@spirit-agent/core')) {
      continue;
    }
    if (isTypeOnlyImport(line)) {
      continue;
    }

    for (const match of line.matchAll(IMPORT_RE)) {
      const subpath = match[1];
      if (!subpath) {
        violations.push({
          file: relative(repoRoot, filePath),
          line: index + 1,
          reason: '禁止从 @spirit-agent/core 主入口做 value import',
        });
        continue;
      }
      if (!RENDERER_SAFE_AGENT_CORE_SUBPATHS.has(subpath)) {
        violations.push({
          file: relative(repoRoot, filePath),
          line: index + 1,
          reason: `子路径 "${subpath}" 不在 renderer-safe allowlist`,
        });
      }
    }
  }

  return violations;
}

const files = RENDERER_SCAN_ROOTS.flatMap((entry) =>
  collectSourceFiles(join(desktopSrc, entry)),
);

const violations = files.flatMap(scanFile);

if (violations.length > 0) {
  console.error('renderer agent-core import 检查失败:\n');
  for (const item of violations) {
    console.error(`  ${item.file}:${item.line} — ${item.reason}`);
  }
  process.exit(1);
}

console.log('renderer agent-core import 检查通过');
