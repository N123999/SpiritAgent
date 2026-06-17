#!/usr/bin/env node
/**
 * 根 package-lock 不得包含 apps/desktop：否则根目录 npm ci 会污染 desktop 的 optional 依赖树
 *（rolldown 等平台 binding 在 Linux/macOS CI 会缺失）。desktop 使用独立 lockfile。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const lockPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'package-lock.json',
);
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const desktopKey = 'apps/desktop';

if (!(desktopKey in lock.packages)) {
  process.exit(0);
}

delete lock.packages[desktopKey];
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`Removed ${desktopKey} from root package-lock.json`);
