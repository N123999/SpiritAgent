#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** node-pty prebuild 的 spawn-helper 有时无执行位，macOS posix_spawn 会失败。 */
function ensureExecutable(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  let mode;
  try {
    mode = fs.statSync(filePath).mode;
  } catch (err) {
    console.error(`[dev] stat failed for ${filePath}:`, err);
    process.exit(1);
  }
  if ((mode & 0o111) !== 0) {
    return false;
  }
  try {
    fs.chmodSync(filePath, mode | 0o755);
  } catch (err) {
    console.error(`[dev] chmod failed for ${filePath}:`, err);
    process.exit(1);
  }
  console.log(`[dev] chmod +x ${path.relative(desktopRoot, filePath)}`);
  return true;
}

const candidates = [
  path.join(desktopRoot, 'node_modules/node-pty/prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
  path.join(desktopRoot, 'node_modules/node-pty/build/Release/spawn-helper'),
];

for (const candidate of candidates) {
  ensureExecutable(candidate);
}
