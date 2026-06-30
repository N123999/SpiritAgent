import assert from 'node:assert/strict';
import test from 'node:test';

import { ListTodo } from 'lucide-react';

import {
  resolveWorkspaceFileIconForPath,
  resolveWorkspaceFilesTabIcon,
  setiFileIconThemeMap,
} from '../../src/lib/workspace-explorer-icon.ts';

test('resolveWorkspaceFileIconForPath maps common paths with Seti colors', () => {
  const tsx = resolveWorkspaceFileIconForPath('src/App.tsx');
  assert.ok(tsx);
  assert.equal(tsx.color, setiFileIconThemeMap('dark').blue);

  const md = resolveWorkspaceFileIconForPath('docs/README.md');
  assert.ok(md);
  assert.equal(md.color, setiFileIconThemeMap('dark').blue);
});

test('resolveWorkspaceFilesTabIcon returns ListTodo only for Plan', () => {
  assert.equal(resolveWorkspaceFilesTabIcon('Plan'), ListTodo);
  assert.equal(resolveWorkspaceFilesTabIcon('App.tsx'), undefined);
  assert.equal(resolveWorkspaceFilesTabIcon(undefined), undefined);
});
