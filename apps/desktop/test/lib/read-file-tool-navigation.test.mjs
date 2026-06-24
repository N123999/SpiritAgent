import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveReadFileEditorTarget,
  resolveReadFileTargetFromTool,
  tryResolveWorkspaceRelativePath,
} from '../../src/lib/read-file-tool-navigation.ts';

test('tryResolveWorkspaceRelativePath maps workspace absolute paths', () => {
  assert.equal(
    tryResolveWorkspaceRelativePath('D:\\SpiritAgent', 'D:\\SpiritAgent\\README.md'),
    'README.md',
  );
  assert.equal(tryResolveWorkspaceRelativePath('/proj', '/proj'), '.');
});

test('resolveReadFileEditorTarget: relative path stays in workspace scope', () => {
  assert.deepEqual(resolveReadFileEditorTarget('src/foo.ts', '/proj'), {
    scope: 'workspace',
    relativePath: 'src/foo.ts',
    viewMode: 'edit',
  });
});

test('resolveReadFileEditorTarget: markdown uses preview view mode', () => {
  assert.deepEqual(resolveReadFileEditorTarget('README.md', '/proj'), {
    scope: 'workspace',
    relativePath: 'README.md',
    viewMode: 'preview',
  });
});

test('resolveReadFileEditorTarget: absolute path under workspace becomes relative', () => {
  assert.deepEqual(
    resolveReadFileEditorTarget('D:\\SpiritAgent\\README.md', 'D:\\SpiritAgent'),
    {
      scope: 'workspace',
      relativePath: 'README.md',
      viewMode: 'preview',
    },
  );
});

test('resolveReadFileEditorTarget: path outside workspace uses external scope', () => {
  assert.deepEqual(
    resolveReadFileEditorTarget('C:\\outside\\note.txt', 'D:\\SpiritAgent'),
    {
      scope: 'external',
      absolutePath: 'C:\\outside\\note.txt',
      viewMode: 'edit',
    },
  );
});

test('resolveReadFileEditorTarget: empty path returns null', () => {
  assert.equal(resolveReadFileEditorTarget('   ', '/proj'), null);
});

test('resolveReadFileTargetFromTool parses args excerpt', () => {
  assert.deepEqual(
    resolveReadFileTargetFromTool(
      {
        headline: 'Read',
        detailLines: [],
        argsExcerpt: '{"path":"apps/desktop/package.json"}',
      },
      'D:\\SpiritAgent',
    ),
    {
      scope: 'workspace',
      relativePath: 'apps/desktop/package.json',
      viewMode: 'edit',
    },
  );
});

test('resolveReadFileTargetFromTool returns null without path', () => {
  assert.equal(
    resolveReadFileTargetFromTool({ headline: 'Read', detailLines: [] }, '/proj'),
    null,
  );
});
