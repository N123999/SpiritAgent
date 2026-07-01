#!/usr/bin/env node
/**
 * Desktop renderer 仅允许从 host-internal 的 renderer-safe 子路径做 value import。
 * 主入口 @spirit-agent/host-internal 的 value import 会拉入 node:fs 依赖链。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const desktopSrc = join(repoRoot, 'apps', 'desktop', 'src');

/** value import 允许的 host-internal 子路径（不含 node 依赖）。 */
const RENDERER_SAFE_HOST_INTERNAL_SUBPATHS = new Set([
  'workspace-file-reference-query',
  'model-provider-presets',
  'openai-api-base',
  'bedrock-region',
  'bedrock-mantle',
  'google-vertex-endpoints',
  'skill-paths',
  'tool-output-archive-path',
  'github-pull-request-url',
  'github-pull-request-checks-pages',
  'github-pull-request-conversation-pages',
  'image-file-support',
]);

const RENDERER_SCAN_ROOTS = ['components', 'hooks', 'lib', 'App.tsx'];

const IMPORT_RE =
  /import\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?['"]@spirit-agent\/host-internal(?:\/([^'"]+))?['"]/gu;

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
    if (!line.includes('@spirit-agent/host-internal')) {
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
          reason: '禁止从 @spirit-agent/host-internal 主入口做 value import',
        });
        continue;
      }
      if (!RENDERER_SAFE_HOST_INTERNAL_SUBPATHS.has(subpath)) {
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
  console.error('renderer host-internal import 检查失败:\n');
  for (const item of violations) {
    console.error(`  ${item.file}:${item.line} — ${item.reason}`);
  }
  process.exit(1);
}

console.log('renderer host-internal import 检查通过');
