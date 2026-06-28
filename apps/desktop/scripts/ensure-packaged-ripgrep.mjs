#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const hoistedVscode = path.join(repoRoot, 'node_modules', '@vscode');
const destVscode = path.join(desktopRoot, 'node_modules', '@vscode');

/** @vscode/ripgrep 通过 optionalDependency 平台包提供 rg 二进制；npm 常 hoist 到仓库根，electron-builder 默认打不进 desktop。 */
function copyRipgrepPackages() {
  if (!fs.existsSync(hoistedVscode)) {
    console.error('[pack] missing hoisted @vscode at', hoistedVscode);
    process.exit(1);
  }

  const names = fs.readdirSync(hoistedVscode).filter(
    (name) => name === 'ripgrep' || name.startsWith('ripgrep-'),
  );
  if (names.length === 0) {
    console.error('[pack] no @vscode/ripgrep packages under', hoistedVscode);
    process.exit(1);
  }

  const platformPkg = `ripgrep-${process.platform}-${process.arch}`;
  if (!names.includes(platformPkg)) {
    console.error(`[pack] missing ${platformPkg} for this build host; found: ${names.join(', ')}`);
    process.exit(1);
  }

  fs.mkdirSync(destVscode, { recursive: true });
  for (const name of names) {
    const src = path.join(hoistedVscode, name);
    const dest = path.join(destVscode, name);
    fs.cpSync(src, dest, { recursive: true, force: true });
    console.log(`[pack] copied @vscode/${name}`);
  }
}

copyRipgrepPackages();
