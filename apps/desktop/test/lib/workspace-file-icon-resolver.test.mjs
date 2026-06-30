import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveWorkspaceFileIcon,
  setiFileIconThemeMap,
} from '../../src/lib/workspace-file-icon-resolver.ts';

test('resolveWorkspaceFileIcon maps common filenames and extensions with Seti colors', () => {
  const pkg = resolveWorkspaceFileIcon('package.json', 'file');
  assert.ok(pkg);
  assert.match(pkg.svg, /^<svg/u);
  assert.match(pkg.svg, /fill="currentColor"/u);
  assert.equal(pkg.color, setiFileIconThemeMap('dark').yellow);

  const tsx = resolveWorkspaceFileIcon('App.tsx', 'file');
  assert.ok(tsx);
  assert.equal(tsx.color, setiFileIconThemeMap('dark').blue);

  const md = resolveWorkspaceFileIcon('README.md', 'file');
  assert.ok(md);
  assert.equal(md.color, setiFileIconThemeMap('dark').blue);

  const unknown = resolveWorkspaceFileIcon('notes', 'file');
  assert.ok(unknown);
  assert.equal(unknown.color, setiFileIconThemeMap('dark').white);
});

test('resolveWorkspaceFileIcon colorMode inherit omits Seti hex', () => {
  const icon = resolveWorkspaceFileIcon('App.tsx', 'file', { colorMode: 'inherit' });
  assert.ok(icon);
  assert.equal(icon.color, undefined);
  assert.match(icon.svg, /fill="currentColor"/u);
});

test('resolveWorkspaceFileIcon resolves directories by trailing slash lookup', () => {
  const dir = resolveWorkspaceFileIcon('components', 'dir');
  assert.ok(dir);
  assert.match(dir.svg, /^<svg/u);
  assert.ok(dir.color);
});

test('resolveWorkspaceFileIcon uses light theme palette when requested', () => {
  const icon = resolveWorkspaceFileIcon('App.ts', 'file', { theme: 'light' });
  assert.ok(icon);
  assert.equal(icon.color, setiFileIconThemeMap('light').blue);
});
