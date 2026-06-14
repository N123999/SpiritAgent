/**
 * Packager / window icons live in git and are edited intentionally:
 * - build/icon.png   — macOS + mica title bar (opaque black canvas)
 * - build/icon.ico   — Windows/Linux electron-builder
 * - public/favicon.ico — renderer + Windows taskbar
 *
 * public/spirit-agent-icon.png is the transparent UI brand mark; do NOT derive
 * packager icons from it during release — that strips the black background.
 *
 * Default (no flags): verify the three files exist.
 * --flatten: flatten build/icon.png to opaque black edge-to-edge; sync .ico files.
 * --force: regenerate from spirit-agent-icon.png (dev only; needs review).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { imagesToIco } from 'png-to-ico';
import { readPNG, resize } from 'png-to-ico/lib/png.js';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const buildDir = path.join(desktopRoot, 'build');
const sourcePng = path.join(desktopRoot, 'public', 'spirit-agent-icon.png');
const iconPngPath = path.join(buildDir, 'icon.png');
const iconIcoPath = path.join(buildDir, 'icon.ico');
const faviconIcoPath = path.join(desktopRoot, 'public', 'favicon.ico');

const PACKAGER_ICONS = [
  { label: 'macOS packager PNG', path: iconPngPath },
  { label: 'Windows/Linux ICO', path: iconIcoPath },
  { label: 'favicon.ico', path: faviconIcoPath },
];

const ICO_SIZES = [16, 32, 48, 256];
const force = process.argv.includes('--force');

async function assertOpaqueBlackCanvas(pngPath) {
  const { data, info } = await sharp(pngPath).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const corners = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ];
  for (const [x, y] of corners) {
    const i = (y * w + x) * 4;
    const alpha = data[i + 3];
    if (alpha === undefined || alpha < 255) {
      throw new Error(
        `${path.relative(desktopRoot, pngPath)} has transparent corners (e.g. ${x},${y} alpha=${alpha}). `
        + 'macOS fills transparency with a light icon plate — flatten to opaque black (#000) edge-to-edge. '
        + 'Run: npm run gen:icons -- --flatten',
      );
    }
  }
}

function verifyPackagerIcons() {
  const missing = PACKAGER_ICONS.filter(({ path: filePath }) => !fs.existsSync(filePath));
  if (missing.length > 0) {
    const list = missing.map(({ label, path: filePath }) => `- ${label}: ${path.relative(desktopRoot, filePath)}`).join('\n');
    throw new Error(
      `Missing packager icon(s). Commit or restore these files under apps/desktop/:\n${list}\n`
      + 'To intentionally regenerate from public/spirit-agent-icon.png, run: npm run gen:icons -- --force',
    );
  }
  for (const { label, path: filePath } of PACKAGER_ICONS) {
    console.log(`OK ${label}: ${path.relative(desktopRoot, filePath)}`);
  }
}

async function verifyPackagerIconsAsync() {
  verifyPackagerIcons();
  await assertOpaqueBlackCanvas(iconPngPath);
}

async function flattenPackagerIcons() {
  if (!fs.existsSync(iconPngPath)) {
    throw new Error(`Missing ${path.relative(desktopRoot, iconPngPath)}`);
  }
  fs.mkdirSync(buildDir, { recursive: true });
  await sharp(iconPngPath)
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .png()
    .toFile(iconPngPath);
  const source = await readPNG(iconPngPath);
  const images = await Promise.all(
    ICO_SIZES.map((size) => resize(source, size, size)),
  );
  const ico = await imagesToIco(images);
  fs.writeFileSync(iconIcoPath, ico);
  fs.writeFileSync(faviconIcoPath, ico);
  console.log(`Flattened ${path.relative(desktopRoot, iconPngPath)} to opaque black canvas`);
  console.log(`Synced ${path.relative(desktopRoot, iconIcoPath)} and ${path.relative(desktopRoot, faviconIcoPath)}`);
  await assertOpaqueBlackCanvas(iconPngPath);
}

async function regenerateFromUiSource() {
  if (!fs.existsSync(sourcePng)) {
    throw new Error(`Missing source PNG: ${sourcePng}`);
  }

  fs.mkdirSync(buildDir, { recursive: true });

  await sharp(sourcePng)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 255 } })
    .png()
    .toFile(iconPngPath);

  await flattenPackagerIcons();
}

if (process.argv.includes('--flatten')) {
  await flattenPackagerIcons();
} else if (force) {
  await regenerateFromUiSource();
  console.warn('Regenerated packager icons from UI source — review logo sizing before commit.');
} else {
  await verifyPackagerIconsAsync();
}
