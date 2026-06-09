#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const force = process.argv.includes('--force');

const SOURCE_EXT = new Set(['.ts', '.tsx', '.json']);

function walkSources(rootDir, files = []) {
  if (!fs.existsSync(rootDir)) {
    return files;
  }
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron') {
        continue;
      }
      walkSources(fullPath, files);
    } else if (SOURCE_EXT.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function collectSources(...paths) {
  const files = [];
  for (const entry of paths) {
    const resolved = path.resolve(entry);
    if (!fs.existsSync(resolved)) {
      continue;
    }
    if (fs.statSync(resolved).isDirectory()) {
      files.push(...walkSources(resolved));
    } else {
      files.push(resolved);
    }
  }
  return files;
}

function maxMtime(files) {
  let max = 0;
  for (const file of files) {
    max = Math.max(max, fs.statSync(file).mtimeMs);
  }
  return max;
}

function outputMtime(file) {
  return fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
}

function isStale(sourcePaths, outputPaths, dependencyOutputs = []) {
  if (outputPaths.some((file) => outputMtime(file) === 0)) {
    return true;
  }
  const sourceMax = maxMtime(collectSources(...sourcePaths));
  const outputMin = Math.min(...outputPaths.map((file) => outputMtime(file)));
  if (sourceMax > outputMin) {
    return true;
  }
  for (const dependency of dependencyOutputs) {
    if (outputMtime(dependency) > outputMin) {
      return true;
    }
  }
  return false;
}

function npmRun(cwd, script) {
  const result = spawnSync('npm', ['run', script], {
    cwd,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensure(name, stale, build) {
  if (force || stale) {
    console.log(`[dev] building ${name}...`);
    build();
    return;
  }
  console.log(`[dev] ${name} up to date, skip build`);
}

const agentCoreRoot = path.join(repoRoot, 'packages/agent-core');
const hostInternalRoot = path.join(repoRoot, 'packages/host-internal');
const agentCoreOut = path.join(agentCoreRoot, 'dist/index.js');
const hostInternalOut = path.join(hostInternalRoot, 'dist/index.js');
const electronMainOut = path.join(desktopRoot, 'dist-electron/electron/main.js');
const electronPreloadOut = path.join(desktopRoot, 'dist-electron/electron/preload.cjs');

ensure(
  'agent-core',
  isStale([path.join(agentCoreRoot, 'src'), path.join(agentCoreRoot, 'tsconfig.json')], [agentCoreOut]),
  () => npmRun(agentCoreRoot, 'build'),
);

ensure(
  'host-internal',
  isStale(
    [path.join(hostInternalRoot, 'src'), path.join(hostInternalRoot, 'tsconfig.json')],
    [hostInternalOut],
    [agentCoreOut],
  ),
  () => npmRun(hostInternalRoot, 'build:tsc'),
);

ensure(
  'electron',
  isStale(
    [
      path.join(desktopRoot, 'electron'),
      path.join(desktopRoot, 'src/host'),
      path.join(desktopRoot, 'src/lib/composer-draft-store.ts'),
      path.join(desktopRoot, 'src/lib/conversation-thinking-ui.ts'),
      path.join(desktopRoot, 'src/lib/conversation-compaction-ui.ts'),
      path.join(desktopRoot, 'src/lib/subagent-display.ts'),
      path.join(desktopRoot, 'src/lib/git-changes-menu-items.ts'),
      path.join(desktopRoot, 'src/lib/tool-call-shimmer.ts'),
      path.join(desktopRoot, 'src/types.ts'),
      path.join(desktopRoot, 'tsconfig.electron.json'),
      path.join(desktopRoot, 'tsconfig.preload.cjs.json'),
    ],
    [electronMainOut, electronPreloadOut],
    [hostInternalOut, agentCoreOut],
  ),
  () => npmRun(desktopRoot, 'build:electron'),
);

spawnSync('node', ['scripts/ensure-pty-spawn-helper.mjs'], {
  cwd: desktopRoot,
  stdio: 'inherit',
});
