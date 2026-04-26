/**
 * Generates NOTICE.md from npm dependency tree + on-disk LICENSE files
 * (via license-checker-rseidelsohn, maintained fork of license-checker).
 * Deduplicates identical license file contents.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { init as initLicenseChecker } from "license-checker-rseidelsohn";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

const productionOnly = process.argv.includes("--production");
/** Full transitive `node_modules` tree (large). Default: only deps listed in package.json. */
const recursive = process.argv.includes("--recursive");

const pkgJson = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8"));
const displayName = pkgJson.name ?? "package";

/** In-repo `file:` workspace deps: they ship their own source / NOTICE, not as npm third-party here. */
const EXCLUDED_PACKAGE_NAMES = new Set([
  "@spirit-agent/agent-core",
  "@spirit-agent/host-internal",
  "spirit-agent-repo",
]);

/** @returns {Set<string> | null} null = no filter (recursive mode) */
function directDependencyNames() {
  if (recursive) return null;
  const names = new Set();
  const add = (obj) => {
    if (!obj) return;
    for (const n of Object.keys(obj)) names.add(n);
  };
  add(pkgJson.dependencies);
  add(pkgJson.optionalDependencies);
  if (!productionOnly) add(pkgJson.devDependencies);
  return names;
}

function parsePackageKey(key) {
  const i = key.lastIndexOf("@");
  if (i <= 0) return { name: key, version: "" };
  return { name: key.slice(0, i), version: key.slice(i + 1) };
}

function repoUrl(info) {
  const r = info.repository;
  if (typeof r === "string") return r.replace(/\.git$/, "");
  return r || "";
}

function findLicenseInDir(dir) {
  const names = [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "LICENCE",
    "LICENCE.md",
    "COPYING",
  ];
  for (const n of names) {
    const p = path.join(dir, n);
    if (existsSync(p)) return p;
  }
  return null;
}

function hashContent(s) {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
}

/** @param {unknown} file */
function firstLicensePath(file) {
  if (!file) return null;
  if (typeof file === "string") return file;
  if (Array.isArray(file)) {
    for (const x of file) {
      if (typeof x === "string") return x;
    }
  }
  return null;
}

function runChecker() {
  return new Promise((resolve, reject) => {
    initLicenseChecker(
      {
        start: pkgRoot,
        production: productionOnly,
        color: false,
      },
      (err, packages) => {
        if (err) reject(err);
        else resolve(packages);
      }
    );
  });
}

function isExcludedName(name) {
  return EXCLUDED_PACKAGE_NAMES.has(name);
}

function summaryCounts(packages, allowed) {
  const counts = new Map();
  for (const [key, info] of Object.entries(packages)) {
    const { name } = parsePackageKey(key);
    if (isExcludedName(name) || info.private) continue;
    if (allowed && !allowed.has(name)) continue;
    const lic = String(info.licenses ?? "UNKNOWN");
    counts.set(lic, (counts.get(lic) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function main() {
  runChecker().then((packages) => {
    const allowed = directDependencyNames();
    const entries = Object.entries(packages)
      .filter(([key, info]) => {
        const { name } = parsePackageKey(key);
        if (isExcludedName(name)) return false;
        if (info.private) return false;
        if (allowed && !allowed.has(name)) return false;
        return true;
      })
      .sort(([a], [b]) => a.localeCompare(b));

    const summaryLines = summaryCounts(packages, allowed).map(
      ([lic, n]) => `- ${lic}: ${n} package(s)`
    );

    const componentLines = [];
    for (const [key, info] of entries) {
      const { name, version } = parsePackageKey(key);
      const lic = String(info.licenses ?? "UNKNOWN");
      componentLines.push(`- **${name}** ${version} — ${lic}`);
      const url = repoUrl(info);
      if (url) componentLines.push(`  - ${url}`);
    }

    /** @type {Map<string, { spdx: string, text: string, packages: string[] }>} */
    const byHash = new Map();
    const missing = [];

    for (const [key, info] of entries) {
      const { name, version } = parsePackageKey(key);
      const label = `${name} ${version}`;
      const spdx = String(info.licenses ?? "UNKNOWN");
      let file = firstLicensePath(info.licenseFile);
      if (file && !path.isAbsolute(file)) {
        file = path.join(pkgRoot, file);
      }
      if (!file || !existsSync(file)) {
        const dir = info.path;
        if (dir) file = findLicenseInDir(dir) ?? null;
      }
      if (!file || !existsSync(file)) {
        missing.push({ label, spdx });
        continue;
      }
      const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n").trimEnd();
      const h = hashContent(text);
      let slot = byHash.get(h);
      if (!slot) {
        slot = { spdx, text, packages: [] };
        byHash.set(h, slot);
      }
      slot.packages.push(label);
    }

    const licenseBlocks = [];
    const sortedGroups = [...byHash.entries()].sort((a, b) =>
      a[1].packages[0].localeCompare(b[1].packages[0])
    );
    for (const [, group] of sortedGroups) {
      const used = group.packages.map((p) => `- ${p}`).join("\n");
      licenseBlocks.push(
        `### ${group.spdx}\n\n**Used by:**\n${used}\n\n\`\`\`\n${group.text}\n\`\`\`\n`
      );
    }
    for (const m of missing) {
      licenseBlocks.push(
        `### ${m.label} — ${m.spdx}\n\n_(No LICENSE file found under this package in node_modules; verify upstream.)_\n`
      );
    }

    const scopeNote = [
      productionOnly ? "package.json `dependencies` only" : "`dependencies` + `devDependencies`",
      recursive ? "full transitive tree (`--recursive`)" : "direct dependencies only (default)",
    ].join("; ");

    const out = [
      "# Third-party notices",
      "",
      `This file was generated for \`${displayName}\` (${scopeNote}).`,
      "Regenerate: \`npm run notice\` — options: \`-- --production\`, \`-- --recursive\`.",
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

    const outPath = path.join(pkgRoot, "NOTICE.md");
    writeFileSync(outPath, out, "utf8");
    console.log(`Wrote NOTICE.md (${entries.length} packages, ${byHash.size} unique license files)`);
  });
}

main();
