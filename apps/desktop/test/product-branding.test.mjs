import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, '..');

const FORBIDDEN_PATTERNS = [/Spirit Agent Desktop MVP/, /Spirit Agent Desktop/];
const SCAN_SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'dist-electron']);
const SCAN_SKIP_FILES = new Set(['README.md', 'test/product-branding.test.mjs']);

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SCAN_SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

test('index.html title is Spirit Agent without Desktop/MVP', async () => {
  const html = await readFile(join(desktopRoot, 'index.html'), 'utf8');
  assert.match(html, /<title>Spirit Agent<\/title>/);
  assert.doesNotMatch(html, /MVP/);
  assert.doesNotMatch(html, /Spirit Agent Desktop/);
});

test('about dialog message is Spirit Agent without Desktop/MVP', async () => {
  const source = await readFile(join(desktopRoot, 'electron/application-menu.ts'), 'utf8');
  assert.match(source, /message:\s*'Spirit Agent'/);
  assert.doesNotMatch(source, /message:\s*'Spirit Agent Desktop/);
  assert.doesNotMatch(source, /Desktop MVP/);
});

test('apps/desktop has no forbidden product-name strings outside README', async () => {
  const files = await collectFiles(desktopRoot);
  const violations = [];

  for (const filePath of files) {
    const rel = relative(desktopRoot, filePath);
    if (SCAN_SKIP_FILES.has(rel)) continue;

    const content = await readFile(filePath, 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        violations.push(`${rel} matches ${pattern}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
