import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const LICENSE_FILE_NAMES = [
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "LICENCE",
  "LICENCE.md",
  "COPYING",
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function dependencyEntries(pkgJson, productionOnly) {
  const entries = [];
  const add = (deps) => {
    if (!deps) return;
    entries.push(...Object.entries(deps));
  };

  add(pkgJson.dependencies);
  add(pkgJson.optionalDependencies);
  if (!productionOnly) add(pkgJson.devDependencies);

  return entries;
}

function directDependencyNames(pkgJson, productionOnly) {
  return new Set(dependencyEntries(pkgJson, productionOnly).map(([name]) => name));
}

function workspaceLocalDependencyNames(pkgJson) {
  const names = new Set();
  for (const [name, spec] of dependencyEntries(pkgJson, false)) {
    if (typeof spec === "string" && (spec.startsWith("file:") || spec.startsWith("workspace:"))) {
      names.add(name);
    }
  }
  return names;
}

function parsePackageKey(key) {
  const index = key.lastIndexOf("@");
  if (index <= 0) return { name: key, version: "" };
  return { name: key.slice(0, index), version: key.slice(index + 1) };
}

function makePackageKey(name, version) {
  return `${name}@${version}`;
}

function normalizeRepoUrl(url) {
  return url.replace(/^git\+/, "").replace(/\.git$/, "");
}

function repoUrl(info) {
  const repository = info.repository;
  if (typeof repository === "string") return normalizeRepoUrl(repository);
  if (repository && typeof repository.url === "string") return normalizeRepoUrl(repository.url);
  return "";
}

function findLicenseInDir(dir) {
  for (const fileName of LICENSE_FILE_NAMES) {
    const filePath = path.join(dir, fileName);
    if (existsSync(filePath)) return filePath;
  }
  return null;
}

function hashContent(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

function firstLicensePath(file) {
  if (!file) return null;
  if (typeof file === "string") return file;
  if (Array.isArray(file)) {
    for (const value of file) {
      if (typeof value === "string") return value;
    }
  }
  return null;
}

function buildDirectDependencyFilter(pkgJson, packageLock, productionOnly, recursive) {
  if (recursive) return null;

  const exactKeys = new Set();
  const fallbackNames = new Set();
  const lockPackages = packageLock?.packages;

  for (const name of directDependencyNames(pkgJson, productionOnly)) {
    const topLevelEntry = lockPackages?.[`node_modules/${name}`];
    if (topLevelEntry?.link) continue;

    const version = typeof topLevelEntry?.version === "string" ? topLevelEntry.version : null;
    if (version) exactKeys.add(makePackageKey(name, version));
    else fallbackNames.add(name);
  }

  return { exactKeys, fallbackNames };
}

function buildIncludedEntries(packages, filter, excludedNames) {
  return Object.entries(packages)
    .map(([key, info]) => ({ key, info, ...parsePackageKey(key) }))
    .filter((entry) => {
      if (excludedNames.has(entry.name)) return false;
      if (entry.info.private) return false;
      if (!filter) return true;
      if (filter.exactKeys.has(makePackageKey(entry.name, entry.version))) return true;
      return filter.fallbackNames.has(entry.name);
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.version.localeCompare(b.version, undefined, { numeric: true, sensitivity: "base" })
    );
}

function summaryCounts(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const license = String(entry.info.licenses ?? "UNKNOWN");
    counts.set(license, (counts.get(license) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function resolveLicenseFile(entry, pkgRoot) {
  let filePath = firstLicensePath(entry.info.licenseFile);
  if (filePath && !path.isAbsolute(filePath)) {
    const baseDir = typeof entry.info.path === "string" ? entry.info.path : pkgRoot;
    filePath = path.join(baseDir, filePath);
  }
  if (filePath && existsSync(filePath)) return filePath;

  if (typeof entry.info.path === "string") {
    return findLicenseInDir(entry.info.path);
  }

  return null;
}

function buildNoticeText(entries, displayName, productionOnly, recursive, pkgRoot) {
  const summaryLines = summaryCounts(entries).map(([license, count]) => `- ${license}: ${count} package(s)`);

  const componentLines = [];
  for (const entry of entries) {
    const license = String(entry.info.licenses ?? "UNKNOWN");
    componentLines.push(`- **${entry.name}** ${entry.version} — ${license}`);
    const url = repoUrl(entry.info);
    if (url) componentLines.push(`  - ${url}`);
  }

  const byHash = new Map();
  const missing = [];

  for (const entry of entries) {
    const label = `${entry.name} ${entry.version}`;
    const spdx = String(entry.info.licenses ?? "UNKNOWN");
    const filePath = resolveLicenseFile(entry, pkgRoot);
    if (!filePath || !existsSync(filePath)) {
      missing.push({ label, spdx });
      continue;
    }

    const text = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n").trimEnd();
    const hash = hashContent(text);
    let group = byHash.get(hash);
    if (!group) {
      group = { spdx, text, packages: [] };
      byHash.set(hash, group);
    }
    group.packages.push(label);
  }

  const licenseBlocks = [...byHash.values()]
    .map((group) => ({
      ...group,
      packages: [...group.packages].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
      ),
    }))
    .sort(
      (a, b) =>
        a.spdx.localeCompare(b.spdx) ||
        a.packages[0].localeCompare(b.packages[0], undefined, { numeric: true, sensitivity: "base" })
    )
    .map(
      (group) =>
        `### ${group.spdx}\n\n**Used by:**\n${group.packages
          .map((pkg) => `- ${pkg}`)
          .join("\n")}\n\n\`\`\`\n${group.text}\n\`\`\`\n`
    );

  for (const item of missing) {
    licenseBlocks.push(
      `### ${item.label} — ${item.spdx}\n\n_(No LICENSE file found under this package in node_modules; verify upstream.)_\n`
    );
  }

  const scopeNote = [
    productionOnly ? "package.json `dependencies` only" : "`dependencies` + `devDependencies`",
    recursive ? "transitive dependencies included (`--recursive`)" : "direct dependencies only by default",
  ].join("; ");

  return [
    "# Third-party notices",
    "",
    `This file was generated for \`${displayName}\` (${scopeNote}).`,
    "Regenerate: \`npm run notice\` — \`-- --production\` limits output to production dependencies, \`-- --recursive\` includes transitive dependencies.",
    "Scope constraint: exclude workspace-local/internal dependencies resolved via \`workspace:\` or \`file:\`; keep output sorted deterministically by package name and license section.",
    "",
    "## Summary",
    "",
    ...summaryLines,
    "",
    "## Components",
    "",
    ...componentLines,
    "",
    "## License texts",
    "",
    ...licenseBlocks,
  ].join("\n");
}

function readPackageLock(pkgRoot) {
  const packageLockPath = path.join(pkgRoot, "package-lock.json");
  if (!existsSync(packageLockPath)) return null;
  return readJson(packageLockPath);
}

function resolveExcludedNames(pkgJson, extraExcludedPackageNames) {
  return new Set([pkgJson.name, ...workspaceLocalDependencyNames(pkgJson), ...extraExcludedPackageNames]);
}

function runChecker(initLicenseChecker, pkgRoot, productionOnly) {
  return new Promise((resolve, reject) => {
    initLicenseChecker(
      {
        start: pkgRoot,
        production: productionOnly,
        color: false,
      },
      (error, packages) => {
        if (error) reject(error);
        else resolve(packages);
      }
    );
  });
}

export async function generateNotice({ pkgRoot, initLicenseChecker, extraExcludedPackageNames = [] }) {
  const productionOnly = process.argv.includes("--production");
  const recursive = process.argv.includes("--recursive");
  const pkgJson = readJson(path.join(pkgRoot, "package.json"));
  const displayName = pkgJson.name ?? "package";
  const excludedNames = resolveExcludedNames(pkgJson, extraExcludedPackageNames);
  const packageLock = readPackageLock(pkgRoot);

  try {
    const packages = await runChecker(initLicenseChecker, pkgRoot, productionOnly);
    const filter = buildDirectDependencyFilter(pkgJson, packageLock, productionOnly, recursive);
    const entries = buildIncludedEntries(packages, filter, excludedNames);
    const noticeText = buildNoticeText(entries, displayName, productionOnly, recursive, pkgRoot);

    writeFileSync(path.join(pkgRoot, "NOTICE.md"), noticeText, "utf8");
    console.log(`Wrote NOTICE.md (${entries.length} packages)`);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`Failed to generate NOTICE.md for ${displayName}`);
    console.error(message);
    process.exitCode = 1;
  }
}