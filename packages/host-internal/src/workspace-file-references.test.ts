import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearWorkspaceFileReferenceIndexCache,
  collectWorkspaceFileReferenceIndex,
  resolveWorkspaceFileReferenceAttachmentsFromInput,
} from './workspace-file-references.js';
import {
  computeWorkspaceFileReferenceSuggestions,
  currentWorkspaceFileReferenceQuery,
  referencedWorkspaceFilePathsFromInput,
  replaceWorkspaceFileReferenceQuery,
} from './workspace-file-reference-query.js';

test('current query tracks token under cursor', () => {
  assert.deepEqual(
    currentWorkspaceFileReferenceQuery('@host_runtime.rs', Array.from('@host_runtime.rs').length),
    {
      start: 0,
      end: Array.from('@host_runtime.rs').length,
      raw: '@host_runtime.rs',
    },
  );

  assert.deepEqual(
    currentWorkspaceFileReferenceQuery('先看 @host_runtime.rs 再说', Array.from('先看 @host').length),
    {
      start: Array.from('先看 ').length,
      end: Array.from('先看 @host_runtime.rs').length,
      raw: '@host_runtime.rs',
    },
  );

  assert.equal(
    currentWorkspaceFileReferenceQuery('@host_runtime.rs ', Array.from('@host_runtime.rs ').length),
    undefined,
  );
});

test('replace query appends single space when confirmed', () => {
  const query = currentWorkspaceFileReferenceQuery('先看 @host', Array.from('先看 @host').length);
  assert.ok(query);
  assert.deepEqual(
    replaceWorkspaceFileReferenceQuery('先看 @host', query, 'src/host_runtime.rs', true),
    {
      text: '先看 @src/host_runtime.rs ',
      cursorChars: Array.from('先看 @src/host_runtime.rs ').length,
    },
  );
});

test('referenced paths collect multiple unique tokens', () => {
  assert.deepEqual(
    referencedWorkspaceFilePathsFromInput('@src/host_runtime.rs 请结合 @README.md 和 @src\\host_runtime.rs 看'),
    ['src/host_runtime.rs', 'README.md'],
  );
});

test('fuzzy suggestions prioritize exact basename match', () => {
  const files = [
    'src/host_runtime.rs',
    'src/runtime/host_runtime.rs',
    'src/runtime_handle.rs',
  ];

  assert.deepEqual(computeWorkspaceFileReferenceSuggestions('@host_runtime.rs', files), [
    'src/host_runtime.rs',
    'src/runtime/host_runtime.rs',
  ]);
});

test('collect workspace file index respects root gitignore and default ignored dirs', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-internal-file-ref-'));
  try {
    await mkdir(join(workspaceRoot, 'src'), { recursive: true });
    await mkdir(join(workspaceRoot, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(workspaceRoot, 'ignored-dir'), { recursive: true });
    await writeFile(join(workspaceRoot, '.gitignore'), 'ignored-dir/\n');
    await writeFile(join(workspaceRoot, 'README.md'), '# hello\n');
    await writeFile(join(workspaceRoot, 'src', 'main.ts'), 'console.log(1);\n');
    await writeFile(join(workspaceRoot, 'node_modules', 'pkg', 'index.js'), 'module.exports = {};\n');
    await writeFile(join(workspaceRoot, 'ignored-dir', 'secret.txt'), 'hidden\n');

    clearWorkspaceFileReferenceIndexCache(workspaceRoot);
    const files = await collectWorkspaceFileReferenceIndex(workspaceRoot);
    assert.deepEqual(files, ['.gitignore', 'README.md', 'src/main.ts']);
  } finally {
    clearWorkspaceFileReferenceIndexCache(workspaceRoot);
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('resolve workspace file attachments truncates oversized content and ignores invalid references', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-internal-file-attachment-'));
  try {
    const oversizedText = 'a'.repeat(24_010);
    await writeFile(join(workspaceRoot, 'README.md'), oversizedText);

    const attachments = await resolveWorkspaceFileReferenceAttachmentsFromInput(
      workspaceRoot,
      '@README.md @missing.txt',
    );
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0]?.path, 'README.md');
    assert.equal(attachments[0]?.totalChars, oversizedText.length);
    assert.equal(attachments[0]?.truncated, true);
    assert.match(attachments[0]?.content ?? '', /文件内容已截断/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});