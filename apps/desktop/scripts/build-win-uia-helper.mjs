#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.platform !== 'win32') {
  console.log('[spirit-desktop] skip win-uia-helper build (not Windows)');
  process.exit(0);
}

const scriptPath = path.join(desktopRoot, 'scripts/build-win-uia-helper.ps1');
const result = spawnSync(
  'powershell',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
  { cwd: desktopRoot, stdio: 'inherit' },
);

process.exit(result.status ?? 1);
