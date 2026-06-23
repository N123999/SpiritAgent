#!/usr/bin/env node
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const releaseRoot = path.join(repoRoot, 'dist', 'release');

const targetMap = {
  'x86_64-pc-windows-msvc': {
    packageTarget: 'windows-x64',
    binaryName: 'spirit.exe',
    nodePlatform: 'win',
    nodeArch: 'x64',
    nodeArchiveExt: 'zip',
    archiveExt: 'zip',
  },
  'i686-pc-windows-msvc': {
    packageTarget: 'windows-ia32',
    binaryName: 'spirit.exe',
    nodePlatform: 'win',
    nodeArch: 'x86',
    nodeArchiveExt: 'zip',
    archiveExt: 'zip',
  },
  'aarch64-pc-windows-msvc': {
    packageTarget: 'windows-arm64',
    binaryName: 'spirit.exe',
    nodePlatform: 'win',
    nodeArch: 'arm64',
    nodeArchiveExt: 'zip',
    archiveExt: 'zip',
  },
  'x86_64-unknown-linux-gnu': {
    packageTarget: 'linux-x64',
    binaryName: 'spirit',
    nodePlatform: 'linux',
    nodeArch: 'x64',
    nodeArchiveExt: 'tar.gz',
    archiveExt: 'tar.gz',
  },
  'aarch64-unknown-linux-gnu': {
    packageTarget: 'linux-arm64',
    binaryName: 'spirit',
    nodePlatform: 'linux',
    nodeArch: 'arm64',
    nodeArchiveExt: 'tar.gz',
    archiveExt: 'tar.gz',
  },
  'x86_64-apple-darwin': {
    packageTarget: 'macos-x64',
    binaryName: 'spirit',
    nodePlatform: 'darwin',
    nodeArch: 'x64',
    nodeArchiveExt: 'tar.gz',
    archiveExt: 'tar.gz',
  },
  'aarch64-apple-darwin': {
    packageTarget: 'macos-arm64',
    binaryName: 'spirit',
    nodePlatform: 'darwin',
    nodeArch: 'arm64',
    nodeArchiveExt: 'tar.gz',
    archiveExt: 'tar.gz',
  },
};

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function detectHostTarget() {
  if (process.platform === 'win32') {
    return process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  }
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  }
  if (process.platform === 'linux') {
    return process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
  }
  throw new Error(`不支持的宿主平台: ${process.platform}/${process.arch}`);
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf8'));
}

async function downloadFile(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`下载失败 ${response.status}: ${url}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function resolveNodeReleaseVersion() {
  if (process.env.SPIRIT_RELEASE_NODE_VERSION) {
    return process.env.SPIRIT_RELEASE_NODE_VERSION.replace(/^v/, '');
  }

  const major = process.env.SPIRIT_RELEASE_NODE_MAJOR ?? '22';
  const response = await fetch('https://nodejs.org/dist/index.json');
  if (!response.ok) {
    throw new Error(`无法查询 Node.js ${major}.x 版本: ${response.status}`);
  }
  const releases = await response.json();
  const latest = releases.find((item) => item.version?.startsWith(`v${major}.`));
  if (!latest) {
    throw new Error(`未找到 Node.js ${major}.x 发布版本`);
  }
  return latest.version.replace(/^v/, '');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`命令失败: ${command} ${args.join(' ')}`);
  }
}

function runPowerShell(script) {
  const executable = process.env.PWSH ?? (process.platform === 'win32' ? 'powershell' : 'pwsh');
  run(executable, ['-NoProfile', '-NonInteractive', '-Command', script]);
}

function psSingleQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function extractArchive(archivePath, destinationDir, archiveExt) {
  if (process.platform === 'win32' && archiveExt === 'zip') {
    runPowerShell(
      `Expand-Archive -LiteralPath ${psSingleQuote(archivePath)} -DestinationPath ${psSingleQuote(destinationDir)} -Force`,
    );
    return;
  }
  run('tar', ['-xf', archivePath, '-C', destinationDir]);
}

function createArchive(sourceDir, archivePath, archiveExt) {
  if (process.platform === 'win32' && archiveExt === 'zip') {
    runPowerShell(
      `Compress-Archive -LiteralPath ${psSingleQuote(sourceDir)} -DestinationPath ${psSingleQuote(archivePath)} -Force`,
    );
    return;
  }
  if (archiveExt === 'zip') {
    run('tar', ['-a', '-cf', archivePath, '-C', path.dirname(sourceDir), path.basename(sourceDir)]);
  } else {
    run('tar', ['-czf', archivePath, '-C', path.dirname(sourceDir), path.basename(sourceDir)]);
  }
}

async function ensureNodeRuntime(targetInfo) {
  const version = await resolveNodeReleaseVersion();
  const nodeName = `node-v${version}-${targetInfo.nodePlatform}-${targetInfo.nodeArch}`;
  const archiveName = `${nodeName}.${targetInfo.nodeArchiveExt}`;
  const cacheDir = path.join(releaseRoot, '.cache', 'node');
  const archivePath = path.join(cacheDir, archiveName);
  const extractedRoot = path.join(cacheDir, nodeName);

  if (!(await pathExists(extractedRoot))) {
    if (!(await pathExists(archivePath))) {
      const url = `https://nodejs.org/dist/v${version}/${archiveName}`;
      console.log(`Downloading ${url}`);
      await downloadFile(url, archivePath);
    }
    extractArchive(archivePath, cacheDir, targetInfo.nodeArchiveExt);
  }

  return extractedRoot;
}

async function copyHoistedHostInternalRipgrep(destinationRoot) {
  const destination = path.join(destinationRoot, 'packages', 'host-internal', 'node_modules', '@vscode', 'ripgrep');
  const hoistedRipgrep = path.join(repoRoot, 'node_modules', '@vscode', 'ripgrep');
  if (!(await pathExists(hoistedRipgrep))) {
    return;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(hoistedRipgrep, destination, { recursive: true });
}

async function copyPackageDist(packageName, destinationRoot) {
  const sourceRoot = path.join(repoRoot, 'packages', packageName);
  const destination = path.join(destinationRoot, 'packages', packageName);
  await cp(path.join(sourceRoot, 'dist'), path.join(destination, 'dist'), { recursive: true });
  await cp(path.join(sourceRoot, 'package.json'), path.join(destination, 'package.json'));
  const nodeModules = path.join(sourceRoot, 'node_modules');
  if (await pathExists(nodeModules)) {
    await cp(nodeModules, path.join(destination, 'node_modules'), { recursive: true });
    return;
  }
  if (packageName === 'host-internal') {
    await copyHoistedHostInternalRipgrep(destinationRoot);
  }
}

async function main() {
  const target = readArg('--target') ?? process.env.SPIRIT_RELEASE_TARGET ?? detectHostTarget();
  const targetInfo = targetMap[target];
  if (!targetInfo) {
    throw new Error(`不支持的 CLI release target: ${target}`);
  }

  const desktopPackage = await readJson('apps/desktop/package.json');
  const agentCorePackage = await readJson('packages/agent-core/package.json');
  const hostInternalPackage = await readJson('packages/host-internal/package.json');
  const version = readArg('--version') ?? process.env.RELEASE_VERSION ?? desktopPackage.version;
  const targetBinaryPath = path.join(repoRoot, 'target', target, 'release', targetInfo.binaryName);
  const hostBinaryPath = path.join(repoRoot, 'target', 'release', targetInfo.binaryName);
  const binaryPath = (await pathExists(targetBinaryPath)) ? targetBinaryPath : hostBinaryPath;

  if (!(await pathExists(binaryPath))) {
    throw new Error(`未找到 CLI release 二进制: ${targetBinaryPath}`);
  }

  const bundleName = `SpiritAgent-CLI-${version}-${targetInfo.packageTarget}`;
  const bundleRoot = path.join(releaseRoot, 'cli', bundleName);
  await rm(bundleRoot, { recursive: true, force: true });
  await mkdir(path.join(bundleRoot, 'bin'), { recursive: true });

  await cp(binaryPath, path.join(bundleRoot, 'bin', targetInfo.binaryName));
  await cp(await ensureNodeRuntime(targetInfo), path.join(bundleRoot, 'node'), { recursive: true });
  await copyPackageDist('agent-core', bundleRoot);
  await copyPackageDist('host-internal', bundleRoot);

  await writeFile(
    path.join(bundleRoot, 'release-manifest.json'),
    `${JSON.stringify(
      {
        name: 'Spirit Agent CLI',
        version,
        target,
        packageTarget: targetInfo.packageTarget,
        generatedAt: new Date().toISOString(),
        gitSha: process.env.GITHUB_SHA ?? null,
        nodeVersion: await resolveNodeReleaseVersion(),
        binary: `bin/${targetInfo.binaryName}`,
        components: {
          cli: version,
          desktop: desktopPackage.version,
          agentCore: agentCorePackage.version,
          hostInternal: hostInternalPackage.version,
        },
      },
      null,
      2,
    )}\n`,
  );

  const archivePath = path.join(releaseRoot, `${bundleName}.${targetInfo.archiveExt}`);
  await rm(archivePath, { force: true });
  createArchive(bundleRoot, archivePath, targetInfo.archiveExt);
  console.log(`Created ${archivePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
