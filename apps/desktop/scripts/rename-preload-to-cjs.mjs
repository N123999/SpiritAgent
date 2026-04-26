import { existsSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'dist-electron', 'electron', 'preload.js');
const to = join(root, 'dist-electron', 'electron', 'preload.cjs');

/** 并发跑两次 build:electron 时，先结束的一方已 rename，另一方只见得到 preload.cjs —— 视为成功 */
if (existsSync(to) && !existsSync(from)) {
  console.log('[build] preload.cjs already present (skip rename)');
  process.exit(0);
}

if (!existsSync(from)) {
  console.error('[build] missing preload.js:', from);
  process.exit(1);
}

renameSync(from, to);
console.log('[build] renamed preload.js -> preload.cjs');
